/* Modified for Pearl (PRL). Upstream provenance: UPSTREAM.json. */
/*****************************************************************************
 *   Ledger App Bitcoin.
 *   (c) 2025 Ledger SAS.
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

/* SDK headers */
#include "base58.h"
#include "bip32.h"

/* Local headers */
#include "commands.h"
#include "constants.h"
#include "crypto.h"
#include "dispatcher.h"
#include "display.h"
#include "io_ext.h"
#include "menu.h"
#include "sw.h"

#define H 0x80000000ul

static bool is_path_safe_for_pubkey_export(const uint32_t bip32_path[], size_t bip32_path_len) {
    return prl_account_path_valid(bip32_path, bip32_path_len);
}

void handler_get_extended_pubkey(dispatcher_context_t *dc, uint8_t protocol_version) {
    (void) protocol_version;

    LOG_PROCESSOR(__FILE__, __LINE__, __func__);

    uint8_t display;
    uint8_t bip32_path_len;
    if (!buffer_read_u8(&dc->read_buffer, &display) ||
        !buffer_read_u8(&dc->read_buffer, &bip32_path_len)) {
        SEND_SW(dc, SW_WRONG_DATA_LENGTH);
        return;
    }

    if (display != 1 || bip32_path_len > MAX_BIP32_PATH_STEPS) {
        SEND_SW(dc, SW_INCORRECT_DATA);
        return;
    }

    uint32_t bip32_path[MAX_BIP32_PATH_STEPS];
    if (bip32_path_len > 0) {
        if (!buffer_read_bip32_path(&dc->read_buffer, bip32_path, bip32_path_len)) {
            SEND_SW(dc, SW_WRONG_DATA_LENGTH);
            return;
        }
    }

    bool is_safe = is_path_safe_for_pubkey_export(bip32_path, bip32_path_len);

    if (!is_safe || dc->read_buffer.offset != dc->read_buffer.size) {
        SEND_SW(dc, SW_NOT_SUPPORTED);
        return;
    }

    serialized_extended_pubkey_check_t pubkey_check;
    uint16_t sw =
        cx_err_to_sw(get_extended_pubkey_at_path(bip32_path,
                                                 bip32_path_len,
                                                 BIP32_PUBKEY_VERSION,
                                                 &pubkey_check.serialized_extended_pubkey));
    if (SW_OK != sw) {
        SEND_SW(dc, sw);
        return;
    }

    crypto_get_checksum((uint8_t *) &pubkey_check.serialized_extended_pubkey,
                        sizeof(pubkey_check.serialized_extended_pubkey),
                        pubkey_check.checksum);

    char pubkey_str[MAX_SERIALIZED_PUBKEY_LENGTH + 1];
    int pubkey_str_len = base58_encode((uint8_t *) &pubkey_check,
                                       sizeof(pubkey_check),
                                       pubkey_str,
                                       sizeof(pubkey_str));
    if (pubkey_str_len != 111 && pubkey_str_len != 112) {
        PRINTF("Failed encoding base58 pubkey\n");
        SEND_SW(dc, SW_BAD_STATE);
        return;
    }
    pubkey_str[pubkey_str_len] = 0;

    char path_str[MAX_SERIALIZED_BIP32_PATH_LENGTH + 1] = "(Master key)";
    if (bip32_path_len > 0) {
        bip32_path_format(bip32_path, bip32_path_len, path_str, sizeof(path_str));
    }

    if (display && !ui_display_pubkey(dc, path_str, pubkey_str)) {
        SEND_SW(dc, SW_DENY);
        return;
    }

    SEND_RESPONSE(dc, pubkey_str, pubkey_str_len, SW_OK);
}
