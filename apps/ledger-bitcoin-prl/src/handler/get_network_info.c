/* SPDX-License-Identifier: Apache-2.0 */
#include <string.h>
#include "commands.h"
#include "constants.h"
#include "dispatcher.h"
#include "prl.h"
#include "sw.h"
#include "write.h"

void handler_get_network_info(dispatcher_context_t *dc, uint8_t protocol_version) {
    if (protocol_version != CURRENT_PROTOCOL_VERSION || dc->read_buffer.size != 0) {
        SEND_SW(dc, SW_INCORRECT_DATA);
        return;
    }
    uint8_t info[PRL_NETWORK_INFO_SIZE] = {'P', 'R', 'L', 'B', 1, PRL_NETWORK_ID};
    const uint8_t genesis[32] = PRL_GENESIS_BYTES;
    write_u32_be(info, 6, PRL_COIN_TYPE);
    memcpy(info + 10, genesis, sizeof(genesis));
    write_u64_be(info, 42, PRL_MAX_MONEY);
    write_u16_be(info, 50, PRL_MAX_INPUTS);
    write_u16_be(info, 52, PRL_MAX_OUTPUTS);
    write_u32_be(info, 54, 3); /* bit 0: strict BIP86 profile; bit 1: P2MR recipient */
    SEND_RESPONSE(dc, info, sizeof(info), SW_OK);
}
