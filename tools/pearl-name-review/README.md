# Pearl 0.1.0 identity checkpoint

On 10 October 2026, the device app names became **Pearl**, **Pearl T1**, **Pearl T2**, **Pearl Reg** and **Pearl Sim**, with version **0.1.0**. Wallet API requests now use those exact names. The device menu retains Version, Network and the Ledger Bitcoin base; development-status copy was removed. No Ledger approval or release qualification is implied by the name.

The firmware source differs from the preceding checkpoint only in `Makefile` and `src/ui/menu_nbgl.c`. Spending policy, paths, APDU guards, ownership checks, review flow and signatures are unchanged. The build recipe explicitly sets `DEBUG=0 DEBUG_OVER_USB=0`; the existing autoapproval prohibition remains. Test tooling and validation guards were retained.

## Results

| Check | Result |
| --- | --- |
| Wallet API / transport routing | 19 tests passed; all five network names remain explicit |
| Mainnet and regtest Nano S Plus builds | Passed using the pinned API27 SDK and official isolated builder |
| Actual ELF metadata | Mainnet `Pearl`, regtest `Pearl Reg`, version `0.1.0`, API27, unchanged `0x40` app flags |
| Account, full Receive and two-input signing | Passed on mainnet/regtest, each with P2TR and P2MR recipients; independently verified signatures/final bytes |
| Hostile native requests | All 75 cases rejected; firmware remained responsive |
| Explicit rejection, then fresh approval | Passed with the renamed regtest ELF |
| Historical candidates | Six old ELF/HEX/map artifacts verified unchanged; no evidence overwritten |

Both builds bind source-set SHA-256 `92b1d36722c1ea6865bd381966ddb3933a828f5a2313aa34a70a4308362e39f7`.

| Artifact | SHA-256 |
| --- | --- |
| Mainnet ELF | `0f58a289227ccd78a6e66735cb3b7db95f849b9890d454299e83ef15edbd3271` |
| Mainnet HEX | `04c121196c75d71776921e78425d3b8b972d3921aa19acbac7d690c546e98174` |
| Regtest ELF | `77e2dc35fed3443440a1393c42ed6cf03fad13ecf5532a84dab7de014890ce14` |
| Regtest HEX | `09b14ab49f143290a5778c5979fc18da70f932ee544d350529e437850c27f2ea` |

The artifacts remain in `/private/tmp/pearl-name-review-q4wm1ypq/workspace/apps/ledger-bitcoin-prl/build-artifacts/`. Full build manifests, metadata, test results, display events and source hashes are retained here. Binary snapshots, original screenshots and bulk build logs remain in that isolated workspace.

## Reproduce

Use a fresh dedicated source copy at `/workspace`, never the prior candidate workspace. [runtime.json](runtime.json) records the immutable builder image, SDK, Node and Speculos versions. Mount the clean SDK at `/sdk`, Linux Node at `/runtime`, the lockfile-verified esbuild binary directory at `/esbuild`, and locked dependencies at `/workspace/node_modules`. The container has no network, USB/device or Docker-socket mounts, a read-only root and SDK, dropped capabilities, and only the dedicated source/evidence directory writable.

Run [replay.sh](replay.sh) inside that container. It builds both networks, executes four positive pilots, the hostile-request suite and rejection/fresh approval. All fixture signing uses the published deterministic test seed; never fund those addresses. Run [inspect-metadata.py](inspect-metadata.py) against each resulting ELF to verify the compiled name/version/API/flags, including absence of the old development identity.

## Physical installation remains pending

No USB operation, device installation, firmware update, seed reset or funded transaction occurred. The owner's Nano S Plus still contains **Pearl Dev**, whose earlier physical evidence remains valid only for that old artifact. The new Wallet API name intentionally does not fall back to it. Installing Pearl 0.1.0 requires the owner's physical confirmation; the renamed binary has not been hardware-qualified. Other device models, worst-case input/resource tests, restoration and funded live-chain behavior remain separate gates.
