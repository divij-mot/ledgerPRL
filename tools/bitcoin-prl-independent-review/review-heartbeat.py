#!/usr/bin/env python3
"""Compile the actual guard with deterministic syscall/UI stubs, never device access."""
from pathlib import Path
import hashlib, json, os, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "apps/ledger-bitcoin-prl"
SDK = ROOT / "apps/ledger/vendor/ledger-secure-sdk"
SOURCE = APP / "src/boilerplate/prl_review_io.c"
DISPATCHER = APP / "src/boilerplate/dispatcher.c"
HERE = Path(__file__).resolve().parent
STUBS = r"""
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
enum { BOLOS_TRUE=0xaa, CHANNEL_APDU=1, OS_IO_PACKET_TYPE_SEPH=1,
       OS_IO_PACKET_TYPE_SE_EVT=2, ITC_UX_REDISPLAY=0x20 };
extern unsigned char G_io_apdu_buffer[260], G_io_rx_buffer[1024], G_io_seproxyhal_spi_buffer[512];
int os_perso_is_pin_set(void);
int os_global_pin_is_validated(void);
int os_io_rx_evt(unsigned char *, unsigned short, unsigned int *, bool);
int os_io_stop(void);
void os_sched_exit(int) __attribute__((noreturn));
unsigned char io_event(unsigned char);
static inline uint16_t read_u16_be(const uint8_t *p, size_t off) { return (uint16_t)(p[off]*256u+p[off+1]); }
#define U2BE(p, off) read_u16_be((p), (off))
static inline uint32_t read_u32_be(const uint8_t *p, size_t off) { return ((uint32_t)p[off]<<24)|((uint32_t)p[off+1]<<16)|((uint32_t)p[off+2]<<8)|p[off+3]; }
"""
with tempfile.TemporaryDirectory(prefix="prl-heartbeat-review-") as temp:
    p = Path(temp)
    (p/"test-stubs.h").write_text(STUBS)
    for name in ["io.h", "os.h", "os_io.h", "os_io_legacy.h", "os_pin.h", "read.h", "os_utils.h"]:
        (p/name).write_text('#include "test-stubs.h"\n')
    dispatcher_source = DISPATCHER.read_text()
    deadline = dispatcher_source.split("void prl_check_command_deadline(void)", 1)[1].split("\n}", 1)[0]
    deadline = "void prl_check_command_deadline(void)" + deadline + "\n}\n"
    (p/"deadline.c").write_text('#include "prl_review_io.h"\nextern uint16_t G_ticks;\n'
        'static uint16_t G_prl_command_start_tick;\n' + deadline +
        'void test_set_command_start(uint16_t start) { G_prl_command_start_tick=start; }\n')
    args = ["cc", "-std=c11", "-D_DEFAULT_SOURCE", "-Wall", "-Wextra", "-Werror", "-g", "-O1",
            "-fsanitize=address,undefined", "-fno-omit-frame-pointer", "-I"+str(p),
            "-I"+str(APP/"src/boilerplate"), "-I"+str(SDK/"include"),
            str(SOURCE), str(p/"deadline.c"), str(HERE/"review-heartbeat.c"), "-o", str(p/"test")]
    subprocess.run(args, check=True)
    result = subprocess.run([str(p/"test")], env={**os.environ,"ASAN_OPTIONS":"detect_leaks=0"},
                            check=True, text=True, capture_output=True)
    print(json.dumps({"status":"passed", "source":str(SOURCE.relative_to(ROOT)),
        "sha256":hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "result":result.stdout.strip(),
        "dispatcher_sha256":hashlib.sha256(DISPATCHER.read_bytes()).hexdigest(),
        "deadline_function_sha256":hashlib.sha256(deadline.encode()).hexdigest(),
        "limits":"Syscall/UI stubs plus verbatim extracted dispatcher deadline helper; no full dispatcher/SDK event processing, physical hardware, or browser-close cancellation proof"}, indent=2))
