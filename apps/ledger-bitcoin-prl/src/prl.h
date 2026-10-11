/* SPDX-License-Identifier: Apache-2.0
 * Pearl adaptation of Ledger app-bitcoin. Experimental, not Ledger approved.
 * These are application policy checks, not a consensus replay-protection domain.
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define PRL_MAX_MONEY UINT64_C(2100000000000000000)
#define PRL_MAX_INPUTS 16U
#define PRL_MAX_OUTPUTS 2U
#define PRL_MAX_MAP_ENTRIES 8U
#define PRL_MAX_PREVIOUS_TX_BYTES 65536U
#define PRL_HARDENED UINT32_C(0x80000000)
#define PRL_NETWORK_INFO_SIZE 58U

#ifndef PRL_NETWORK_ID
#error "A Pearl network must be selected explicitly"
#endif

#if PRL_NETWORK_ID == 0
#define PRL_NETWORK_NAME "Mainnet"
#define PRL_COIN_TYPE 808276U
#define PRL_HRP "prl"
#define PRL_GENESIS_BYTES {0xa1,0x8d,0x30,0x93,0xb7,0xff,0x61,0x8f,0x0c,0xdd,0x07,0x3f,0xa3,0xd1,0x03,0x74,0xe2,0xe0,0x10,0x5f,0xe7,0xef,0x53,0xff,0x48,0xb5,0x5f,0x41,0xc5,0x8d,0xad,0xd7}
#elif PRL_NETWORK_ID == 1
#define PRL_NETWORK_NAME "Testnet"
#define PRL_COIN_TYPE 1U
#define PRL_HRP "tprl"
#define PRL_GENESIS_BYTES {0x10,0xf0,0xbe,0x7b,0xe9,0x95,0x0f,0x74,0x02,0x1d,0x0f,0x7c,0x62,0x98,0x9d,0x1e,0x25,0x41,0xc4,0xd4,0x6f,0x3c,0x95,0xb7,0x4e,0x61,0x67,0x98,0x64,0xb4,0x3d,0x18}
#elif PRL_NETWORK_ID == 2
#define PRL_NETWORK_NAME "Testnet2"
#define PRL_COIN_TYPE 1U
#define PRL_HRP "tprl"
#define PRL_GENESIS_BYTES {0xb0,0xc8,0x6d,0x0c,0xd8,0x82,0x5f,0x4d,0x72,0x26,0x0d,0x2d,0xe4,0x6f,0x47,0x04,0x29,0xee,0xce,0x41,0x38,0x11,0xd5,0xd8,0x2b,0x5f,0x2e,0x2e,0xa0,0x33,0x6f,0x96}
#elif PRL_NETWORK_ID == 3 || PRL_NETWORK_ID == 4
#if PRL_NETWORK_ID == 3
#define PRL_NETWORK_NAME "Regtest"
#else
#define PRL_NETWORK_NAME "Simnet"
#endif
#define PRL_COIN_TYPE 1U
#define PRL_HRP "rprl"
#define PRL_GENESIS_BYTES {0x78,0xd0,0xab,0x27,0xdf,0x6a,0x51,0xa8,0xe9,0xdb,0xbd,0xef,0xff,0xca,0x1e,0xbb,0xbe,0xb3,0x81,0x8c,0xb0,0x83,0xce,0x2c,0x2f,0x43,0xb0,0x47,0x24,0x7e,0x58,0x32}
#else
#error "Unsupported Pearl network"
#endif

/* Reject aggregate monetary violations before adding, including uint64 overflow.
 * Keeping each total <= PRL_MAX_MONEY also makes int64 review subtraction safe. */
static inline bool prl_money_add(uint64_t *total, uint64_t value) {
    if (*total > PRL_MAX_MONEY || value > PRL_MAX_MONEY - *total) return false;
    *total += value;
    return true;
}

static inline bool prl_high_fee(uint64_t fee, uint64_t total) {
    return total > UINT64_C(100000) &&
           fee >= total / UINT64_C(10) + (total % UINT64_C(10) != 0);
}

static inline bool prl_account_path_valid(const uint32_t *path, size_t length) {
    return length == 3 && path[0] == (PRL_HARDENED | 86U) &&
           path[1] == (PRL_HARDENED | PRL_COIN_TYPE) && path[2] >= PRL_HARDENED;
}

static inline bool prl_address_path_valid(const uint32_t *path, size_t length) {
    return length == 5 && prl_account_path_valid(path, 3) &&
           path[3] <= 1 && path[4] < PRL_HARDENED;
}

static inline bool prl_is_p2tr(const uint8_t *script, size_t length) {
    return length == 34 && script[0] == 0x51 && script[1] == 0x20;
}

#ifdef HAVE_AUTOAPPROVE_FOR_PERF_TESTS
#error "Pearl builds must never bypass device approval"
#endif
#ifdef HAVE_SWAP
#error "Pearl builds do not support swap/library signing"
#endif
