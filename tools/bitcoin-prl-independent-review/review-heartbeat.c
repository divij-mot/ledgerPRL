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
static unsigned char packet[1024];
static int packet_size, pin_set, pin_valid, fail_after_rx, fail_after_ui, tick_after_ui;
static int calls, receives, stops, exits, cases;
static int command_age;
extern void test_set_command_start(uint16_t start);
static jmp_buf failed;
int os_perso_is_pin_set(void) { return pin_set; }
int os_global_pin_is_validated(void) { return pin_valid; }
int os_io_rx_evt(unsigned char *out, unsigned short max, unsigned int *timeout, _Bool se) {
    assert(max == sizeof(G_io_rx_buffer) && timeout == NULL && se);
    receives++;
    if (packet_size > 0 && packet_size <= max) memcpy(out, packet, packet_size);
    if (fail_after_rx) pin_valid = 0;
    return packet_size;
}
unsigned char io_event(unsigned char channel) {
    assert(channel == CHANNEL_APDU);
    assert(packet_size >= 4);
    assert(memcmp(G_io_seproxyhal_spi_buffer, packet + 1, packet_size - 1) == 0);
    calls++;
    if (fail_after_ui) pin_valid = 0;
    if (tick_after_ui) G_ticks++;
    return 1;
}
int os_io_stop(void) { stops++; return 0; }
void os_sched_exit(int status) {
    assert(status == -1);
    assert(++exits == 1 && stops == 1);
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
    calls = receives = stops = exits = fail_after_rx = fail_after_ui = tick_after_ui = 0;
    command_age = -1;
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
    } else assert(should_exit);
    assert(exits == should_exit && stops == should_exit && calls == expected_calls);
}
int main(void) {
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
        reset(); envelope(SEPROXYHAL_TAG_FINGER_EVENT, 5); packet[4] = kind;
        int allowed = kind == 1 || kind == 2;
        check(0, !allowed, allowed);
    }
    for (int tag = 0; tag < 256; tag++) {
        reset(); envelope(tag, 0);
        int allowed = tag == SEPROXYHAL_TAG_TICKER_EVENT || tag == SEPROXYHAL_TAG_DISPLAY_PROCESSED_EVENT;
        check(0, !allowed, allowed);
    }
    for (int kind = 0; kind < 256; kind++) {
        reset(); envelope(SEPROXYHAL_TAG_ITC_EVENT, 1); packet[4] = kind;
        check(0, kind != ITC_UX_REDISPLAY, kind == ITC_UX_REDISPLAY);
    }
    for (int flags = 0; flags < 256; flags++) {
        reset(); envelope(SEPROXYHAL_TAG_STATUS_EVENT, 4); packet[7] = flags;
        int allowed = !!(flags & SEPROXYHAL_TAG_STATUS_EVENT_FLAG_USB_POWERED);
        check(0, !allowed, allowed);
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
