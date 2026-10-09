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

#include "sign_psbt.h"
#include "sign_psbt/init_global_state.h"
#include "sign_psbt/preprocess_inputs.h"
#include "sign_psbt/preprocess_outputs.h"
#include "sign_psbt/sign_input.h"
#include "sign_psbt/swap_checks.h"
#include "sign_psbt/transaction_display.h"

/* SDK headers */
#include "swap.h"

/* Local headers */
#include "bitvector.h"
#include "constants.h"
#include "display.h"
#include "dispatcher.h"
#include "handle_swap_sign_transaction.h"
#include "musig_sessions.h"
#include "sign_psbt_cache.h"
#include "swap_globals.h"
#include "sw.h"
#include "txhashes.h"

void handler_sign_psbt(dispatcher_context_t *dc, uint8_t protocol_version) {
    ui_set_processing_screen_text(GA_LOADING_TRANSACTION);
    sign_psbt_state_t st = {0};
    sign_psbt_cache_t cache;
    signing_state_t signing_state = {0};
    uint8_t internal_inputs[BITVECTOR_REAL_SIZE(MAX_N_INPUTS_CAN_SIGN)] = {0};
    uint8_t internal_outputs[BITVECTOR_REAL_SIZE(MAX_N_OUTPUTS_CAN_SIGN)] = {0};
    init_sign_psbt_cache(&cache);
    st.protocol_version = protocol_version;
    if (!init_global_state(dc, &st)) goto cleanup;
    if (!preprocess_inputs(dc, &st, &cache, internal_inputs)) goto cleanup;
    if (!preprocess_outputs(dc, &st, &cache, internal_outputs)) goto cleanup;
    if (st.account.n_internal_key_expressions != 1 ||
        !st.account.internal_key_expressions[0].to_sign ||
        st.account.internal_key_expressions[0].key_expression_ptr->type != KEY_EXPRESSION_NORMAL ||
        st.account.internal_key_expressions[0].is_tapscript || st.has_musig2_pub_nonces) {
        SEND_SW(dc, SW_NOT_SUPPORTED);
        goto cleanup;
    }
    if (!compute_tx_hashes(dc, &st, &signing_state.tx_hashes)) goto cleanup;
    if (!display_transaction(dc, &st, internal_outputs)) goto cleanup;
    ioe_show_processing_screen();
    int result = sign_transaction(dc, &st, &cache, &signing_state, internal_inputs);
    ui_post_processing_confirm_transaction(dc, result);
    if (result) SEND_SW(dc, SW_OK);
cleanup:
    explicit_bzero(&st, sizeof(st));
    explicit_bzero(&cache, sizeof(cache));
    explicit_bzero(&signing_state, sizeof(signing_state));
    explicit_bzero(internal_inputs, sizeof(internal_inputs));
    explicit_bzero(internal_outputs, sizeof(internal_outputs));
}
