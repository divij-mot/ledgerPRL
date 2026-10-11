/* Independent, syscall-stubbed tests of the actual native review heartbeat.
 * This is not physical-device or real SDK event-compatibility evidence. */
#include <assert.h>
#include <setjmp.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "prl_review_io.h"
#include "test-stubs.h"
#include "seproxyhal_protocol.h"

unsigned char G_io_apdu_buffer[260], G_io_rx_buffer[1024], G_io_seproxyhal_spi_buffer[512];
uint16_t G_ticks;
test_io_app_t G_io_app;
bolos_ux_params_t G_ux_params;
static int pairing_calls, review_gesture = -1, count_ticker;
static unsigned char packet[1024];
static int packet_size, pin_set, pin_valid, fail_after_rx, fail_after_ui, tick_after_ui;
static int calls, receives, stops, exits, cases;
static int command_age;
extern void test_set_command_start(uint16_t start);
static jmp_buf failed;
#if defined(USE_OS_IO_STACK) && !defined(TEST_OLD_EXIT)
#define EXPECTED_STOPS 0
#else
#define EXPECTED_STOPS 1
#endif
int os_perso_is_pin_set(void) { return pin_set; }
int os_global_pin_is_validated(void) { return pin_valid; }
int os_io_rx_evt(unsigned char *out, unsigned short max, unsigned int *timeout, _Bool se) {
    assert(max == sizeof(G_io_rx_buffer) && timeout == NULL && se);
    receives++;
    if (packet_size > 0 && packet_size <= max) memcpy(out, packet, packet_size);
    if (fail_after_rx) pin_valid = 0;
    return packet_size;
}
unsigned int os_ux(bolos_ux_params_t *params) {
    assert(params == &G_ux_params);
    assert(params->ux_id == BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS);
    assert(params->len == sizeof(params->u.pairing_status));
    assert(params->u.pairing_status.pairing_ok == BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS);
    assert(!test_flow_ended());
    pairing_calls++;
    if (fail_after_ui) pin_valid = 0;
    if (tick_after_ui) G_ticks++;
    return 0;
}
unsigned char io_event(unsigned char channel) {
    assert(channel == CHANNEL_APDU);
    assert(packet_size >= 4);
    assert(memcmp(G_io_seproxyhal_spi_buffer, packet + 1, packet_size - 1) == 0);
    calls++;
    if (count_ticker && packet[1] == SEPROXYHAL_TAG_TICKER_EVENT) G_ticks++;
    if (review_gesture >= 0 && packet[1] == SEPROXYHAL_TAG_BUTTON_PUSH_EVENT)
        set_ux_flow_response(review_gesture != 0);
    if (fail_after_ui) pin_valid = 0;
    if (tick_after_ui) G_ticks++;
    return 1;
}
int os_io_stop(void) { stops++; return 0; }
void os_sched_exit(int status) {
    assert(status == -1);
    assert(++exits == 1 && stops == EXPECTED_STOPS);
    for (size_t i = 0; i < sizeof(G_io_apdu_buffer); i++) assert(G_io_apdu_buffer[i] == 0);
    for (size_t i = 0; i < sizeof(G_io_rx_buffer); i++) assert(G_io_rx_buffer[i] == 0);
    longjmp(failed, 1);
}
static void reset(void) {
    memset(packet, 0, sizeof(packet));
    memset(G_io_apdu_buffer, 0xa5, sizeof(G_io_apdu_buffer));
    memset(G_io_rx_buffer, 0x5a, sizeof(G_io_rx_buffer));
    memset(G_io_seproxyhal_spi_buffer, 0x33, sizeof(G_io_seproxyhal_spi_buffer));
    packet[0] = OS_IO_PACKET_TYPE_SE_EVT;
    packet_size = 4;
    pin_set = pin_valid = BOLOS_TRUE;
    G_ticks = 0;
    G_io_app.apdu_media = IO_APDU_MEDIA_USB_HID;
    calls = receives = stops = exits = fail_after_rx = fail_after_ui = tick_after_ui = 0;
    command_age = -1;
    pairing_calls = 0; review_gesture = -1; count_ticker = 0; test_reset_flow();
}
static void envelope(unsigned char tag, unsigned len) {
    packet[1] = tag; packet[2] = len >> 8; packet[3] = len;
    packet_size = 4 + len;
}
static void check(uint16_t start, int should_exit, int expected_calls) {
    cases++;
    test_set_command_start(command_age < 0 ? start : (uint16_t)(G_ticks - command_age));
    if (setjmp(failed) == 0) {
        prl_review_heartbeat(start);
        assert(!should_exit);
    } else {
        if (!should_exit) fprintf(stderr, "Unexpected exit: media=%d event=%u length=%d payload0=%u payload1=%u\n", G_io_app.apdu_media, packet[1], packet_size - 4, packet[4], packet[5]);
        assert(should_exit);
    }
    assert(exits == should_exit && stops == should_exit * EXPECTED_STOPS && calls == expected_calls);
}
int main(void) {
#ifdef TEST_STATUS_ONLY
    /* Captured framing, synthetic zero payload; no actual flags were logged. */
    reset(); packet[0] = OS_IO_PACKET_TYPE_SEPH;
    envelope(SEPROXYHAL_TAG_STATUS_EVENT, 10);
    check(0, 0, 1); assert(!test_flow_ended());
    puts("PASS captured status framing preserves pending review");
    return 0;
#endif
#ifdef TEST_PAIRING_ONLY
    reset(); G_io_app.apdu_media = IO_APDU_MEDIA_BLE;
    envelope(SEPROXYHAL_TAG_ITC_EVENT, 2); packet[4] = ITC_UX_BLE_PAIRING_STATUS;
    packet[5] = BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS;
    check(0, 0, 0); assert(pairing_calls == 1 && !test_flow_ended());
    puts("PASS pairing success notification does not approve application review");
    return 0;
#endif
    /* Captured Gen5 framing: M1 P01 T0E N8 L4. The physical payload was
     * NOT logged. Exercise synthetic contents and prove one tick, no approval. */
    const uint32_t payloads[] = {0, 0xffffffffU, 0x01234567U, 0x80000000U};
    for (unsigned n = 0; n < sizeof(payloads)/sizeof(payloads[0]); n++) {
        reset(); count_ticker = 1; G_ticks = 10;
        packet[0] = OS_IO_PACKET_TYPE_SEPH;
        envelope(SEPROXYHAL_TAG_TICKER_EVENT, 4);
        for (unsigned b = 0; b < 4; b++) packet[4+b] = payloads[n] >> (24 - 8*b);
        check(0, 0, 1); assert(G_ticks == 11); assert(!test_flow_ended());
    }
    for (unsigned len = 0; len < 17; len++) {
        reset(); count_ticker = 1;
        envelope(SEPROXYHAL_TAG_TICKER_EVENT, len);
        int accepted = 1;
        check(0, !accepted, accepted); assert(G_ticks == accepted);
        assert(!test_flow_ended());
        reset(); envelope(SEPROXYHAL_TAG_DISPLAY_PROCESSED_EVENT, len);
        check(0, 0, 1); assert(G_ticks == 0); assert(!test_flow_ended());
    }
    for (int approve = 0; approve < 2; approve++) {
        reset(); count_ticker = 1;
        packet[0] = OS_IO_PACKET_TYPE_SEPH; envelope(SEPROXYHAL_TAG_TICKER_EVENT, 4);
        memset(packet + 4, 0xff, 4); check(0, 0, 1); assert(!test_flow_ended());
        envelope(SEPROXYHAL_TAG_BUTTON_PUSH_EVENT, 1); packet[4] = 6;
        review_gesture = approve; check(0, 0, 2);
        assert(test_flow_ended() && test_flow_response() == (approve != 0));
    }
    for (int whole = 0; whole < 2; whole++) {
        reset(); count_ticker = 1; envelope(SEPROXYHAL_TAG_TICKER_EVENT, 4);
        if (whole) command_age = 2999; else G_ticks = 1199;
        check(0, 1, 1);
    }
    reset(); count_ticker = 1; envelope(SEPROXYHAL_TAG_TICKER_EVENT, 4);
    G_ticks = 65535; check(65535, 0, 1); assert(G_ticks == 0);
    /* Second captured Gen5 framing: M1 P01 T15 N14 L10. Payload/flags
     * were NOT captured. Exercise synthetic bytes across every bounded size. */
    const unsigned char opaque_tags[] = {SEPROXYHAL_TAG_TICKER_EVENT,
        SEPROXYHAL_TAG_DISPLAY_PROCESSED_EVENT, SEPROXYHAL_TAG_STATUS_EVENT};
    for (unsigned tag = 0; tag < sizeof(opaque_tags); tag++) {
        for (unsigned len = 0; len <= sizeof(G_io_seproxyhal_spi_buffer)-3; len++) {
            for (unsigned pattern = 0; pattern < 3; pattern++) {
                reset(); count_ticker = 1; packet[0] = OS_IO_PACKET_TYPE_SEPH;
                envelope(opaque_tags[tag], len);
                for (unsigned b = 0; b < len; b++) packet[4+b] = pattern == 0 ? 0 : pattern == 1 ? 255 : b;
                check(0, 0, 1); assert(!test_flow_ended());
                assert(G_ticks == (opaque_tags[tag] == SEPROXYHAL_TAG_TICKER_EVENT));
            }
        }
        reset(); envelope(opaque_tags[tag], sizeof(G_io_seproxyhal_spi_buffer)-2);
        check(0, 1, 0);
        reset(); envelope(opaque_tags[tag], 10); fail_after_ui = 1; check(0, 1, 1);
        for (int whole = 0; whole < 2; whole++) {
            reset(); envelope(opaque_tags[tag], 10); tick_after_ui = 1;
            if (whole) command_age = 2999; else G_ticks = 1199;
            check(0, 1, 1);
        }
        for (int approve = 0; approve < 2; approve++) {
            reset(); envelope(opaque_tags[tag], 10); memset(packet+4,255,10);
            check(0, 0, 1); assert(!test_flow_ended());
            envelope(SEPROXYHAL_TAG_BUTTON_PUSH_EVENT, 9); packet[4] = 6;
            review_gesture = approve; check(0, 0, 2);
            assert(test_flow_ended() && test_flow_response() == (approve != 0));
        }
    }
    /* Only bytes actually read by SDK gesture handlers are mandatory.
     * Additional bytes do not create approval; malformed prefixes still exit. */
    for (unsigned len = 0; len < 18; len++) {
        reset(); envelope(SEPROXYHAL_TAG_BUTTON_PUSH_EVENT, len);
        memset(packet+4,255,len); packet[4] = 6;
        check(0, len < 1, len >= 1); assert(!test_flow_ended());
        reset(); envelope(SEPROXYHAL_TAG_FINGER_EVENT, len);
        memset(packet+4,255,len); packet[4] = 1;
#ifdef HAVE_HW_TOUCH_SWIPE
        int valid = len >= 8;
#else
        int valid = len >= 5;
#endif
        check(0, !valid, valid); assert(!test_flow_ended());
    }
    /* All packet/media types: only two well-formed event classes may reach UX. */
    for (int media = 0; media < 256; media++) {
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); packet[0] = media;
        int allowed = media == OS_IO_PACKET_TYPE_SE_EVT || media == OS_IO_PACKET_TYPE_SEPH;
        check(0, !allowed, allowed);
    }
    /* All button bytes: only release/left/right/both masks are allowed. */
    for (int mask = 0; mask < 256; mask++) {
        reset(); envelope(SEPROXYHAL_TAG_BUTTON_PUSH_EVENT, 1); packet[4] = mask;
        int allowed = (mask & ~6U) == 0;
        check(0, !allowed, allowed);
    }
    for (int kind = 0; kind < 256; kind++) {
        reset(); envelope(SEPROXYHAL_TAG_FINGER_EVENT, 8); packet[4] = kind;
        int allowed = kind == 1 || kind == 2;
        check(0, !allowed, allowed);
    }
    for (int tag = 0; tag < 256; tag++) {
        reset(); envelope(tag, 0);
        int allowed = tag == SEPROXYHAL_TAG_TICKER_EVENT || tag == SEPROXYHAL_TAG_DISPLAY_PROCESSED_EVENT || tag == SEPROXYHAL_TAG_STATUS_EVENT;
        check(0, !allowed, allowed);
    }
    for (int kind = 0; kind < 256; kind++) {
        reset(); envelope(SEPROXYHAL_TAG_ITC_EVENT, 1); packet[4] = kind;
        check(0, kind != ITC_UX_REDISPLAY, kind == ITC_UX_REDISPLAY);
    }
    /* Status bytes are opaque OS UX data, never app-visible link proof. */
    for (int media = 0; media <= IO_APDU_MEDIA_CDC; media++) {
        for (int flags = 0; flags < 256; flags++) {
            reset(); G_io_app.apdu_media = media;
            envelope(SEPROXYHAL_TAG_STATUS_EVENT, 4); packet[7] = flags;
            check(0, 0, 1); assert(!test_flow_ended());
        }
    }
    /* No nested APDU or pairing mutation is accepted during BLE review. */
    for (int type = 0; type < 256; type++) {
        reset(); G_io_app.apdu_media = IO_APDU_MEDIA_BLE;
        envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); packet[0] = type;
        int allowed = type == OS_IO_PACKET_TYPE_SE_EVT || type == OS_IO_PACKET_TYPE_SEPH;
        check(0, !allowed, allowed);
        reset(); G_io_app.apdu_media = IO_APDU_MEDIA_BLE;
        envelope(SEPROXYHAL_TAG_ITC_EVENT, 1); packet[4] = type;
        check(0, type != ITC_UX_REDISPLAY, type == ITC_UX_REDISPLAY);
    }
    /* The SDK's exact completed-pairing notification is accepted only on
     * active BLE, reaches its real handler, and cannot approve app review. */
    for (int media = 0; media <= IO_APDU_MEDIA_CDC; media++) {
        for (int status = 0; status < 256; status++) {
            reset(); G_io_app.apdu_media = media;
            envelope(SEPROXYHAL_TAG_ITC_EVENT, 2);
            packet[4] = ITC_UX_BLE_PAIRING_STATUS; packet[5] = status;
            int allowed = 0;
#ifdef HAVE_BLE
            allowed = media == IO_APDU_MEDIA_BLE && status == BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS;
#endif
            check(0, !allowed, 0); assert(pairing_calls == allowed); assert(!test_flow_ended());
        }
    }
#ifdef HAVE_BLE
    for (int approve = 0; approve < 2; approve++) {
        reset(); G_io_app.apdu_media = IO_APDU_MEDIA_BLE;
        envelope(SEPROXYHAL_TAG_STATUS_EVENT, 4); check(0, 0, 1);
        assert(!test_flow_ended());
        envelope(SEPROXYHAL_TAG_ITC_EVENT, 2);
        packet[4] = ITC_UX_BLE_PAIRING_STATUS; packet[5] = BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS;
        check(0, 0, 1); assert(pairing_calls == 1); assert(!test_flow_ended());
        envelope(SEPROXYHAL_TAG_BUTTON_PUSH_EVENT, 1); packet[4] = 6;
        review_gesture = approve; check(0, 0, 2);
        assert(test_flow_ended() && test_flow_response() == (approve != 0));
    }
    reset(); G_io_app.apdu_media = IO_APDU_MEDIA_BLE;
    envelope(SEPROXYHAL_TAG_ITC_EVENT, 2); packet[4] = ITC_UX_BLE_PAIRING_STATUS;
    packet[5] = BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS;
    fail_after_ui = 1; check(0, 1, 0); assert(pairing_calls == 1);
    for (int whole_command = 0; whole_command < 2; whole_command++) {
        reset(); G_io_app.apdu_media = IO_APDU_MEDIA_BLE;
        envelope(SEPROXYHAL_TAG_ITC_EVENT, 2); packet[4] = ITC_UX_BLE_PAIRING_STATUS;
        packet[5] = BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS;
        if (whole_command) command_age = 2999; else G_ticks = 1199;
        tick_after_ui = 1; check(0, 1, 0); assert(pairing_calls == 1);
    }
#endif
    /* SDK receive failure still exits; bounded status suffixes are opaque. */
    reset(); G_io_app.apdu_media = IO_APDU_MEDIA_BLE; packet_size = -1; check(0, 1, 0);
    for (unsigned length = 0; length < 16; length++) {
        reset(); G_io_app.apdu_media = IO_APDU_MEDIA_BLE;
        envelope(SEPROXYHAL_TAG_STATUS_EVENT, length); packet[7] = 12;
        check(0, 0, 1); assert(!test_flow_ended());
    }
    /* Negative, short, oversize and mismatched envelope lengths. */
    for (int size = -2; size <= 1100; size++) {
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); packet_size = size;
        check(0, size != 0 && size != 4, size == 4);
    }
    for (unsigned len = 0; len < 65536; len++) {
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); packet[2] = len >> 8; packet[3] = len;
        check(0, len != 0, len == 0);
    }
    /* Deadline subtraction handles 16-bit wrap and a callback at the boundary. */
    for (unsigned start = 0; start < 65536; start += 31) {
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); G_ticks = (uint16_t)(start + 1199);
        check(start, 0, 1);
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); G_ticks = (uint16_t)(start + 1200);
        check(start, 1, 0); assert(receives == 0);
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); G_ticks = (uint16_t)(start + 1199); tick_after_ui = 1;
        check(start, 1, 1);
    }
    reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); pin_valid = 0;
    check(0, 1, 0); assert(receives == 0);
    reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); fail_after_rx = 1; check(0, 1, 0);
    reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); fail_after_ui = 1; check(0, 1, 1);
    reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); pin_set = pin_valid = 0; check(0, 0, 1);
    /* Exact dispatcher deadline helper, with a fresh review but an older command. */
    for (unsigned start = 0; start < 65536; start += 31) {
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); G_ticks = start; command_age = 2999;
        check(start, 0, 1);
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); G_ticks = start; command_age = 3000;
        check(start, 1, 0); assert(receives == 0);
        reset(); envelope(SEPROXYHAL_TAG_TICKER_EVENT, 0); G_ticks = start; command_age = 2999; tick_after_ui = 1;
        check(start, 1, 1);
    }
    printf("PASS %d independent heartbeat syscall-stub cases under ASan/UBSan\n", cases);
}
