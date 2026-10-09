/*****************************************************************************
 *   Ledger App Bitcoin.
 *   (c) 2025, 2026 Ledger SAS.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *****************************************************************************/

#include <stdint.h>
#include <string.h>

#include "preprocess_outputs.h"

/* SDK headers */
#include "read.h"

/* Local headers */
#include "bitvector.h"
#include "buffer.h"
#include "constants.h"
#include "dispatcher.h"
#include "error_codes.h"
#include "get_merkleized_map.h"
#include "process_in_outs.h"
#include "psbt.h"
#include "psbt_fields.h"
#include "prl_psbt.h"
#include "crypto.h"
#include "script.h"
#include "secp256k1.h"
#include "sign_psbt_cache.h"
#include "sw.h"

/**
 * Callback to process all the keys of the current output map.
 */
static void output_keys_callback(dispatcher_context_t *dc,
                                 output_keys_callback_data_t *callback_data,
                                 const merkleized_map_commitment_t *map_commitment,
                                 int index,
                                 buffer_t *data) {
    size_t data_len = data->size - data->offset;
    in_out_info_t *prl_out = &callback_data->output->in_out;
    uint8_t prl_type = data_len ? data->ptr[data->offset] : 0xff;
    bool prl_scalar = prl_type == PSBT_OUT_AMOUNT || prl_type == PSBT_OUT_SCRIPT ||
                      prl_type == PSBT_OUT_TAP_INTERNAL_KEY;
    if (map_commitment->size > 4 || !((data_len == 1 && prl_scalar) ||
         (data_len == 33 && prl_type == PSBT_OUT_TAP_BIP32_DERIVATION))) {
        prl_out->unexpected_pubkey_error = true;
        return;
    }
    if (prl_type == PSBT_OUT_TAP_INTERNAL_KEY) prl_out->prl_internal_key_present = true;
    if (prl_type == PSBT_OUT_TAP_BIP32_DERIVATION) {
        if (++prl_out->prl_derivation_count != 1) prl_out->unexpected_pubkey_error = true;
        memcpy(prl_out->prl_derivation_pubkey, data->ptr + data->offset + 1, 32);
    }
    if (data_len >= 1) {
        uint8_t key_type;
        buffer_read_u8(data, &key_type);

        if ((key_type == PSBT_OUT_BIP32_DERIVATION || key_type == PSBT_OUT_TAP_BIP32_DERIVATION) &&
            !callback_data->output->in_out.key_expression_found) {
            derivation_info_t derivation_info;
            int res = read_change_and_index_from_psbt_bip32_derivation(dc,
                                                                       key_type,
                                                                       data,
                                                                       map_commitment,
                                                                       index,
                                                                       &derivation_info);
            if (res < 0) {
                // there was an error; we keep track of it so an error SW is sent later
                callback_data->output->in_out.unexpected_pubkey_error = true;
            } else if (res == 1) {
                in_out_info_t *in_out = &callback_data->output->in_out;
                for (size_t i = 0; i < callback_data->state->account.n_internal_key_expressions;
                     i++) {
                    const keyexpr_info_t *key_expr =
                        &callback_data->state->account.internal_key_expressions[i];
                    if (is_keyexpr_compatible_with_derivation_info(key_expr, &derivation_info)) {
                        bool is_change =
                            key_expr->key_expression_ptr->num_second ==
                            derivation_info.key_origin[derivation_info.derivation_len - 2];

                        in_out->key_expression_found = true;
                        in_out->is_change = is_change;
                        in_out->address_index =
                            derivation_info.key_origin[derivation_info.derivation_len - 1];
                        // unlike for inputs, where we want to keep track of all the key expressions
                        // we want to sign for, here we only care about finding the relevant info
                        // for this output. Therefore, we're done as soon as we have a match.
                        break;
                    }
                }
            }
        }
    }
}

bool __attribute__((noinline)) preprocess_outputs(
    dispatcher_context_t *dc,
    sign_psbt_state_t *st,
    sign_psbt_cache_t *sign_psbt_cache,
    uint8_t internal_outputs[static BITVECTOR_REAL_SIZE(MAX_N_OUTPUTS_CAN_SIGN)]) {
    /** OUTPUTS VERIFICATION FLOW
     *
     *  For each output, check if it's internal (that is, a change address).
     *  Also computes the total amount of change outputs, and the total of all outputs.
     */

    LOG_PROCESSOR(__FILE__, __LINE__, __func__);

    memset(&st->outputs, 0, sizeof(st->outputs));

    // the counter used when showing outputs to the user, which ignores change outputs
    // (0-indexed here, although the UX starts with 1)
    unsigned int external_outputs_count = 0;

    for (unsigned int cur_output_index = 0; cur_output_index < st->n_outputs; cur_output_index++) {
        output_info_t output;
        memset(&output, 0, sizeof(output));

        output_keys_callback_data_t callback_data = {.output = &output, .state = st};
        int res = call_get_merkleized_map_with_callback(
            dc,
            (void *) &callback_data,
            st->outputs_root,
            st->n_outputs,
            cur_output_index,
            (merkle_tree_elements_callback_t) output_keys_callback,
            &output.in_out.map);

        if (res < 0) {
            SEND_SW(dc, SW_INCORRECT_DATA);
            return false;
        }

        if (output.in_out.unexpected_pubkey_error) {
            PRINTF("Unexpected pubkey length\n");  // only compressed pubkeys are supported
            SEND_SW(dc, SW_INCORRECT_DATA);
            return false;
        }

        // Read the output's amount
        uint64_t value;
        if (PSBT_FIELD_PRESENT != psbt_get_output_amount(dc, &output.in_out.map, &value)) {
            SEND_SW(dc, SW_INCORRECT_DATA);
            return false;
        }

        if (value == 0 || value > BITCOIN_TOTAL_SUPPLY) {
            // sanity check to avoid overflows in amounts
            PRINTF("Output amount exceed Bitcoin total supply!\n");
            SEND_SW(dc, SW_INCORRECT_DATA);
            return false;
        }

        output.value = value;
        if (!prl_money_add(&st->outputs.total_amount, value)) {
            SEND_SW(dc, SW_INCORRECT_DATA);
            return false;
        }

        // Read the output's scriptPubKey
        if (PSBT_FIELD_PRESENT != psbt_get_output_script(dc,
                                                         &output.in_out.map,
                                                         output.in_out.scriptPubKey,
                                                         sizeof(output.in_out.scriptPubKey),
                                                         &output.in_out.scriptPubKey_len)) {
            SEND_SW(dc, SW_INCORRECT_DATA);
            return false;
        }

        bool is_p2tr = prl_is_p2tr(output.in_out.scriptPubKey, output.in_out.scriptPubKey_len);
        bool is_p2mr = output.in_out.scriptPubKey_len == 34 &&
                       output.in_out.scriptPubKey[0] == 0x52 && output.in_out.scriptPubKey[1] == 0x20;
        if (!is_p2tr && !is_p2mr) {
            SEND_SW(dc, SW_NOT_SUPPORTED);
            return false;
        }
        if (is_p2tr) {
            uint8_t point[65];
            if (memcmp(output.in_out.scriptPubKey + 2, secp256k1_p, 32) >= 0 ||
                crypto_tr_lift_x(output.in_out.scriptPubKey + 2, point) < 0) {
                SEND_SW(dc, SW_INCORRECT_DATA);
                return false;
            }
        }
        int is_internal = is_in_out_internal(dc, st, sign_psbt_cache, &output.in_out, false);
        /* A derivation is accepted only for fully verified BIP86 change. An
         * attacker cannot attach a false change claim and silently downgrade it. */
        if ((output.in_out.prl_derivation_count != 0 || output.in_out.prl_internal_key_present) &&
            (is_internal != 1 || !is_p2tr || output.in_out.prl_derivation_count != 1 ||
             !output.in_out.prl_internal_key_present ||
             !prl_validate_internal_key(dc, &output.in_out.map, PSBT_OUT_TAP_INTERNAL_KEY,
                                        output.in_out.prl_derivation_pubkey))) {
            SEND_SW(dc, SW_INCORRECT_DATA);
            return false;
        }

        if (is_internal < 0) {
            PRINTF("Error checking if output %d is internal\n", cur_output_index);
            SEND_SW(dc, SW_INCORRECT_DATA);
            return false;
        } else if (is_internal == 0) {
            // external output, user needs to validate
            bitvector_set(internal_outputs, cur_output_index, 0);

            // cache external output scripts
            if (external_outputs_count < N_CACHED_EXTERNAL_OUTPUTS) {
                st->outputs.output_script_lengths[external_outputs_count] =
                    output.in_out.scriptPubKey_len;
                memcpy(st->outputs.output_scripts[external_outputs_count],
                       output.in_out.scriptPubKey,
                       output.in_out.scriptPubKey_len);
                st->outputs.output_amounts[external_outputs_count] = value;
            }

            ++external_outputs_count;
        } else {
            // valid change address, nothing to show to the user

            bitvector_set(internal_outputs, cur_output_index, 1);

            if (!prl_money_add(&st->outputs.change_total_amount, output.value) ||
                get_script_address(output.in_out.scriptPubKey, output.in_out.scriptPubKey_len,
                                     st->outputs.change_address, sizeof(st->outputs.change_address)) < 0) {
                SEND_SW(dc, SW_INCORRECT_DATA);
                return false;
            }
            st->outputs.change_index = output.in_out.address_index;
            ++st->outputs.n_change;
        }
    }

    st->n_external_outputs = external_outputs_count;

    // Reject inputs < outputs only when the whole tx is committed; an open sighash
    // (ANYONECANPAY/NONE/SINGLE) may still add inputs later.
    if (!st->sighash_inputs_open && !st->sighash_outputs_open &&
        st->inputs_total_amount < st->outputs.total_amount) {
        PRINTF("Negative fee is invalid\n");
        SEND_SW(dc, SW_INCORRECT_DATA);
        return false;
    }

    if (st->outputs.n_change > 1 || st->n_external_outputs != 1) {
        // As the information regarding change outputs is aggregated, we want to prevent the user
        // from unknowingly signing a transaction that sends the change to too many outputs
        // (possibly economically not worth spending).
        PRINTF("Too many change outputs: %d\n", st->outputs.n_change);
        SEND_SW_EC(dc, SW_NOT_SUPPORTED, EC_SIGN_PSBT_TOO_MANY_CHANGE_OUTPUTS);
        return false;
    }

    return true;
}
