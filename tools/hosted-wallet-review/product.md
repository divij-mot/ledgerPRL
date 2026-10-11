# Final product and implementation review

10 October 2026. Current production source: `fca78a828362ea2d65cfe10872ca57626c52b866`; [release evidence](release.md) records its deployment and distinguishes the earlier `e6b0ff1` baseline. This bounded AI review is not a professional security audit or exhaustive platform qualification. No personal wallet values, addresses, recipients, transaction IDs or wallet files are retained here.

## Shared product and trust boundaries

- Local: `python3 scripts/run-local.py` installs the lockfile, reuses or rebuilds the verified native helper, builds the frontend and starts the foreground server. Its launcher-only flag opens `http://127.0.0.1:5188/` after successful listening for desktop WebHID. Failed binding never opens a browser; existing helper/server shutdown remains intact.
- Hosted: [the browser wallet](https://pearl-ledger-wallet.vercel.app/) and [Discover entry](https://pearl-ledger-wallet.vercel.app/live.html) share the same wallet/signing/recovery engine and require no running Mac. The hosted manifest was imported with owner approval into desktop Ledger Wallet. Android remains source/simulated-bridge/responsive-browser evidence only; native SDK work was declined.
- Local mainnet account 0 uses pinned official Pearl wallet/Neutrino/native verifiers and inherits upstream SPV assumptions. Hosted mode trusts fixed public-indexer chain/history answers while checking genesis, raw bytes, ownership and consistency. The hosted WebView does not run the native helper.

The hosted adapter reuses the existing allowlisted proxy and introduces no second signing engine, general RPC/URL proxy, application database, account profile, wallet/history cache, cron or analytics integration. Browser account metadata, remembered Sync preference, display cache and durable journal remain origin-local. Cached data restores no device or spending authority. Moving origins/profiles does not automatically transfer reservations.

The added runtime dependency is lazy `jsqr@1.4.0`, with no runtime dependencies of its own. QR images/frames are decoded locally and not uploaded; decoding only fills the reviewed form. Receive copy/QR still requires device verification. The new modules reuse existing wallet, transport, exact-integer, input-preflight and durable-journal code. No production demos, gratuitous framework or duplicate custody workflow were found. The large existing main controller was not rewritten during this release.

## Final behavior

Portfolio **Balance** is total source-reported unspent owned value, including pending change, immature rewards and locally reserved inputs. Send separately uses confirmed, mature, unreserved inputs. The portfolio does not subtract an unsigned reservation or label its whole input network-pending, and no optimistic payment/change arithmetic is added.

Hosted discovery presents one **Sync** action; successful public discovery remembers that choice. Local native/default source selection is unchanged. The data/privacy distinction remains documented without extra sharing controls in the normal hosted flow.

Fast/Medium/Slow use live 1/10/25-block fee quotes. Fresh Medium is the default; Standard is a labeled relay-floor fallback. Exact total fees update with input/output shape and amount; Max reprices the recipient and Custom preserves the entered total. Equal-priced options remain. Brief times (`≈3 min`, `≈32 min`, `≈1 h 21 min`) derive from the pinned 194-second block target, not measured mining pace or a countdown. Quote lifetime is 120 seconds; only a visible unprepared Amount step refreshes an anonymous batch around the absolute 105-second deadline, with busy deferral and stale-context guards. Prepared payments never reprice. The health predicate correctly limits the local label to account 0, and amount edits preserve each option's ETA child.

A current initial attempt can clear atomically before adapter signing is invoked or after engine unwind with no complete verified app result, only while record/attempt ownership remains exact and no signed result is staged or persisted. This is not a claim that no partial signature was ever emitted. Complete results, callback/ACK failures, recovery/historical uncertainty and concurrent changes remain protected. Older user records were not automatically changed. [Result-policy review](explicit-rejection-review.md), [adapter review](signing-result-adapter-review.md).

The public pending monitor is visible/idle-only, with at most four rotating known-transaction reads per 60 seconds and one early check for a newly tracked payment. It excludes hidden, Receive, unsigned/device-review and emergency-recovery contexts. A validated changed hint can trigger one coherent full scan/reconciliation per cycle; it cannot authorize spending, retry/broadcast or release reservations. Owned submissions remain tracked until archival; incoming history-only entries stop after first confirmation. Missing/failed reads preserve prior state. Manual payment-status refresh obtains fresh public/local discovery under a 300-second budget. Later reorgs after monitoring stops need fresh sync. [Pending-status review](../pending-status-review/README.md).

## Evidence reviewed

- Final local `npm run check`: **587/587**, reported by the parent. [Current CI](https://github.com/divij-mot/ledgerPRL/actions/runs/38093601532) is linked without a completion assertion.
- This reviewer executed **24/24 actual-main result/balance cases**, the normal wrapper, and **15/15 composed histories** with unchanged before/after/current production source. Two legacy recovery wrappers passed all **18 and 19** underlying probes after only their obsolete stale-initial-record expectations were corrected.
- This reviewer executed **8 launcher** and **2 actual-entry/fake-server/opener** tests. The recorded **16/16 C-firmware → real Pearl v1.4.11 regtest** cases include exact display, signing, damaged-signature rejection, node acceptance and mined confirmation; they retain their original source/node/ELF identities and are separate from historical Rust qualification. [Simulator evidence](simulator/README.md).
- Separate wallet/adapter/pending reviews record their own executed tests and hashes. The pending reviewer reported 23 focused tests and 10 top-level wrapper/scheduler checks; this reviewer read that evidence rather than independently repeating those suites.
- Current production passed **17/17 live checks** and **15/15 public-file matches**, totaling **2,227,051 bytes**. The parent observed the corrected Balance, single Sync and available services after reloading Chrome. The sender wallet's synced view showed the outgoing entry confirmed; no independent recipient-wallet observation is claimed.
- The owner-approved Pearl 0.1.0 Nano S Plus OS 1.7.0 account/Receive checkpoint remains distinct from broad device qualification. Pearl Dev was removed at the owner's request while Pearl's installed-app hash stayed unchanged. No private transaction details are recorded.

The earlier `e6b0ff1` release had 568 local checks and its own 17/15 live/artifact checks; its all-four-jobs CI success is historical, not a substitute for the current CI result.

## Limits and attribution

An empty fixture scan measured 46 reads/10,760 response bytes plus six fee reads/1,003 bytes, combined 3.677 seconds. Active fee/pending checks, changed-status scans, used accounts and pre-signing checks add work. These are measurements, not unlimited free-tier, uptime, full-history or account-wide abuse-quota guarantees. Infrastructure can retain request metadata, and the indexer receives public address queries.

The regenerated supply inventory has 762 structural checks, 774 main/shared modules, 27 worker modules, 50 CSS inputs and 49 npm package instances. The [core MIT attribution gap](../dependency-supply-review/core-attribution-recheck.json) remains unresolved; no unrelated license or invented copyright was assigned. This is not a blanket licensing/reuse audit.

Native Android, other devices/OS versions, worst-case input/resource and complete fault/restore coverage, and independent human/vendor review remain bounded or open. History still lacks general timestamps/fees; owned P2MR/XMSS, arbitrary scripts/messages, RBF and unbounded discovery are outside the profile. This final documentation pass reran no audit, changed no production source/notices and performed no deployment.
