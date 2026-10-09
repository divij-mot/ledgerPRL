# Narrow defensive source correction

Status: **applied to source only; not compiled, built, tested, emulated, installed,
or otherwise executed**. Authorized by the parent after the static findings.
Native execution remains paused. No native test source was edited.

Only these three guard changes were authored by this review. The root separately
added the known continuation-consumption checks; those are not part of this
guard-only diff.

```diff
--- a/apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c
+++ b/apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c
@@
     bool keyexpr_to_process[MAX_INTERNAL_KEY_EXPRESSIONS] = {0};
     if (!select_keyexprs_to_process(dc, st, -1, keyexpr_to_process)) {
-        return true;
+        // Preprocessing requires one signable internal key expression in Pearl.
+        // A failed re-authentication must not become successful empty signing.
+        SEND_SW(dc, SW_INCORRECT_DATA);
+        return false;
@@
             (merkle_tree_elements_callback_t) input_keys_callback,
             &input.in_out.map);
-        if (res < 0) {
+        // The key walker has a void callback: a failed derivation-value read is
+        // recorded on the input, not in res. Never sign using its zero defaults.
+        if (res < 0 || input.in_out.unexpected_pubkey_error ||
+            !input.in_out.key_expression_found || input.in_out.prl_derivation_count != 1 ||
+            !input.in_out.prl_internal_key_present || !input.has_witnessUtxo) {
             SEND_SW(dc, SW_INCORRECT_DATA);
             return false;
         }
--- a/apps/ledger-bitcoin-prl/src/handler/lib/policy.c
+++ b/apps/ledger-bitcoin-prl/src/handler/lib/policy.c
@@
         uint8_t parity;
-        crypto_tr_tweak_pubkey(compressed_pubkey + 1, h, h_length, &parity, out + 2);
+        if (crypto_tr_tweak_pubkey(compressed_pubkey + 1, h, h_length, &parity, out + 2) < 0) {
+            return -1;
+        }

         return 34;
```

## Why the checks close the traced paths

- The pre-review PRL handler requires exactly one internal key expression marked
  `to_sign`. A failed later selection therefore cannot be a valid empty
  operation. Returning an error prevents a false signed-status and `SW_OK`.
- The map walk only reports errors fetching/authenticating map/key leaves. Its
  void callback separately records derivation-value failures. Checking that
  latch before private-key work stops the demonstrated `/0/0` fallback. Requiring
  a found compatible expression and the exact strict-profile flags makes the
  precondition explicit for every input.
- The immutable Merkle roots still bind successful rereads to the same policy,
  witness script, amounts and path that were validated before review. There is
  no new host input, digest, stored per-input state, signing mode or relaxed
  check. Reconstructing the script once more would be additional defense in
  depth rather than necessary to stop the demonstrated host-controlled error.
- `crypto_tr_tweak_pubkey` only reports successful construction when it returns
  zero. Returning its failure as a negative script result prevents downstream
  address encoding and ownership comparison. Both reachable callers already
  reject negative lengths; no need to treat zero-filled output as a script.

## Required evidence still missing

Compilation, warning diagnostics, native regression tests, fault-injection tests,
emulator review flows, exact-binary provenance and physical-device qualification
remain **not run for these changes**. Read the DAB-01 and DAB-02 qualification
cases in `README.md` before reopening that lane. A static diff review cannot
promote these guards into a qualified firmware release.
