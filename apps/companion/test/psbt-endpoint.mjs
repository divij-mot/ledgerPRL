/** Test-only Ledger Bitcoin PRL endpoint. No device, key material or network.
 * Frozen public-vector signatures and pinned official Python Merkle responses.
 * Every SIGN_PSBT commitment and host continuation is checked byte-for-byte.
 * This models a device boundary; it does not execute or qualify native firmware.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base58check } from "@scure/base";
import * as sdk from "../../../packages/sdk/src/index.ts";
import {
  BITCOIN_PRL_PROTOCOL as P,
  buildPrlPsbt,
  serializePrlPsbt,
  createPrlWalletPolicy,
} from "../../../packages/bitcoin-prl-adapter/src/index.ts";

export { P };
export const publicFixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
export const psbtFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/bitcoin-prl-adapter/test/fixtures/ledger-psbt-v2.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const { transcript } = JSON.parse(
  readFileSync(
    new URL("./fixtures/psbt-apdu-public.json", import.meta.url),
    "utf8",
  ),
);
export const ok = (bytes = new Uint8Array()) =>
  sdk.concat(bytes, Uint8Array.of(0x90, 0));
export const interrupted = (bytes) => sdk.concat(bytes, Uint8Array.of(0xe0, 0));
export function networkInfo(name = "regtest") {
  const bytes = new Uint8Array(58),
    view = new DataView(bytes.buffer),
    net = sdk.NETWORKS[name];
  bytes.set(new TextEncoder().encode("PRLB"));
  bytes[4] = 1;
  bytes[5] = net.id;
  view.setUint32(6, net.coinType);
  bytes.set(sdk.fromHex(net.genesisHash), 10);
  view.setBigUint64(42, sdk.MAX_GRAINS);
  view.setUint16(50, 16);
  view.setUint16(52, 2);
  view.setUint32(54, 3);
  return bytes;
}
function publicXpub(account) {
  // Copy only PUBLIC serialized metadata; no seed derivation or signing fallback.
  const base58 = base58check(sdk.sha256),
    bytes = base58.decode(psbtFixture.accountXpub);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(0, account.network === "mainnet" ? 0x0488b21e : 0x043587cf);
  view.setUint32(9, 0x80000000 + account.account);
  bytes.set(account.chainCode, 13);
  bytes.set(account.publicKey, 45);
  return base58.encode(bytes);
}
export function createPsbtEndpoint(options = {}) {
  const account = structuredClone(
    options.account ?? sdk.accountFromJson(publicFixture.publicAccount),
  );
  const bundle = sdk.bundleFromJson(publicFixture.bundle);
  const signatures = (options.signatures ?? publicFixture.signatures).map(
    (s) => (typeof s === "string" ? sdk.fromHex(s) : s.slice()),
  );
  const commands = [],
    apdus = [],
    stages = [];
  let closes = 0,
    requestIndex = 0,
    nextYield = 0,
    pendingResponse,
    signing = false,
    acknowledgements = 0;
  let activeTranscript = transcript,
    addressRequest;
  const keyHash = sdk.hex(
    sdk.sha256(
      sdk.concat(
        Uint8Array.of(0),
        new TextEncoder().encode(psbtFixture.policyKey),
      ),
    ),
  );
  const policyHashes = new Set([
    psbtFixture.policyId,
    sdk.hex(sdk.sha256(new TextEncoder().encode("tr(@0/**)"))),
    keyHash,
  ]);
  const policyTranscript = transcript.filter((entry) =>
    entry.request.startsWith("4000")
      ? policyHashes.has(entry.request.slice(4))
      : ["41", "42"].includes(entry.request.slice(0, 2)) &&
        entry.request.slice(2, 66) === keyHash,
  );
  const stage = async (name, index) => {
    stages.push({ name, ...(index === undefined ? {} : { index }) });
    return options.onStage?.(name, index);
  };
  async function next() {
    if (requestIndex < activeTranscript.length) {
      const entry = activeTranscript[requestIndex++];
      pendingResponse = entry.response;
      return interrupted(sdk.fromHex(entry.request));
    }
    if (addressRequest) {
      const requested = addressRequest;
      addressRequest = undefined;
      signing = false;
      const custom = await stage("address", requested);
      return custom ?? ok(new TextEncoder().encode(requested.address));
    }
    if (nextYield < signatures.length) {
      const index = nextYield++;
      const custom = await stage("signature", index);
      if (custom) return custom;
      pendingResponse = "";
      return interrupted(
        sdk.concat(
          Uint8Array.of(0x10, index, 32),
          bundle.inputs[index].scriptPubKey.slice(2),
          signatures[index],
        ),
      );
    }
    acknowledgements++;
    const custom = await stage("ack");
    signing = false;
    return custom ?? ok();
  }
  const transport = {
    async close() {
      closes++;
      await options.onClose?.();
    },
    async exchange(apdu, signal) {
      assert(
        !signal?.aborted,
        "Canceled signal must never reach the device endpoint",
      );
      assert.equal(apdu[2], 0);
      assert.equal(apdu[3], P.version);
      assert.equal(apdu[4], apdu.length - 5);
      apdus.push(apdu.slice());
      commands.push(apdu[1]);
      const data = apdu.slice(5),
        ins = apdu[1];
      if (apdu[0] === P.cla && ins === P.SIGN_PSBT)
        assert.equal(
          sdk.hex(apdu),
          psbtFixture.signPsbtApduHex,
          "Exact frozen PSBT/policy commitment required before any review response",
        );
      const custom = await options.onCommand?.(ins, data, apdu);
      if (custom) return custom;
      if (apdu[0] === P.FRAMEWORK_CLA) {
        assert.equal(ins, P.CONTINUE);
        assert(signing, "Continuation requires an active wallet request");
        assert.equal(
          sdk.hex(data),
          pendingResponse,
          "Host Merkle/ACK response differs from frozen Python oracle",
        );
        pendingResponse = undefined;
        return next();
      }
      assert.equal(
        apdu[0],
        P.cla,
        "Legacy/foreign protocol must never reach PSBT endpoint",
      );
      if (ins === P.GET_NETWORK_INFO) {
        assert.equal(data.length, 0);
        return ok(networkInfo(account.network));
      }
      if (ins === P.GET_MASTER_FINGERPRINT) {
        assert.equal(data.length, 0);
        return ok(account.masterFingerprint);
      }
      if (ins === P.GET_EXTENDED_PUBKEY) {
        assert.equal(data[0], 1, "Account export must require device display");
        assert.equal(
          sdk.hex(data),
          "0103" +
            [86, sdk.NETWORKS[account.network].coinType, account.account]
              .map((n) => (0x80000000 + n).toString(16).padStart(8, "0"))
              .join(""),
        );
        const custom = await stage("export");
        return custom ?? ok(new TextEncoder().encode(publicXpub(account)));
      }
      if (ins === P.GET_WALLET_ADDRESS) {
        assert.equal(data.length, 70);
        assert.equal(
          data[0],
          1,
          "Address verification requires device display",
        );
        assert.equal(sdk.hex(data.slice(1, 33)), psbtFixture.policyId);
        assert.equal(sdk.hex(data.slice(33, 65)), "00".repeat(32));
        const branch = data[65],
          index = new DataView(
            data.buffer,
            data.byteOffset,
            data.byteLength,
          ).getUint32(66);
        assert([0, 1].includes(branch));
        addressRequest = {
          branch,
          index,
          address: sdk.deriveAddress(account, branch, index).address,
        };
        signing = true;
        requestIndex = 0;
        activeTranscript = policyTranscript;
        return next();
      }
      assert.equal(ins, P.SIGN_PSBT);
      assert.equal(
        sdk.hex(data),
        psbtFixture.signPsbtApduHex.slice(10),
        "SIGN_PSBT must commit the exact frozen PSBT and unnamed BIP86 policy",
      );
      assert.equal(signing, false);
      signing = true;
      requestIndex = 0;
      nextYield = 0;
      activeTranscript = transcript;
      const reviewed = await stage("review");
      return reviewed ?? next();
    },
  };
  return {
    transport,
    commands,
    apdus,
    stages,
    closes: () => closes,
    yields: () => nextYield,
    acknowledgements: () => acknowledgements,
    merkleRequests: () => requestIndex,
  };
}
// Catch serialization/profile drift before any model can return a valid witness.
const fixtureAccount = sdk.accountFromJson(publicFixture.publicAccount);
assert.equal(
  sdk.hex(
    serializePrlPsbt(
      buildPrlPsbt(sdk.bundleFromJson(publicFixture.bundle), fixtureAccount),
    ),
  ),
  psbtFixture.psbtHex,
);
const policy = createPrlWalletPolicy(fixtureAccount, psbtFixture.accountXpub);
assert.equal(sdk.hex(policy.serialize()), psbtFixture.policyHex);
assert.equal(sdk.hex(policy.getId()), psbtFixture.policyId);
