#!/usr/bin/env python3
"""Read-only verification of the exact authorized comment-only transformation."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
report = json.loads((Path(__file__).resolve().parent / "source-notice-transformation.json").read_text())
notice = report["notice"].encode()
assert report["filesChanged"] == len(report["mapping"]) == 33
for item in report["mapping"]:
    data = (ROOT / item["file"]).read_bytes()
    assert data.startswith(notice), item["file"]
    assert hashlib.sha256(data).hexdigest() == item["afterSha256"], item["file"]
    assert hashlib.sha256(data[len(notice):]).hexdigest() == item["beforeSha256"], item["file"]
    assert len(data) == item["afterBytes"] and len(data[len(notice):]) == item["beforeBytes"]
print("PASS: all 33 post-notice hashes match and removing the exact notice restores the recorded original bytes.")
