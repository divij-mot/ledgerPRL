#!/bin/bash
set -euo pipefail
export PATH=/runtime/bin:/usr/lib/llvm-21/bin:$PATH
export BOLOS_SDK=/sdk PRL_SYSROOT=/usr/lib/arm-none-eabi
export ESBUILD_BINARY_PATH=/esbuild/bin/esbuild
cd /workspace
tools/bitcoin-prl-port/build.sh nanos2 mainnet
tools/bitcoin-prl-port/build.sh nanos2 regtest
export SPECULOS_MODEL=nanosp
for network in mainnet regtest; do
 export PEARL_TEST_NETWORK=$network
 export PEARL_APP_ELF=/workspace/apps/ledger-bitcoin-prl/build-artifacts/nanos2-$network/app.elf
 for recipient in p2tr p2mr; do
  PEARL_TEST_RECIPIENT=$recipient PEARL_EVIDENCE=/workspace/evidence/$network-$recipient node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-pilot.ts
 done
done
export PEARL_APP_ELF=/workspace/apps/ledger-bitcoin-prl/build-artifacts/nanos2-regtest/app.elf
PEARL_EVIDENCE=/workspace/evidence/adversarial node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-adversarial.ts
PEARL_EVIDENCE=/workspace/evidence/rejection PRL_FAULT_CASE=deny-and-restart-cleanly node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-review-faults.ts
