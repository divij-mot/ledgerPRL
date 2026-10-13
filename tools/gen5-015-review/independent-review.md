# Independent review: numbered Pearl 0.1.5 candidate

Reviewed 2026-10-12. No additional preparation blocker was found. The owner-requested plain version label does not establish stability or public-release qualification. This review identifies the exact candidate for an installation decision; it is not a loader action or a claim that the earlier reset is explained.

The only source change from the reviewed RC1 candidate is removal of `-rc1` from the Makefile version string. Compared with base `b0ad28c4db61096b72dbad18fd0b45847e62667f`, only patch version 4→5 differs. All C, guard, permissions and dependencies are unchanged. The RC1 artifacts and aggregate remain intact; its [independent report](../gen5-015-rc1-review/independent-review.md) is historical evidence for different bytes.

I independently checked all 167 source-manifest entries against the new build tree/current checkout and the base commit, treating the glyph symlink separately. Source-before/after snapshots match. ELF and HEX hashes match the new manifest. Parsing the actual ELF confirms **Pearl 0.1.5**, Gen5 `apex_p`, target `0x33400004`, API27, SDK `6709cd2b…`, flags `0x240`. The linker map independently confirms **512 bytes of data and 106 bytes of installation parameters**. RC1's 110-byte parameter size must not be reused. Native preparation reports full installation hash `298c8bd35b93f0632567d18491d10dbbbf90a6a37fe272407a578353b1fe971d`; that loader-format computation is attributed to native preparation, while artifact bytes and compiled identity were independently checked here.

The fresh normal simulator pilot passes B001 identification as Pearl/0.1.5, public-account export, Receive and two independently verified signatures. Its private test-only change from the RC1 pilot is the expected version string. Six focused cases pass again on this image: nested account keypath, replacement-transaction approve, replacement-transaction deny, Receive cancel then new index, QR nested busy, and unfiltered QR busy followed by explicit cancellation. All seven retained tested ELF snapshots independently match the candidate ELF hash below. The tests retain the same assertions and public fixtures.

Some cases use synthetic busy-response demultiplexing, which tests original-command binding rather than production host recovery. The unfiltered case explicitly cancels before a fresh request. No phone BLE stack or retail OS/reset behavior is established by these simulations. This reviewer performed only source/artifact/result inspection, with no builds, test execution, hardware commands or broadcasting.

The [seven-day test-wallet acceptance criteria](../gen5-015-rc1-review/independent-review.md#seven-day-test-wallet-acceptance-criteria) apply to this separately identified image: exact installed hash/metadata first, owner-controlled signing and payments, ordinary reconnect/background recovery, explained reservations/history, and a separately reviewed QR checkpoint. No forced power-hold or induced QR/disconnect reproduction is included. Seven elapsed days alone is not a pass. The owner has authorized limited testing; professional application/security and native-OS incident review remain gates before recommending general wallet use or public release. `release.json` is unchanged and has not been promoted.

## Exact evidence

New raw evidence is retained under `/private/tmp/pearl-015-numbered-9cks6p5q`; RC1 remains under its separate directory.

| File | SHA-256 |
| --- | --- |
| `Makefile` | `31b1944212bea2b0ca2dfc25c15fd40a3b7e9700d99bd21082339a688b20c2ca` |
| `app.elf` | `273c4193b813593f937340b8eecd1c84f42c6c75812d7eae0bf4c45c74f02a17` |
| `app.hex` | `335787d76a0c9045a2f85cdbdc150edfd1c759f6f9b63bff5862d76f35bd47d7` |
| `manifest.json` | `1e1e498ffe59765d2943a4170443b47996fe727929503483f1aa067d005749bc` |
| `metadata.json` | `32f30259093a8964b1964021c6eaa6f589b451a5c2a970422886dccca19761ce` |
| `normal/result.json` | `ed64bb30c43019171d519aa24389d3ee39f7f92c63ca82c2cb371bf37f08e0bb` |
| `normal/identity.json` | `d1a9abc5596898ac0f926c2ec49c6519b7d114f573d54e0fed558646eabe4460` |
| `parity/result.json` | `21145ac2359fb8e4578da400561dfd319980071b7e40800b6a6a5173bb2b61fd` |

Final native aggregate `qualification.json`: SHA-256 `f0a378088d5c65db6358d15ff3ff56945ff7c7692d61762c4ee32689444e79fa`. Its test-source graph, private pilot distinction and normal/identity/parity result bindings independently match the retained files. RC1 aggregate hash remains unchanged.
