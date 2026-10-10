#!/usr/bin/env python3
"""Conservative pre-push scan of tracked source. Not a substitute for review."""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
PATTERNS = {
    "private key PEM": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b"),
    "AWS access key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "credential in URL": re.compile(r"https?://[^\s/@:]+:[^\s/@]+@"),
}
files = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).split(b"\0")
findings = []
for raw in filter(None, files):
    path = ROOT / raw.decode()
    if not path.is_file() or path.name == "secret_scan.py":
        continue
    if path.name.startswith(".env") and path.name != ".env.example":
        findings.append(f"{path.relative_to(ROOT)}: forbidden environment file")
    content = path.read_text(errors="replace")
    # Exact public negative-test URL, not a live credential. No wildcard exceptions.
    if str(path.relative_to(ROOT)) == "packages/sdk/test/device.test.ts":
        content = content.replace("http://user:password@localhost:5000", "PUBLIC_NEGATIVE_URL_FIXTURE")
    if str(path.relative_to(ROOT)) == "apps/companion/test/bridge.test.ts":
        content = content.replace("https://name:secret@example.com", "PUBLIC_NEGATIVE_URL_FIXTURE")
    if str(path.relative_to(ROOT)) == "apps/companion/test/web-server.test.ts":
        content = content.replace("https://u:p@wallet.example.com", "PUBLIC_NEGATIVE_URL_FIXTURE")
    if str(path.relative_to(ROOT)) == "apps/companion/test/local-light.test.ts":
        content = content.replace("http://user:pass@127.0.0.1:5188", "PUBLIC_NEGATIVE_URL_FIXTURE")
    for label, pattern in PATTERNS.items():
        if pattern.search(content):
            findings.append(f"{path.relative_to(ROOT)}: possible {label}")
if findings:
    print("\n".join(findings), file=sys.stderr)
    sys.exit(1)
print(f"Secret-pattern scan passed for {len(files) - 1} tracked files; manual review still required.")
