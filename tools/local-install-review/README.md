# GitHub ZIP local setup verification

The private repository’s authenticated GitHub source archive for `c6cd6e8` was downloaded, and all 2,095 tracked file blobs were compared with that commit. The 5,485,490-byte ZIP contained no Git metadata, installed npm dependencies or native build cache. Its one internal image symlink was checked before extraction.

On macOS/arm64 with the documented Node/Python/Go/Rust/C/C++ prerequisites installed, `python3 scripts/run-local.py` installed the lockfile with lifecycle scripts disabled, built the pinned native verifiers and helper, ran its native tests, built the frontend, started the loopback server, and automatically opened the browser at the normal address. The page displayed “Add your Pearl account.” Package-manager download caches and installed toolchains were not removed; this is a clean project install, not a new-OS test.

A read-only public-fixture request through the actual local API started the newly built helper. It connected to eight Pearl peers and began verified header synchronization. The test closed that account, stopped its server, and restored the original local instance. No device, private signing key, personal account, or broadcast was used. This did not repeat the earlier complete cold-chain sync; that evidence remains in the separate local-mainnet review.

The final launcher adds only early checks for `ar`, `/usr/bin/gcc`, and `/usr/bin/g++`. Its nine isolated tests cover these checks, a missing Git executable and absent `.git`, cache reuse and rejection of unsafe paths. The final launcher independently recognized this newly built helper as current. The browser opener also has two existing Node tests. No global toolchain or shell-profile change is made by the launcher.

`result.json` identifies the source archive, both launcher revisions and built helper. `fresh-setup.txt` is the successful build/start output with local paths normalized; `native-probe.json` contains only public-fixture status. A passing setup test is not an independent security audit, Android qualification, or a claim that all hardware/OS combinations work.
