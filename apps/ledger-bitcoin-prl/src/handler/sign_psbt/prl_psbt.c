/* SPDX-License-Identifier: Apache-2.0
 * Closed PSBTv2 profile: no ignored signing controls or host-selected network.
 */
#include <string.h>
#include "prl_psbt.h"
#include "check_merkle_tree_sorted.h"
#include "get_merkleized_map_value.h"
#include "prl.h"
#include "psbt.h"

static const uint8_t network_key[] = {0xfc, 3, 'P', 'R', 'L', 1};

typedef struct {
    bool valid;
    unsigned int seen;
} global_keys_t;

static void global_key_callback(dispatcher_context_t *dc,
                                  void *state,
                                  const merkleized_map_commitment_t *map,
                                  int index,
                                  buffer_t *key) {
    (void) dc;
    (void) map;
    (void) index;
    global_keys_t *keys = state;
    size_t length = key->size - key->offset;
    const uint8_t *bytes = key->ptr + key->offset;
    if (length == sizeof(network_key) && memcmp(bytes, network_key, length) == 0) {
        keys->seen |= 1U << 7;
    } else if (length == 1) {
        if (bytes[0] >= PSBT_GLOBAL_TX_VERSION && bytes[0] <= PSBT_GLOBAL_TX_MODIFIABLE) {
            keys->seen |= 1U << (bytes[0] - PSBT_GLOBAL_TX_VERSION);
        } else if (bytes[0] == PSBT_GLOBAL_VERSION) {
            keys->seen |= 1U << 6;
        } else {
            keys->valid = false;
        }
    } else {
        keys->valid = false;
    }
}

static bool value_equals(dispatcher_context_t *dc,
                          const merkleized_map_commitment_t *map,
                          uint8_t key,
                          const uint8_t *expected,
                          size_t length) {
    uint8_t value[4];
    return length <= sizeof(value) &&
           call_get_merkleized_map_value(dc, map, &key, 1, value, sizeof(value)) == (int) length &&
           memcmp(value, expected, length) == 0;
}

bool prl_validate_global_map(dispatcher_context_t *dc,
                             merkleized_map_commitment_t *map,
                             unsigned int n_inputs,
                             unsigned int n_outputs) {
    if (map->size < 5 || map->size > 7 || n_inputs == 0 || n_inputs > PRL_MAX_INPUTS ||
        n_outputs == 0 || n_outputs > PRL_MAX_OUTPUTS) return false;

    global_keys_t keys = {.valid = true, .seen = 0};
    map->_keys_are_sorted = false;
    if (call_check_merkle_tree_sorted_with_callback(dc, &keys, map->keys_root,
                                                     (size_t) map->size, global_key_callback,
                                                     map) < 0 || !keys.valid) return false;
    map->_keys_are_sorted = true;

    /* Required: tx version, counts, PSBT version and chain binding. */
    const unsigned int required = (1U << 0) | (1U << 2) | (1U << 3) | (1U << 6) | (1U << 7);
    if ((keys.seen & required) != required) return false;
    const uint8_t in_count = (uint8_t) n_inputs, out_count = (uint8_t) n_outputs;
    if (!value_equals(dc, map, PSBT_GLOBAL_TX_VERSION, (uint8_t[]){1,0,0,0}, 4) ||
        !value_equals(dc, map, PSBT_GLOBAL_VERSION, (uint8_t[]){2,0,0,0}, 4) ||
        !value_equals(dc, map, PSBT_GLOBAL_INPUT_COUNT, &in_count, 1) ||
        !value_equals(dc, map, PSBT_GLOBAL_OUTPUT_COUNT, &out_count, 1)) return false;
    /* Presence comes from the committed key tree, so a host cannot hide a value
     * by answering that the optional key was absent. */
    if ((keys.seen & (1U << 1)) &&
        !value_equals(dc, map, PSBT_GLOBAL_FALLBACK_LOCKTIME, (uint8_t[]){0,0,0,0}, 4)) return false;
    if ((keys.seen & (1U << 4)) &&
        !value_equals(dc, map, PSBT_GLOBAL_TX_MODIFIABLE, (uint8_t[]){0}, 1)) return false;

    uint8_t binding[34];
    const uint8_t genesis[32] = PRL_GENESIS_BYTES;
    return call_get_merkleized_map_value(dc, map, network_key, sizeof(network_key),
                                         binding, sizeof(binding)) == (int) sizeof(binding) &&
           binding[0] == 1 && binding[1] == PRL_NETWORK_ID &&
           memcmp(binding + 2, genesis, sizeof(genesis)) == 0;
}

bool prl_validate_internal_key(dispatcher_context_t *dc,
                               const merkleized_map_commitment_t *map,
                               uint8_t key_type,
                               const uint8_t expected[static 32]) {
    uint8_t actual[32];
    return call_get_merkleized_map_value(dc, map, &key_type, 1, actual, sizeof(actual)) == 32 &&
           memcmp(actual, expected, sizeof(actual)) == 0;
}
