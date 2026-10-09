#!/usr/bin/env bash
# Deterministic public fixtures only. No daemon, mining, network peers, keys or broadcast.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${PEARL_COMPAT_WORK:-$HERE/.replay}
mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)
GO_BIN=${GO_BIN:-go}
[[ "$("$GO_BIN" version)" == 'go version go1.26.6 '* ]] || { echo 'Use Go 1.26.6 for this recorded matrix.' >&2; exit 1; }
export GOPATH=${GOPATH:-$WORK/gopath} GOMODCACHE=${GOMODCACHE:-$WORK/gomodcache} GOCACHE=${GOCACHE:-$WORK/gocache}
export GOTMPDIR=$WORK/tmp TMPDIR=$WORK/tmp GOTOOLCHAIN=local GOWORK=off GOFLAGS=-buildvcs=false
export GOPROXY=${GOPROXY:-https://proxy.golang.org} GOSUMDB=${GOSUMDB:-sum.golang.org}
mkdir -p "$GOTMPDIR" "$WORK/results"
UPSTREAM=${PEARL_UPSTREAM_GIT:-$WORK/upstream}
if [[ ! -d "$UPSTREAM/.git" ]]; then
 [[ -z "${PEARL_UPSTREAM_GIT:-}" ]] || { echo 'Supplied upstream is not a Git checkout.' >&2; exit 1; }
 git clone --no-checkout https://github.com/pearl-research-labs/pearl.git "$UPSTREAM"
fi
SNAPSHOTS=${PEARL_COMPAT_SNAPSHOTS:-$WORK/snapshots}
mkdir -p "$SNAPSHOTS"
for spec in released:2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4 current:2f8b770cac8f8b74be05c1fc51c2baeb76ce0701 fp8:684f7045f3b3b7c5b7598f46c06b7dceb506f74b; do
 ref=${spec%%:*}; sha=${spec#*:}; snapshot=$SNAPSHOTS/$ref
 if [[ ! -d "$snapshot" ]]; then
  mkdir -p "$snapshot"
  GIT_NO_LAZY_FETCH=1 git -C "$UPSTREAM" archive "$sha" | tar -x -C "$snapshot"
 fi
 # Supplied/reused snapshots are untrusted input: reject every extra file,
 # symlink and directory as well as missing, changed or type-swapped entries.
 python3 "$HERE/verify-snapshot.py" "$UPSTREAM" "$sha" "$snapshot" > "$WORK/results/$ref-supplied-source.json"
 # Never compile the caller's mutable snapshot. Export a fresh private source
 # directory directly from the pinned Git object and check it independently.
 snapshot=$(mktemp -d "$WORK/source-$ref.XXXXXX")
 GIT_NO_LAZY_FETCH=1 git -C "$UPSTREAM" archive "$sha" | tar -x -C "$snapshot"
 python3 "$HERE/verify-snapshot.py" "$UPSTREAM" "$sha" "$snapshot" > "$WORK/results/$ref-source-before.json"
 for kind in oracle policy edge; do
  probe=$(mktemp -d "$WORK/probe-$ref-$kind.XXXXXX")
  cp "$HERE/probes/$kind.go" "$probe/main.go"
  cp "$HERE/locks/$ref/$kind/go.mod" "$HERE/locks/$ref/$kind/go.sum" "$probe/"
  (
   cd "$probe"
   "$GO_BIN" mod edit "-replace=github.com/pearl-research-labs/pearl=$snapshot"
   "$GO_BIN" build -mod=readonly -o probe .
   "$GO_BIN" version -m ./probe > "$WORK/results/$ref-$kind-build-info.txt"
   case $kind in
    oracle) ./probe "$HERE/fixtures/fixture.json" ;;
    policy) ./probe "$HERE/fixtures/cases.json" "$WORK/results/$ref-policy.json" "$sha" ;;
    edge) ./probe "$HERE/fixtures/address-vectors.json" "$HERE/fixtures/cases.json" "$WORK/results/$ref-edge.json" "$sha" ;;
   esac
  ) > "$WORK/results/$ref-$kind.log" 2>&1
  python3 "$HERE/verify-snapshot.py" "$UPSTREAM" "$sha" "$snapshot" > "$WORK/results/$ref-source-after-$kind.json"
  cmp "$WORK/results/$ref-source-before.json" "$WORK/results/$ref-source-after-$kind.json"
 done
 if [[ "${RUN_UPSTREAM_TESTS:-0}" == 1 ]]; then
  (
   cd "$snapshot"
   "$GO_BIN" test -mod=readonly -count=1 ./node/txscript ./node/btcutil/hdkeychain ./node/chaincfg ./node/mempool
   "$GO_BIN" test -mod=readonly -count=1 ./node/wire -run '^(TestTx|TestMsgTx|TestReadTx|TestWriteTx|TestOutPoint|TestTxIn|TestTxOut)'
   "$GO_BIN" test -mod=readonly -count=1 ./node/btcutil -run '^(TestAmount|TestNewAmount|TestAddress|TestDecodeAddress|TestTaproot|TestTx)'
  ) > "$WORK/results/$ref-focused-tests.log" 2>&1
 fi
 python3 "$HERE/verify-snapshot.py" "$UPSTREAM" "$sha" "$snapshot" > "$WORK/results/$ref-source-final.json"
 cmp "$WORK/results/$ref-source-before.json" "$WORK/results/$ref-source-final.json"
 echo "$ref: passed"
done
python3 - "$HERE" "$WORK/results" <<'PY'
import collections,json,pathlib,sys
here,out=map(pathlib.Path,sys.argv[1:])
policies=[]
for ref in ['released','current','fp8']:
 expected=json.loads((here/'summaries'/f'{ref}.json').read_text())
 policy=json.loads((out/f'{ref}-policy.json').read_text());edge=json.loads((out/f'{ref}-edge.json').read_text())
 assert policy['upstreamCommit']==expected['upstreamCommit']
 assert len(policy['cases'])==81
 assert dict(collections.Counter(c['actual'] for c in policy['cases']))==expected['policyOutcomes']
 assert edge==expected['edgeChecks']
 policies.append(policy['cases'])
assert policies[0]==policies[1]==policies[2]
print('Verified identical policy outcomes and the recorded address/tamper/range results across all three refs.')
PY
printf 'Replay results: %s\n' "$WORK/results"
