/* SPDX-License-Identifier: Apache-2.0
 * Narrow adaptation of SDK v27.1.2 io_seproxyhal_io_heartbeat.
 * (c) Ledger SAS, with Pearl review-session validation changes.
 * The SDK's UI handlers are retained. A fault exits the app on nested requests,
 * reported disconnect, lock or expiry. Browser-only abort is not a device event.
 */
#include <string.h>
#include "prl_review_io.h"
#include "io.h"
#include "os.h"
#include "os_io.h"
#include "os_io_legacy.h"
#include "os_pin.h"
#include "read.h"
#include "seproxyhal_protocol.h"

extern uint16_t G_ticks;

void __attribute__((noreturn)) prl_session_abort(void) {
    /* Review state and transactions are public; private scalars never cross UI.
     * Exit rather than clear a latch and permit a stale consent callback. */
    explicit_bzero(G_io_apdu_buffer, sizeof(G_io_apdu_buffer));
    explicit_bzero(G_io_rx_buffer, sizeof(G_io_rx_buffer));
    os_io_stop();
    os_sched_exit(-1);
    __builtin_unreachable();
}

static void check_review_state(uint16_t start_tick) {
    prl_check_command_deadline();
    if ((uint16_t) (G_ticks - start_tick) >= 1200U ||
        (os_perso_is_pin_set() == BOLOS_TRUE && os_global_pin_is_validated() != BOLOS_TRUE)) {
        prl_session_abort();
    }
}

void prl_review_heartbeat(uint16_t start_tick) {
    check_review_state(start_tick);
    int size = os_io_rx_evt(G_io_rx_buffer, sizeof(G_io_rx_buffer), NULL, true);
    check_review_state(start_tick);
    if (size < 0 || size > (int) sizeof(G_io_rx_buffer)) prl_session_abort();
    if (size == 0) return;
    if (G_io_rx_buffer[0] != OS_IO_PACKET_TYPE_SE_EVT &&
        G_io_rx_buffer[0] != OS_IO_PACKET_TYPE_SEPH) prl_session_abort();

    /* Type byte followed by one complete tag/BE16-length/payload envelope. */
    if (size < 4 || size - 1 > (int) sizeof(G_io_seproxyhal_spi_buffer)) prl_session_abort();
    const uint8_t *event = G_io_rx_buffer + 1;
    size_t length = read_u16_be(event, 1);
    if (length != (size_t) size - 4) prl_session_abort();
    const uint8_t *payload = event + 3;
    switch (event[0]) {
        case SEPROXYHAL_TAG_BUTTON_PUSH_EVENT:
            if (length != 1 || (payload[0] & ~6U) != 0) prl_session_abort();
            break;
        case SEPROXYHAL_TAG_FINGER_EVENT:
            if (length != 5 || (payload[0] != 1 && payload[0] != 2)) prl_session_abort();
            break;
        case SEPROXYHAL_TAG_TICKER_EVENT:
        case SEPROXYHAL_TAG_DISPLAY_PROCESSED_EVENT:
            if (length != 0) prl_session_abort();
            break;
        case SEPROXYHAL_TAG_STATUS_EVENT:
            if (length != 4 ||
                (read_u32_be(payload, 0) & SEPROXYHAL_TAG_STATUS_EVENT_FLAG_USB_POWERED) == 0) {
                prl_session_abort();
            }
            break;
        case SEPROXYHAL_TAG_ITC_EVENT:
            /* BLE is disabled. Only the benign UI-redisplay event is needed. */
            if (length != 1 || payload[0] != ITC_UX_REDISPLAY) prl_session_abort();
            break;
        default:
            prl_session_abort();
    }
    memcpy(G_io_seproxyhal_spi_buffer, event, (size_t) size - 1);
    io_event(CHANNEL_APDU);
    /* Covers a final-approval callback coinciding with expiry or a PIN lock. */
    check_review_state(start_tick);
}
