#!/usr/bin/env python3
"""Apply the specifically authorized one-line Pearl change notice; no native execution."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
NOTICE = b"/* Modified for Pearl (PRL). Upstream provenance: UPSTREAM.json. */\n"


def sha(data):
    return hashlib.sha256(data).hexdigest()


inventory = json.loads((HERE / "source-notices.json").read_text())
selected = inventory["minimumMissingNoticeFiles"]
expected = {item["file"]: item for item in inventory["modifiedUpstreamFiles"]}
assert len(selected) == 33 and len(set(selected)) == 33
originals = {}
for name in selected:
    assert name.startswith("apps/ledger-bitcoin-prl/src/")
    path = ROOT / name
    data = path.read_bytes()
    assert sha(data) == expected[name]["currentSha256"], f"Source changed since inspection; stop before editing: {name}"
    assert not data.startswith(NOTICE), f"Already modified; stop: {name}"
    originals[name] = data

for name, data in originals.items():
    path = ROOT / name
    assert path.read_bytes() == data, f"Concurrent edit before write: {name}"
    path.write_bytes(NOTICE + data)

mapping = []
for name, before in originals.items():
    after = (ROOT / name).read_bytes()
    assert after == NOTICE + before, f"Unexpected bytes after notice addition: {name}"
    assert after[len(NOTICE):] == before, f"Original bytes not preserved: {name}"
    mapping.append({
        "file": name, "upstreamBlob": expected[name]["upstreamBlob"],
        "beforeSha256": sha(before), "afterSha256": sha(after),
        "beforeBytes": len(before), "afterBytes": len(after),
        "check": "PASS: removing exactly the prepended notice restores every original byte",
    })

report = {
    "schema": 1, "reviewDate": "2026-10-09", "upstreamCommit": inventory["upstreamCommit"],
    "notice": NOTICE.decode(), "noticeBytes": len(NOTICE),
    "filesChanged": len(mapping), "mapping": mapping,
    "transformation": "Prepend one C block-comment line. Preserve the complete original file as an identical byte suffix.",
    "verification": "All 33 exact prefix-and-original-suffix equality checks passed. This is stronger than a token/whitespace-only comparison and preserves all original copyright/license bodies.",
    "limits": ["No copied TypeScript host module was edited.",
               "No native build, emulator, firmware, or C execution occurred.",
               "Comments shift source line numbers and change source hashes; prior binary/source qualification is not silently rebound to these files.",
               "This is attribution bookkeeping, not legal certification or a selected project license."],
}
(HERE / "source-notice-transformation.json").write_text(json.dumps(report, indent=2) + "\n")
print(f"PASS: added the authorized notice to {len(mapping)} files; every original file byte is preserved.")
