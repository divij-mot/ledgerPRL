# Validation of the compact replay/check tools

Validated on 2026-10-09 using the same installed builder as the main audit:

1. verify.py independently verified all 25 retained reference/canonical package pairs: 25/25 passed. Exact report: evidence/parameterized-verifier-all25.json.
2. The same verifier checked the four different-path artifact/package pairs and correctly returned exit code 1 with 0/4 matches. Report: evidence/parameterized-verifier-negative.json.
3. replay.py made a new private clone/cache/SDK copy, used its clean allowlisted environment, and reproduced Nano S Plus/mainnet ELF, load image, application hash, manifest and full package exactly.
4. A second replay reproduced Nano X/simnet with spaces in the caller-local private output path. This exercises a second architecture/network and path-safe argument handling. Compact smoke reports are recorded in evidence/replay-tool-validation.json; payloads and full logs remain outside this folder.
5. Reusing an existing output directory is rejected with exit code 2 before building or replacing evidence.
6. Invoking canonical_build.py outside its private mount namespace is rejected before any build. No parent source changes occur.
7. Every Python source is AST-parsed; the folder contains only text/source files. check_evidence.py validates SHA256SUMS and the recorded 25-variant and four-path-failure result sets. Altering a copied evidence file causes that checker to fail.

The new parameterized replay driver was smoke-tested on two variants; the original fixed-run audit rebuilt all 25. The configurable independent verifier was tested on the entire 25-variant payload matrix. No hardware testing, publication, tool downloads or standalone container-image test is implied.
