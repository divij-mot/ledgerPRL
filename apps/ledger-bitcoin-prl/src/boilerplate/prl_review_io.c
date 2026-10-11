/* SPDX-License-Identifier: Apache-2.0
 * Narrow adaptation of SDK v27.1.2 io_seproxyhal_io_heartbeat.
 * (c) Ledger SAS, with Pearl review-session validation changes.
 * The SDK's UI handlers and nested-command busy reply are retained. A fault
 * exits the app on receive/transmit failure, lock or expiry. Disconnect may not
 * reach the app; browser-only abort is not a device event.
 */
#include <stdbool.h>
#include <string.h>
#include "prl_review_io.h"
#include "io.h"
#include "main_std_app.h"
#include "os.h"
#include "os_io.h"
#include "os_io_legacy.h"
#include "os_io_seph_ux.h"
#include "os_pin.h"
#include "os_ux.h"
#include "read.h"
#include "seproxyhal_protocol.h"
#include "status_words.h"

extern uint16_t G_ticks;

void __attribute__((noreturn)) prl_session_abort(void) {
    /* Review state and transactions are public; private scalars never cross UI.
     * Exit rather than clear a latch and permit a stale consent callback. */
    explicit_bzero(G_io_apdu_buffer, sizeof(G_io_apdu_buffer));
    explicit_bzero(G_io_rx_buffer, sizeof(G_io_rx_buffer));
    /* The SDK owns shutdown: API27 USE_OS_IO_STACK must not stop the shared
     * OS transport service from an app. Legacy stacks are stopped by app_exit. */
    app_exit();
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
    switch (G_io_rx_buffer[0]) {
        case OS_IO_PACKET_TYPE_RAW_APDU:
        case OS_IO_PACKET_TYPE_USB_HID_APDU:
        case OS_IO_PACKET_TYPE_USB_CCID_APDU:
        case OS_IO_PACKET_TYPE_USB_WEBUSB_APDU:
        case OS_IO_PACKET_TYPE_USB_U2F_HID_APDU:
        case OS_IO_PACKET_TYPE_BLE_APDU:
        case OS_IO_PACKET_TYPE_NFC_APDU: {
            /* Match the SDK heartbeat: reject the new command without
             * replacing the command under review. Do not use io_exchange or
             * io_legacy_apdu_tx, which release the original reply ownership. */
            const uint8_t busy[2] = {SWO_COMMAND_NOT_ACCEPTED >> 8,
                                     SWO_COMMAND_NOT_ACCEPTED & 0xff};
            if (os_io_tx_cmd(G_io_rx_buffer[0], busy, sizeof(busy), NULL) < 0) {
                prl_session_abort();
            }
            check_review_state(start_tick);
            return;
        }
        case OS_IO_PACKET_TYPE_SE_EVT:
        case OS_IO_PACKET_TYPE_SEPH:
            break;
        default:
            prl_session_abort();
    }

    /* Type byte followed by one complete tag/BE16-length/payload envelope. */
    if (size < 4 || size - 1 > (int) sizeof(G_io_seproxyhal_spi_buffer)) prl_session_abort();
    const uint8_t *event = G_io_rx_buffer + 1;
    size_t length = read_u16_be(event, 1);
    if (length != (size_t) size - 4) prl_session_abort();
    const uint8_t *payload = event + 3;
#ifdef HAVE_BLE
    bool pairing_success = false;
#endif
    switch (event[0]) {
        case SEPROXYHAL_TAG_BUTTON_PUSH_EVENT:
            if (length < 1 || (payload[0] & ~6U) != 0) prl_session_abort();
            break;
        case SEPROXYHAL_TAG_FINGER_EVENT:
            /* Only enforce the fields read by the pinned SDK. OS events may
             * carry additional data which the application does not consume. */
#ifdef HAVE_HW_TOUCH_SWIPE
            if (length < 8) prl_session_abort();
#else
            if (length < 5) prl_session_abort();
#endif
            if (payload[0] != 1 && payload[0] != 2) prl_session_abort();
            break;
        case SEPROXYHAL_TAG_TICKER_EVENT:
        case SEPROXYHAL_TAG_DISPLAY_PROCESSED_EVENT:
        case SEPROXYHAL_TAG_STATUS_EVENT:
        case SEPROXYHAL_TAG_POWER_BUTTON_EVENT:
            /* SDK handlers do not read these payloads. Forward bounded,
             * complete OS events unchanged; neither a status prefix nor its
             * length is an app-visible transport-liveness contract. Ticker
             * processing advances one SDK tick, independent of its payload. */
            break;
        case SEPROXYHAL_TAG_ITC_EVENT:
            if (length == 1 && payload[0] == ITC_UX_REDISPLAY) break;
#ifdef HAVE_BLE
            /* An already completed pairing notification may be queued behind
             * the first APDU. It is not approval of this app's review. New
             * pairing requests, failure/cancel/reset and malformed ITCs abort. */
            if (G_io_app.apdu_media == IO_APDU_MEDIA_BLE && length == 2 &&
                payload[0] == ITC_UX_BLE_PAIRING_STATUS &&
                payload[1] == BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS) {
                pairing_success = true;
                break;
            }
#endif
            prl_session_abort();
        default:
            prl_session_abort();
    }
    memcpy(G_io_seproxyhal_spi_buffer, event, (size_t) size - 1);
#ifdef HAVE_BLE
    if (pairing_success) {
        if (io_process_itc_ux_event(G_io_seproxyhal_spi_buffer, (size_t) size - 1) != 0) {
            prl_session_abort();
        }
    } else
#endif
    io_event(CHANNEL_APDU);
    /* Covers a final-approval callback coinciding with expiry or a PIN lock. */
    check_review_state(start_tick);
}
