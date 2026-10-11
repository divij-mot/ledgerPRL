# Mobile manifest persistence release

Source: `1e21159`. Production deployment: `dpl_PY52Q9eDnowZjzM1oc9XqHH84yHj`, ready at [pearl-ledger-wallet.vercel.app](https://pearl-ledger-wallet.vercel.app/).

The new `/ledger-live.mobile.manifest.json` omits the native cache-busting trigger. The desktop manifest, wallet identity, origin and four transport permissions are unchanged. Phone users who imported the desktop file should reimport the mobile file once; no wallet data clearing is required.

Validation passed the exact installed Ledger 4.23.0 schema, the manifest regression, TypeScript, build and compiled-function boundary checks. An independent Astra review found no blocker. The canonical deployment passed 19 live boundary checks and all 17 public files matched the prebuilt checkpoint byte-for-byte (2,229,684 bytes, 12 immutable assets). It retains the same two Node 24 functions, each bounded to 35 seconds with five output files and no automatic outgoing-fetch instrumentation. No account/address query or valid broadcast was used by these probes.

The [source replay](persistence-timeout-review.md) demonstrates a native storage load race; physical phone restart persistence remains to be checked. This manifest update does not fix the separate device review exit. Physical Gen5 testing of Pearl 0.1.2 still reproduced that exit on both BLE and isolated USB. A temporary read-only diagnostic subsequently captured stop 0C, USB medium 1, packet 01, event tag 0E, phase 2, received length 8, declared payload length 4. That native event validation is being corrected separately; no payment was signed during diagnosis.

The post-deployment 15-minute error-log query returned no error records. This is a bounded observation, not a guarantee about future traffic.
