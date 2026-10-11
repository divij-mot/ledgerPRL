#!/usr/bin/env python3
"""Compile the actual guard with deterministic syscall/UI stubs, never device access."""
from pathlib import Path
import hashlib, json, os, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "apps/ledger-bitcoin-prl"
SDK = Path(os.environ["BOLOS_SDK"])
SOURCE = Path(os.environ.get("PEARL_GUARD_SOURCE", str(APP / "src/boilerplate/prl_review_io.c")))
DISPATCHER = APP / "src/boilerplate/dispatcher.c"
HERE = Path(__file__).resolve().parent
STUBS = r"""
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
enum { BOLOS_TRUE=0xaa, CHANNEL_APDU=1, OS_IO_PACKET_TYPE_SEPH=1,
       OS_IO_PACKET_TYPE_SE_EVT=2, ITC_UX_REDISPLAY=0x20, ITC_UX_ASK_BLE_PAIRING=0x22, ITC_UX_BLE_PAIRING_STATUS=0x23 };
enum { IO_APDU_MEDIA_NONE=0, IO_APDU_MEDIA_USB_HID=1, IO_APDU_MEDIA_BLE,
       IO_APDU_MEDIA_NFC, IO_APDU_MEDIA_USB_CCID, IO_APDU_MEDIA_USB_WEBUSB,
       IO_APDU_MEDIA_RAW, IO_APDU_MEDIA_U2F, IO_APDU_MEDIA_CDC };
typedef struct { int apdu_media; } test_io_app_t;
extern test_io_app_t G_io_app;
#include "os_ux_id.h"
typedef struct { bolos_ux_public_t ux_id; unsigned int len; union {
    struct { int type; unsigned int pairing_info_len; char pairing_info[16]; } pairing_request;
    struct { int pairing_ok; } pairing_status;
} u; } bolos_ux_params_t;
extern bolos_ux_params_t G_ux_params;
unsigned int os_ux(bolos_ux_params_t *);
int io_process_itc_ux_event(uint8_t *, size_t);
void set_ux_flow_response(bool);
void test_reset_flow(void);
bool test_flow_ended(void);
bool test_flow_response(void);
extern unsigned char G_io_apdu_buffer[260], G_io_rx_buffer[1024], G_io_seproxyhal_spi_buffer[512];
int os_perso_is_pin_set(void);
int os_global_pin_is_validated(void);
int os_io_rx_evt(unsigned char *, unsigned short, unsigned int *, bool);
int os_io_stop(void);
void os_sched_exit(int) __attribute__((noreturn));
void app_exit(void) __attribute__((noreturn));
unsigned char io_event(unsigned char);
static inline uint16_t read_u16_be(const uint8_t *p, size_t off) { return (uint16_t)(p[off]*256u+p[off+1]); }
#define U2BE(p, off) read_u16_be((p), (off))
static inline uint32_t read_u32_be(const uint8_t *p, size_t off) { return ((uint32_t)p[off]<<24)|((uint32_t)p[off+1]<<16)|((uint32_t)p[off+2]<<8)|p[off+3]; }
"""
ux_source = (SDK / "include/os_ux.h").read_text()
first = ux_source.index("BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_CONFIRM_CODE_YES")
last = ux_source.index("} pairing_ok;", first)
STUBS += "\nenum {" + ux_source[first:last] + "};\n"
with tempfile.TemporaryDirectory(prefix="prl-heartbeat-review-") as temp:
    p = Path(temp)
    (p/"test-stubs.h").write_text(STUBS)
    for name in ["io.h", "os.h", "os_io.h", "os_io_legacy.h", "os_pin.h", "read.h", "os_utils.h", "main_std_app.h", "os_ux.h", "os_io_seph_ux.h"]:
        (p/name).write_text('#include "test-stubs.h"\n')
    dispatcher_source = DISPATCHER.read_text()
    deadline = dispatcher_source.split("void prl_check_command_deadline(void)", 1)[1].split("\n}", 1)[0]
    deadline = "void prl_check_command_deadline(void)" + deadline + "\n}\n"
    (p/"deadline.c").write_text('#include "prl_review_io.h"\nextern uint16_t G_ticks;\n'
        'static uint16_t G_prl_command_start_tick;\n' + deadline +
        'void test_set_command_start(uint16_t start) { G_prl_command_start_tick=start; }\n')
    sdk_exit_source = (SDK / "lib_standard_app/main.c").read_text()
    sdk_exit = "void app_exit(void)" + sdk_exit_source.split("WEAK NORETURN void app_exit(void)", 1)[1].split("\n}", 1)[0] + "\n}\n"
    (p/"sdk-exit.c").write_text('#include "test-stubs.h"\n' + sdk_exit)
    ux_event_source = (SDK / "io/src/os_io_seph_ux.c").read_text()
    ux_handler = "int io_process_itc_ux_event" + ux_event_source.split("int io_process_itc_ux_event", 1)[1].split("\n}", 1)[0] + "\n}\n"
    (p/"sdk-pairing.c").write_text('#include "test-stubs.h"\n#include <string.h>\n' + ux_handler)
    display_source = (APP / "src/ui/display.c").read_text()
    flow = "void set_ux_flow_response(bool approved)" + display_source.split("void set_ux_flow_response(bool approved)", 1)[1].split("\n}", 1)[0] + "\n}\n"
    (p/"review-latch.c").write_text('#include "test-stubs.h"\nstatic bool g_ux_flow_ended,g_ux_flow_response;\n'+flow+
        'void test_reset_flow(void){g_ux_flow_ended=false;g_ux_flow_response=false;}\n'
        'bool test_flow_ended(void){return g_ux_flow_ended;}\n'
        'bool test_flow_response(void){return g_ux_flow_response;}\n')
    args = ["cc", "-std=c11", "-D_DEFAULT_SOURCE", "-Wall", "-Wextra", "-Werror", "-g", "-O1",
            "-fsanitize=address,undefined", "-fno-omit-frame-pointer", "-I"+str(p),
            "-I"+str(APP/"src/boilerplate"), "-I"+str(SDK/"include"),
            str(SOURCE), str(p/"deadline.c"), str(p/"sdk-exit.c"), str(p/"sdk-pairing.c"), str(p/"review-latch.c"), str(HERE/"review-heartbeat.c"), "-o", str(p/"test")]
    if os.environ.get("PEARL_TEST_OS_STACK", "1") == "1": args.insert(1, "-DUSE_OS_IO_STACK")
    if os.environ.get("PEARL_TEST_BLE") == "1": args.insert(1, "-DHAVE_BLE")
    if os.environ.get("PEARL_TEST_HW_SWIPE") == "1": args.insert(1, "-DHAVE_HW_TOUCH_SWIPE")
    if os.environ.get("PEARL_TEST_OLD_EXIT") == "1": args.insert(1, "-DTEST_OLD_EXIT")
    if os.environ.get("PEARL_TEST_PAIRING_ONLY") == "1": args.insert(1, "-DTEST_PAIRING_ONLY")
    if os.environ.get("PEARL_TEST_STATUS_ONLY") == "1": args.insert(1, "-DTEST_STATUS_ONLY")
    subprocess.run(args, check=True)
    result = subprocess.run([str(p/"test")], env={**os.environ,"ASAN_OPTIONS":"detect_leaks=0"},
                            check=False, text=True, capture_output=True)
    if result.returncode:
        raise SystemExit(json.dumps({"status":"failed", "returnCode":result.returncode, "stderr":result.stderr}, indent=2))
    print(json.dumps({"status":"passed", "osStack":os.environ.get("PEARL_TEST_OS_STACK", "1") == "1", "sdkExitSha256":hashlib.sha256(sdk_exit.encode()).hexdigest(), "sdkPairingHandlerSha256":hashlib.sha256(ux_handler.encode()).hexdigest(), "reviewLatchSha256":hashlib.sha256(flow.encode()).hexdigest(), "compiledWithBle":os.environ.get("PEARL_TEST_BLE") == "1", "compiledWithHwSwipe":os.environ.get("PEARL_TEST_HW_SWIPE") == "1", "source":str(SOURCE.relative_to(ROOT)),
        "sha256":hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "result":result.stdout.strip(),
        "dispatcher_sha256":hashlib.sha256(DISPATCHER.read_bytes()).hexdigest(),
        "deadline_function_sha256":hashlib.sha256(deadline.encode()).hexdigest(),
        "limits":"Syscall/UI stubs plus verbatim extracted dispatcher deadline helper; no full dispatcher/SDK event processing, physical hardware, or browser-close cancellation proof"}, indent=2))
