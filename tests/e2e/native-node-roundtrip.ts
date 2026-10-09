/**
 * Native Ledger/Speculos -> Pearl simnet integration. Never uses a software signer.
 * All child processes share this process's loopback namespace. The seed is the
 * PUBLIC BIP32 vector-one seed. Never load this build/seed on a funded device.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  checkSnapshot,
  broadcastVerified,
} from "../../apps/companion/src/bridge.ts";
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  accountToJson,
  addressToScript,
  command,
  deriveAddress,
  encodeBundle,
  fromHex,
  hex,
  LedgerPearlClient,
  NETWORKS,
  parseTransaction,
  sha256,
  SpeculosTransport,
  u16,
  concat,
  type AccountPublicKey,
  type SigningBundle,
} from "../../packages/sdk/src/index.ts";
import {
  balances,
  discoverAccount,
  outpoint,
  preparePayment,
  requireFreshValidation,
  snapshotToJson,
  type WatchSource,
} from "../../packages/wallet/src/index.ts";

const root = resolve(import.meta.dirname, "../..");
const output =
  process.env.PEARL_E2E_OUTPUT ||
  (await mkdtemp(join(tmpdir(), "pearl-native-e2e-")));
await mkdir(output, { recursive: true });
const elf =
  process.env.PEARL_APP_ELF ||
  join(root, "apps/ledger/target/nanosplus/release/pearl-ledger");
const nodeBin = process.env.PEARLD_BIN || "/tmp/pearl-pearld-test";
const speculos =
  process.env.SPECULOS_BIN || "/tmp/pearl-speculos-venv/bin/speculos";
const model = process.env.SPECULOS_MODEL || "nanosp";
assert(
  ["nanosp", "nanox", "stax", "flex", "apex_p"].includes(model),
  "Unknown Speculos model",
);
const api = Number(process.env.SPECULOS_API_PORT || 5021);
const rpcPort = Number(process.env.PEARL_RPC_PORT || 19557);
const emulatorUrl = `http://127.0.0.1:${api}`;
const rpcUrl = `http://127.0.0.1:${rpcPort}`;
const inputCount = Number(process.env.PEARL_E2E_INPUTS || 2);
assert(
  [2, 16].includes(inputCount),
  "Use exactly 2 or 16 inputs for this regression suite",
);
const fundingBlocks = 99 + inputCount;
const PUBLIC_TEST_SEED = "000102030405060708090a0b0c0d0e0f";
const children: ChildProcess[] = [];
const cases: { name: string; status: string; detail?: unknown }[] = [];
const events: unknown[] = [];
const apdus: unknown[] = [];
const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  network: "simnet",
  inputCount,
  publicTestSeed: PUBLIC_TEST_SEED,
  firmware: {
    path: elf,
    sha256: createHash("sha256").update(readFileSync(elf)).digest("hex"),
    model,
  },
  pearlNode: {
    path: nodeBin,
    sha256: createHash("sha256").update(readFileSync(nodeBin)).digest("hex"),
  },
  output,
  cases,
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function json(path: string, data?: unknown) {
  const response = await fetch(`${emulatorUrl}${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(120_000),
  });
  assert(response.ok, `Speculos ${path}: HTTP ${response.status}`);
  return response.json() as Promise<any>;
}
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
async function rpc(method: string, params: unknown[] = []): Promise<any> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from("public-test:public-test").toString("base64")}`,
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: 1, method, params }),
    signal: AbortSignal.timeout(120_000),
  });
  const result: any = await response.json();
  if (result.error)
    throw new RpcError(result.error.code, `${method}: ${result.error.message}`);
  assert(response.ok, `Pearl RPC HTTP ${response.status}`);
  return result.result;
}
function start(
  binary: string,
  args: string[],
  label: string,
  extraEnv: Record<string, string> = {},
) {
  const log = createWriteStream(join(output, `${label}.log`));
  const child = spawn(binary, args, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.pipe(log);
  child.stderr!.pipe(log);
  children.push(child);
  return child;
}
async function ready(
  fn: () => Promise<unknown>,
  child: ChildProcess,
  label: string,
) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(
        `${label} exited ${child.exitCode}; inspect ${output}/${label}.log`,
      );
    try {
      await fn();
      return;
    } catch {
      await pause(100);
    }
  }
  throw new Error(
    `${label} did not become ready; inspect ${output}/${label}.log`,
  );
}
async function test<T>(name: string, action: () => Promise<T>): Promise<T> {
  const entry: { name: string; status: string; detail?: unknown } = {
    name,
    status: "running",
  };
  cases.push(entry);
  console.log(`RUN ${name}`);
  try {
    const result = await action();
    entry.status = "passed";
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    entry.status = "failed";
    entry.detail = String(error);
    throw error;
  }
}
class AuditedTransport extends SpeculosTransport {
  override async exchange(apdu: Uint8Array, signal?: AbortSignal) {
    const response = await super.exchange(apdu, signal);
    apdus.push({
      instruction: apdu[1],
      request: hex(apdu),
      response: hex(response),
    });
    return response;
  }
}
function client() {
  return new LedgerPearlClient(new AuditedTransport(emulatorUrl), "simnet");
}
async function review<T>(
  operation: () => Promise<T>,
  target: RegExp,
  label: string,
): Promise<T> {
  const started = performance.now();
  let approvedAt = 0;
  let done = false;
  const pending = operation().finally(() => {
    done = true;
  });
  // Attach a handler immediately so early APDU failures are not unhandled rejections.
  pending.catch(() => {});
  let approved = false,
    prior = "";
  for (let i = 0; i < 200 && !done; i++) {
    await pause(160);
    if (done) break;
    const snapshot = await json("/events?currentscreenonly=true");
    const screen = (snapshot.events || []).map((e: any) => e.text).join(" | ");
    if (screen !== prior) {
      events.push({ label, step: i, screen, events: snapshot.events });
      const screenshot = await fetch(`${emulatorUrl}/screenshot`);
      assert(
        screenshot.ok,
        "Could not capture trusted-device review screenshot",
      );
      await writeFile(
        join(output, `${label}-${String(i).padStart(3, "0")}.png`),
        Buffer.from(await screenshot.arrayBuffer()),
      );
      console.log(`UI ${label}: ${screen}`);
      prior = screen;
    }
    if (
      screen.includes("app is ready") ||
      screen.includes("This app enables signing")
    )
      continue;
    const finalEvent = snapshot.events.find((e: any) => target.test(e.text));
    const markApproval = () => {
      approved = true;
      if (!approvedAt) approvedAt = performance.now();
    };
    if (model === "nanosp" || model === "nanox") {
      if (finalEvent) {
        markApproval();
        await json("/button/both", { action: "press-and-release" });
      } else await json("/button/right", { action: "press-and-release" });
    } else {
      const dimensions = {
        stax: [400, 672],
        flex: [480, 600],
        apex_p: [300, 400],
      } as const;
      const [width, height] = dimensions[model as keyof typeof dimensions];
      const touch = (e: any, delay = 0.15) =>
        json("/finger", {
          x: e.x + Math.max(5, Math.floor(e.w / 2)),
          y: e.y + Math.max(5, Math.floor(e.h / 2)),
          action: "press-and-release",
          delay,
        });
      const hold = snapshot.events.find((e: any) =>
        e.text.startsWith("Hold to"),
      );
      const rejectConfirm = snapshot.events.find((e: any) =>
        /Yes, reject/i.test(e.text),
      );
      if (label === "reject" && rejectConfirm) {
        markApproval();
        await touch(rejectConfirm);
      } else if (label === "reject" && finalEvent) {
        markApproval();
        await touch(finalEvent);
      } else if (finalEvent && hold) {
        markApproval();
        await touch(hold, 2.5);
      } else if (label === "address" && finalEvent?.text === "Confirm") {
        markApproval();
        await touch(finalEvent);
      } else
        await json("/finger", {
          x: Math.floor(width * 0.85),
          y: Math.floor(height * 0.52),
          x2: Math.floor(width * 0.15),
          y2: Math.floor(height * 0.52),
          action: "press-and-release",
          delay: 0.2,
        });
    }
  }
  if (!done)
    throw new Error(`${label}: UI did not finish at expected action ${target}`);
  const result = await pending;
  evidence[`${label}Timing`] = {
    totalWallMs: Math.round(performance.now() - started),
    afterApprovalWallMs: approvedAt
      ? Math.round(performance.now() - approvedAt)
      : null,
  };
  assert(
    approved,
    `${label}: operation completed without observing and pressing expected physical approval`,
  );
  return result;
}
async function malformed(ins: number, data: Uint8Array, expected: string) {
  const request = hex(command(ins, data));
  const result = await json("/apdu", { data: request });
  apdus.push({ instruction: ins, request, response: result.data });
  assert.equal(result.data, expected);
}
async function nativeUpload(bytes: Uint8Array, hash = sha256(bytes)) {
  await malformed(0x10, concat(u16(bytes.length), hash), "9000");
  for (let offset = 0; offset < bytes.length; offset += 253)
    await malformed(
      0x11,
      concat(u16(offset), bytes.slice(offset, offset + 253)),
      "9000",
    );
}
const source: WatchSource = {
  network: "simnet",
  async tip() {
    const height = await rpc("getblockcount");
    return {
      tip: { height, hash: await rpc("getblockhash", [height]) },
      genesisHash: await rpc("getblockhash", [0]),
    };
  },
  async blockHash(height) {
    return rpc("getblockhash", [height]);
  },
  async transaction(txid) {
    const tx = await rpc("getrawtransaction", [txid, 1]);
    const header = tx.blockhash
      ? await rpc("getblockheader", [tx.blockhash, true])
      : null;
    return {
      rawTransaction: tx.hex,
      block: header ? { height: header.height, hash: tx.blockhash } : null,
    };
  },
  async address(address) {
    let history: any[];
    try {
      history = await rpc("searchrawtransactions", [address, 1, 0, 1000]);
    } catch (error) {
      if (error instanceof RpcError && error.code === -5)
        return { used: false, txids: [], utxos: [] };
      throw error;
    }
    const script = hex(addressToScript(address, "simnet"));
    const utxos: { txid: string; vout: number; height: number | null }[] = [];
    for (const tx of history) {
      const parsed = parseTransaction(tx.hex);
      const block = tx.blockhash
        ? await rpc("getblockheader", [tx.blockhash, true])
        : null;
      for (let vout = 0; vout < parsed.outputs.length; vout++)
        if (
          hex(parsed.outputs[vout]!.scriptPubKey) === script &&
          (await rpc("gettxout", [tx.txid, vout, true]))
        ) {
          utxos.push({ txid: tx.txid, vout, height: block?.height ?? null });
        }
    }
    return { used: true, txids: history.map((tx) => tx.txid), utxos };
  },
};
let currentStage = "startup";
try {
  const emulator = start(
    speculos,
    [
      "--display",
      "headless",
      "--model",
      model,
      "-a",
      process.env.SPECULOS_API_LEVEL || "27",
      "--api-port",
      String(api),
      "--apdu-port",
      String(api + 1),
      "--seed",
      `hex:${PUBLIC_TEST_SEED}`,
      elf,
    ],
    "speculos",
    {
      PATH: `/tmp/pearl-ledger-tools:/tmp/pearl-toolchain/root/usr/bin:${process.env.PATH}`,
      LD_LIBRARY_PATH: `/tmp/pearl-toolchain/root/usr/lib/x86_64-linux-gnu:${process.env.LD_LIBRARY_PATH || ""}`,
    },
  );
  await ready(
    () => json("/events?currentscreenonly=true"),
    emulator,
    "speculos",
  );
  currentStage = "capabilities";
  await test("native firmware advertises simnet and protocol bounds", async () => {
    const cap = await client().capabilities();
    evidence.capabilities = cap;
    assert.equal(cap.network, "simnet");
  });
  currentStage = "account";
  const account =
    await test("device public account export requires UI approval", async () =>
      review(() => client().exportAccount(0), /Approve export/, "account"));
  evidence.account = accountToJson(account);
  const publicVector = JSON.parse(
    readFileSync(join(root, "fixtures/protocol-v1.json"), "utf8"),
  ).publicAccount;
  assert.deepEqual(
    evidence.account,
    { ...publicVector, network: "simnet" },
    "Native derivation must match the public BIP32 test vector",
  );
  await writeFile(
    join(output, "account-public.json"),
    JSON.stringify(evidence.account, null, 2),
  );
  const receive = deriveAddress(account, 0, 0),
    recipient = deriveAddress(account, 0, 7);
  currentStage = "address";
  await test("device receive address matches public-only BIP86 derivation", async () => {
    const address = await review(
      () => client().verifyAddress(account, 0, 0),
      /Approve|Confirm|Verify address/,
      "address",
    );
    assert.equal(address, receive.address);
  });
  await test("native out-of-order signature and malformed transfer fail closed", async () => {
    await malformed(0x13, Uint8Array.of(0), "6986");
    await malformed(0x11, Uint8Array.of(0, 0, 1), "6986");
    await malformed(0x10, Uint8Array.of(0), "6700");
    await malformed(0x14, new Uint8Array(), "9000");
  });
  const home = join(output, "node");
  await mkdir(home, { recursive: true });
  const config = join(home, "pearld.conf");
  await writeFile(config, "");
  const node = start(
    nodeBin,
    [
      "--simnet",
      "--nolisten",
      "--nodnsseed",
      "--notls",
      "--rpcuser=public-test",
      "--rpcpass=public-test",
      `--rpclisten=127.0.0.1:${rpcPort}`,
      `--configfile=${config}`,
      `--datadir=${home}/data`,
      `--logdir=${home}/logs`,
      `--rpccert=${home}/rpc.cert`,
      `--rpckey=${home}/rpc.key`,
      `--miningaddr=${receive.address}`,
      "--txindex",
      "--addrindex",
    ],
    "pearld",
    { PEARL_TEST_HOME: home },
  );
  currentStage = "mining";
  await ready(() => rpc("getblockcount"), node, "pearld");
  await test("isolated Pearl simnet genesis and no peers", async () => {
    assert.equal(await rpc("getblockhash", [0]), NETWORKS.simnet.genesisHash);
    assert.equal(await rpc("getconnectioncount"), 0);
    assert.equal(await rpc("getblockcount"), 0);
  });
  await test(`mine ${fundingBlocks} native Pearl simnet blocks to device-derived address`, async () => {
    const blocks = await rpc("generate", [fundingBlocks]);
    assert.equal(blocks.length, fundingBlocks);
    assert.equal(await rpc("getblockcount"), fundingBlocks);
    evidence.minedFirstBlock = blocks[0];
  });
  currentStage = "discovery";
  const discovery =
    await test("public-account discovery scans both branches and exact UTXOs", async () => {
      const found = await discoverAccount(source, account);
      assert.equal(found.snapshot.coins.length, fundingBlocks);
      assert(balances(found.snapshot).available > 0n);
      assert.equal(found.lastUsed[0], 0);
      assert.equal(found.lastUsed[1], -1);
      return found;
    });
  await writeFile(
    join(output, "watch-before.json"),
    snapshotToJson(discovery.snapshot),
  );
  const selected = discovery.snapshot.coins
    .filter((c) => c.block && c.block.height <= inputCount)
    .map(outpoint);
  assert.equal(selected.length, inputCount);
  const bundle = preparePayment(discovery.snapshot, {
    selected,
    recipient: recipient.address,
    amountPrl: "1.23456789",
    feePrl: inputCount === 16 ? "0.00010000" : "0.00001000",
    changeIndex: 0,
  });
  requireFreshValidation(discovery.snapshot, discovery.validation, bundle);
  await test("production bridge validates exact mined prevouts before signing", async () => {
    const validation = await checkSnapshot(rpc, "simnet", discovery.snapshot);
    requireFreshValidation(discovery.snapshot, validation, bundle);
  });
  await writeFile(join(output, "bundle.hex"), hex(encodeBundle(bundle)) + "\n");
  currentStage = "native-validation";
  await test("native wrong network bundle rejected before signing", async () => {
    const bad = encodeBundle({ ...bundle, network: "regtest" });
    await nativeUpload(bad);
    await malformed(0x12, new Uint8Array(), "6a80");
    await malformed(0x13, Uint8Array.of(0), "6986");
  });
  await test("native input ownership and change ownership independently reject substitutions", async () => {
    const wrongInput: SigningBundle = {
      ...bundle,
      inputs: bundle.inputs.map((i, n) =>
        n === 0 ? { ...i, scriptPubKey: recipient.scriptPubKey } : i,
      ),
    };
    const wrongChange: SigningBundle = {
      ...bundle,
      outputs: bundle.outputs.map((o) =>
        o.role === "change"
          ? { ...o, scriptPubKey: deriveAddress(account, 1, 1).scriptPubKey }
          : o,
      ),
    };
    for (const bad of [wrongInput, wrongChange]) {
      await nativeUpload(encodeBundle(bad));
      await malformed(0x12, new Uint8Array(), "6a80");
      await malformed(0x13, Uint8Array.of(0), "6986");
    }
  });
  await test("native bundle hash mismatch clears session before review", async () => {
    const bytes = encodeBundle(bundle),
      digest = sha256(bytes);
    digest[0] = digest[0]! ^ 1;
    await nativeUpload(bytes, digest);
    await malformed(0x12, new Uint8Array(), "6a80");
    await malformed(0x13, Uint8Array.of(0), "6986");
  });
  await test("native user rejection releases no signature and clears session", async () => {
    await assert.rejects(
      review(() => client().signBundle(bundle, account), /Reject/, "reject"),
      /0x6985/,
    );
    await malformed(0x13, Uint8Array.of(0), "6986");
  });
  currentStage = "signing";
  const signed =
    await test(`native ${inputCount}-input BIP340 signing and independent host verification`, async () =>
      review(
        () => client().signBundle(bundle, account),
        /Sign Pearl transfer/,
        "sign",
      ));
  await test("native consumed signatures cannot be replayed", async () => {
    await malformed(0x13, Uint8Array.of(0), "6986");
  });
  evidence.transaction = {
    bundleBytes: encodeBundle(bundle).length,
    txid: signed.txid,
    wtxid: signed.wtxid,
    vsize: signed.vsize,
    inputs: bundle.inputs.length,
    recipient: recipient.address,
    amountGrains: bundle.outputs[0]!.amount.toString(),
    feeGrains: inputCount === 16 ? "10000" : "1000",
    changeAddress: deriveAddress(account, 1, 0).address,
    signatures: signed.signatures.map(hex),
  };
  await writeFile(join(output, "signed-transaction.hex"), signed.rawTx + "\n");
  const parsed = parseTransaction(signed.rawTx);
  assert.equal(parsed.txid, signed.txid);
  assert.equal(parsed.wtxid, signed.wtxid);
  assert(
    parsed.inputs.every(
      (i) => i.witness.length === 1 && i.witness[0]!.length === 64,
    ),
  );
  currentStage = "broadcast";
  await test("Pearl rejects a bit-flipped native witness", async () => {
    const bad = fromHex(signed.rawTx);
    bad[bad.length - 12] = bad[bad.length - 12]! ^ 1;
    await assert.rejects(
      rpc("sendrawtransaction", [hex(bad)]),
      /signature|witness|script/i,
    );
  });
  await test("native signed transaction broadcasts only to isolated simnet", async () => {
    assert.equal(await rpc("getconnectioncount"), 0);
    assert.equal(
      (
        await broadcastVerified(rpc, "simnet", {
          bundleHex: hex(encodeBundle(bundle)),
          rawTx: signed.rawTx,
          expectedTxid: signed.txid,
        })
      ).txid,
      signed.txid,
    );
    assert((await rpc("getrawmempool")).includes(signed.txid));
  });
  await test("production bridge excludes confirmed inputs spent in Pearl mempool", async () => {
    for (const input of bundle.inputs)
      assert(
        await rpc("gettxout", [input.txid, input.vout, true]),
        "Confirm the Pearl gettxout mempool-spend behavior",
      );
    const validation = await checkSnapshot(rpc, "simnet", discovery.snapshot);
    for (const input of bundle.inputs)
      assert.equal(
        validation.coins.find((c) => c.outpoint === outpoint(input))!.state,
        "spent-or-unknown",
      );
    assert.throws(
      () => requireFreshValidation(discovery.snapshot, validation, bundle),
      /spent|stale|not verified/,
    );
  });
  const confirmation =
    await test("Pearl mines and confirms exact recipient/change and spent inputs", async () => {
      const [block] = await rpc("generate", [1]);
      const tx = await rpc("getrawtransaction", [signed.txid, 1]);
      assert.equal(tx.confirmations, 1);
      assert.equal(tx.hex, signed.rawTx);
      for (const input of bundle.inputs)
        assert.equal(
          await rpc("gettxout", [input.txid, input.vout, false]),
          null,
        );
      return block as string;
    });
  currentStage = "refresh";
  const refreshed =
    await test("wallet refresh removes spent inputs and discovers recipient/change", async () => {
      const found = await discoverAccount(source, account, {
        previousHistory: discovery.history,
      });
      for (const input of bundle.inputs)
        assert(
          !found.snapshot.coins.some((c) => outpoint(c) === outpoint(input)),
        );
      assert(
        found.snapshot.coins.some(
          (c) => c.txid === signed.txid && c.branch === 1 && c.index === 0,
        ),
      );
      assert(
        found.snapshot.coins.some(
          (c) => c.txid === signed.txid && c.branch === 0 && c.index === 7,
        ),
      );
      return found;
    });
  await writeFile(
    join(output, "watch-after.json"),
    snapshotToJson(refreshed.snapshot),
  );
  currentStage = "reorg";
  await test("Pearl invalidation detaches confirmation and reconsideration restores it", async () => {
    await rpc("invalidateblock", [confirmation]);
    assert.equal(await rpc("getblockcount"), fundingBlocks);
    let detached: any = null;
    try {
      detached = await rpc("getrawtransaction", [signed.txid, 1]);
    } catch (error) {
      if (!(error instanceof RpcError && error.code === -5)) throw error;
    }
    assert(
      !detached || !detached.confirmations || detached.confirmations === 0,
    );
    const changed = await discoverAccount(source, account, {
      previousHistory: refreshed.history,
    });
    assert(
      ["pending", "detached"].includes(
        changed.history.find((h) => h.txid === signed.txid)!.state,
      ),
    );
    await rpc("reconsiderblock", [confirmation]);
    assert.equal(await rpc("getblockcount"), fundingBlocks + 1);
    assert.equal(
      (await rpc("getrawtransaction", [signed.txid, 1])).confirmations,
      1,
    );
  });
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.failedStage = currentStage;
  evidence.error = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const child of children.reverse()) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.race([
    Promise.all(
      children.map((child) =>
        child.exitCode !== null
          ? undefined
          : new Promise((r) => child.once("exit", r)),
      ),
    ),
    pause(3000),
  ]);
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGKILL");
  evidence.finishedAt = new Date().toISOString();
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  await writeFile(
    join(output, "ui-events.json"),
    JSON.stringify(events, null, 2),
  );
  await writeFile(
    join(output, "apdu-transcript.json"),
    JSON.stringify(apdus, null, 2),
  );
  console.log(`EVIDENCE ${join(output, "evidence.json")}`);
}
