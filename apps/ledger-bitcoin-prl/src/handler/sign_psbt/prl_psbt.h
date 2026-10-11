/* SPDX-License-Identifier: Apache-2.0 */
#pragma once
#include "dispatcher.h"
#include "merkle.h"

bool prl_validate_global_map(dispatcher_context_t *dc,
                             merkleized_map_commitment_t *map,
                             unsigned int n_inputs,
                             unsigned int n_outputs);
bool prl_validate_internal_key(dispatcher_context_t *dc,
                               const merkleized_map_commitment_t *map,
                               uint8_t key_type,
                               const uint8_t expected[static 32]);
