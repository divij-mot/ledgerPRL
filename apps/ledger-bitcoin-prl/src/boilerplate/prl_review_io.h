/* SPDX-License-Identifier: Apache-2.0 */
#pragma once
#include <stdint.h>

/* Only called while a trusted UI review is active. No private key is live. */
void prl_review_heartbeat(uint16_t start_tick);

/* Terminal exit; callers must hold no live private scalar. */
void __attribute__((noreturn)) prl_session_abort(void);
/* Immutable whole-command deadline, checked only at public I/O boundaries. */
void prl_check_command_deadline(void);
