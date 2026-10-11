#!/usr/bin/env python3
"""Inspect local modification notices; never edit source or execute native code."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
APP = ROOT / "apps/ledger-bitcoin-prl"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def blob_hash(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


tree = {line.split("\t", 1)[1]: line.split()[2]
        for line in (APP / "UPSTREAM_TREE.txt").read_text().splitlines()}
upstream = json.loads((APP / "UPSTREAM.json").read_text())
changed, unchanged, absent = [], [], []
for relative, original in sorted(tree.items()):
    if Path(relative).suffix not in (".c", ".h"):
        continue
    path = APP / relative
    if not path.is_file():
        absent.append(relative)
        continue
    data = path.read_bytes()
    if blob_hash(data) == original:
        unchanged.append(relative)
        continue
    source = data.decode()
    comments = []
    for match in re.finditer(r"/\*[\s\S]*?\*/|//[^\n]*", source):
        if re.search(r"Pearl|\bPRL\b|local changes|provenance|adaptation|modified for", match.group(), re.I):
            comments.append({"line": source[:match.start()].count("\n") + 1,
                             "text": match.group()})
    prominent = [comment for comment in comments
                 if comment["line"] <= 25
                 and re.search(r"Pearl adaptation|Modified for Pearl", comment["text"], re.I)]
    changed.append({"file": str(path.relative_to(ROOT)), "upstreamBlob": original,
                    "currentBlob": blob_hash(data), "currentSha256": sha(data),
                    "localContextComments": comments, "prominentChangeNotice": prominent,
                    "minimumRecommendation": "No additional change notice identified as necessary in this engineering check"
                    if prominent else "Add a short prominent Pearl modification notice; preserve original notices"})

new_files = []
for path in sorted((APP / "src").rglob("*")):
    if path.is_file() and path.suffix in (".c", ".h") and str(path.relative_to(APP)) not in tree:
        data = path.read_bytes()
        new_files.append({"file": str(path.relative_to(ROOT)), "sha256": sha(data),
                          "firstLines": data.decode().splitlines()[:6]})

host = ROOT / "packages/bitcoin-prl-adapter"
host_provenance = json.loads((host / "provenance/upstream.json").read_text())
host_files = []
for relative, recorded in host_provenance["files"].items():
    path = host / "src/upstream" / relative
    data = path.read_bytes()
    prefix = data.decode().splitlines()[:2]
    assert sha(data) == recorded["adaptedSha256"], f"Host provenance changed: {relative}"
    assert host_provenance["revision"] in prefix[0]
    assert "local changes recorded in provenance/upstream.patch" in prefix[1]
    host_files.append({"file": str(path.relative_to(ROOT)), "sha256": sha(data),
                       "changeNoticeLines": prefix, "minimumRecommendation": "Retain existing prominent change notice"})

missing = [entry["file"] for entry in changed if not entry["prominentChangeNotice"]]
result = {
    "schema": 1,
    "reviewDate": "2026-10-09",
    "scope": "Technical presence/location review of modification notices, not legal certification or a choice of project license.",
    "upstreamCommit": upstream["commit"],
    "upstreamTreeSha256": sha((APP / "UPSTREAM_TREE.txt").read_bytes()),
    "licenseSha256": sha((APP / "LICENSE").read_bytes()),
    "counts": {"modifiedUpstreamCOrHeaders": len(changed), "missingProminentChangeNotice": len(missing),
               "unchangedUpstreamCOrHeaders": len(unchanged), "absentUpstreamCOrHeaders": len(absent),
               "newLocalCOrHeaders": len(new_files), "copiedHostModulesWithChangeNotices": len(host_files)},
    "modifiedUpstreamFiles": changed, "minimumMissingNoticeFiles": missing,
    "newLocalFiles": new_files, "copiedHostModules": host_files,
    "limitations": ["Comparison is against retained upstream Git-blob metadata, with no refetch.",
                    "Absence of a same-path upstream file does not establish wholly original authorship.",
                    "Comments are manually assessed for an explicit early change statement; incidental PRL identifiers and late policy comments are not treated as such a statement.",
                    "Source is changing concurrently; hashes identify this inspection, not later edits."]
}
# Preserve the frozen pre-change source-notices.json and missing-source-notices.txt.
(HERE / "source-notices-current.json").write_text(json.dumps(result, indent=2) + "\n")
(HERE / "missing-source-notices-current.txt").write_text("\n".join(missing) + ("\n" if missing else ""))
print(json.dumps(result["counts"], indent=2))
print("\nMinimum files needing explicit early modification notices:")
print("\n".join(missing))
