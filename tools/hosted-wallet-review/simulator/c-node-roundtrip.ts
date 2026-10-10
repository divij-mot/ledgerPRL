/** Public vector-one seed only. Isolated C firmware -> actual Pearl regtest node. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, readFileSync } from "node:fs";
import { copyFile, cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Emulator,
  pause,
} from "../../../apps/ledger-bitcoin-prl/prl-tests/emulator.ts";
import { LedgerBitcoinPrlClient } from "../../../packages/bitcoin-prl-adapter/src/index.ts";
import {
  accountToJson,
  addressToScript,
  bundleToJson,
  deriveAddress,
  encodeBundle,
  formatPrl,
  fromHex,
  hex,
  NETWORKS,
  parsePrl,
  parseTransaction,
  scriptToAddress,
  SpeculosTransport,
  validateBundle,
} from "../../../packages/sdk/src/index.ts";
import {
  balances,
  discoverAccount,
  outpoint,
  preparePayment,
  requireFreshValidation,
  snapshotToJson,
  type WatchSource,
} from "../../../packages/wallet/src/index.ts";
import {
  checkSnapshot,
  broadcastVerified,
} from "../../../apps/companion/src/bridge.ts";
import { paymentAtRate } from "../../../apps/companion/src/fee-quotes.ts";

const root = resolve(import.meta.dirname, "../../..");
const reviewedSources = [
  "apps/companion/src/fee-quotes.ts",
  "packages/bitcoin-prl-adapter/src/client.ts",
  "apps/companion/src/bridge.ts",
  "packages/wallet/src/watch.ts",
  "tools/hosted-wallet-review/simulator/c-node-roundtrip.ts",
];
const sourceBefore = Object.fromEntries(
  reviewedSources.map((p) => [
    p,
    createHash("sha256")
      .update(readFileSync(join(root, p)))
      .digest("hex"),
  ]),
);
const output = await mkdtemp(join(tmpdir(), "pearl-c-node-roundtrip-"));
const sourceElf =
  process.env.PEARL_APP_ELF ??
  "/private/tmp/pearl-name-review-q4wm1ypq/workspace/apps/ledger-bitcoin-prl/build-artifacts/nanos2-regtest/app.elf";
const nodeBin =
  process.env.PEARLD_BIN ??
  "/private/tmp/pearl-spv-runtime-ygy09w9x/extracted/pearld";
const image =
  "ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools@sha256:8d3da9179dd1b241883c769c521ee9403352b60091c80405b5bef5801a003ba2";
const sha = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
assert.equal(
  sha(readFileSync(sourceElf)),
  "77e2dc35fed3443440a1393c42ed6cf03fad13ecf5532a84dab7de014890ce14",
);
assert.equal(
  sha(readFileSync(nodeBin)),
  "0d3a83ba76048bc10cb9ce70b915a20b22f9d102fa4fce2b1edb209a1e39c8d7",
);
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((ok) => server.close(() => ok()));
  return port;
}
const apiPort = await freePort(),
  rpcPort = await freePort();
assert.notEqual(apiPort, rpcPort);
const containerName = `pearl-c-roundtrip-${randomUUID()}`;
const cases: { name: string; status: string }[] = [];
const artifacts: unknown[] = [];
const evidence: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  network: "regtest",
  publicTestSeed: "000102030405060708090a0b0c0d0e0f",
  output,
  apiPort,
  rpcPort,
  containerName,
  firmware: {
    name: "Pearl Reg",
    version: "0.1.0",
    model: "nanosp",
    sha256: sha(readFileSync(sourceElf)),
  },
  node: {
    release: "1.4.11",
    commit: "2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4",
    sha256: sha(readFileSync(nodeBin)),
  },
  dockerImage: image,
  cases,
  transactions: artifacts,
};
let node: ChildProcess | undefined;
let containerStarted = false;
const save = (file: string, value: unknown) =>
  writeFile(join(output, file), JSON.stringify(value, null, 2) + "\n");
class ContainerEmulator extends Emulator {
  override async start() {
    await mkdir(this.output, { recursive: true });
    const elf = join(this.output, "tested-firmware.elf");
    await copyFile(this.elf, elf);
    const version = execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--network",
        "none",
        image,
        "python3",
        "-c",
        "import importlib.metadata;print(importlib.metadata.version('speculos'))",
      ],
      { encoding: "utf8" },
    ).trim();
    assert.equal(version, "0.27.1");
    evidence.speculos = version;
    this.provenance = evidence.firmware;
    const log = createWriteStream(join(this.output, "speculos.log"));
    this.child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--pull",
        "never",
        "--name",
        containerName,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        `${process.getuid!()}:${process.getgid!()}`,
        "--tmpfs",
        "/tmp:rw,nosuid,nodev",
        "--publish",
        `127.0.0.1:${this.port}:${this.port}`,
        "--mount",
        `type=bind,src=${elf},dst=/firmware.elf,readonly`,
        image,
        "speculos",
        "--display",
        "headless",
        "--model",
        "nanosp",
        "--api-port",
        String(this.port),
        "--apdu-port",
        "0",
        "--seed",
        "hex:000102030405060708090a0b0c0d0e0f",
        "/firmware.elf",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    containerStarted = true;
    this.child.stdout!.pipe(log);
    this.child.stderr!.pipe(log);
    await ready(() => this.events(), this.child, "Speculos");
  }
  override async stop() {
    await save("screens.json", this.screens);
    if (containerStarted) {
      try {
        execFileSync("docker", ["stop", "--time", "5", containerName], {
          stdio: "ignore",
        });
      } catch {
        /* An already-exited owned --rm container needs no cleanup. */
      }
      containerStarted = false;
    }
  }
}
async function ready(
  call: () => Promise<unknown>,
  child: ChildProcess,
  name: string,
) {
  for (let i = 0; i < 150; i++) {
    assert(
      child.exitCode === null,
      `${name} exited ${child.exitCode}; inspect ${output}`,
    );
    try {
      await call();
      return;
    } catch {
      await pause(200);
    }
  }
  throw new Error(`${name} failed readiness: ${output}`);
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
  const response = await fetch(`http://127.0.0.1:${rpcPort}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from("public-test:public-test").toString("base64")}`,
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: 1, method, params }),
    signal: AbortSignal.timeout(method === "generate" ? 900_000 : 120_000),
  });
  const data: any = await response.json();
  if (data.error)
    throw new RpcError(data.error.code, `${method}: ${data.error.message}`);
  assert(response.ok);
  return data.result;
}
const source: WatchSource = {
  network: "regtest",
  async tip() {
    const height = await rpc("getblockcount");
    return {
      tip: { height, hash: await rpc("getblockhash", [height]) },
      genesisHash: await rpc("getblockhash", [0]),
    };
  },
  blockHash: (height) => rpc("getblockhash", [height]),
  async transaction(txid) {
    const tx = await rpc("getrawtransaction", [txid, 1]);
    const header = tx.blockhash
      ? await rpc("getblockheader", [tx.blockhash, true])
      : null;
    return {
      confirmations: tx.confirmations || 0,
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
        return {
          used: false,
          confirmedTxCount: 0,
          pendingTxCount: 0,
          txids: [],
          utxos: [],
        };
      throw error;
    }
    const script = hex(addressToScript(address, "regtest")),
      utxos: { txid: string; vout: number; height: number | null }[] = [];
    for (const tx of history) {
      const parsed = parseTransaction(tx.hex),
        block = tx.blockhash
          ? await rpc("getblockheader", [tx.blockhash, true])
          : null;
      for (let vout = 0; vout < parsed.outputs.length; vout++)
        if (
          hex(parsed.outputs[vout]!.scriptPubKey) === script &&
          (await rpc("gettxout", [tx.txid, vout, true]))
        )
          utxos.push({ txid: tx.txid, vout, height: block?.height ?? null });
    }
    return {
      used: history.length > 0,
      confirmedTxCount: history.filter((tx) => !!tx.blockhash).length,
      pendingTxCount: history.filter((tx) => !tx.blockhash).length,
      txids: history.map((tx) => tx.txid),
      utxos,
    };
  },
};
async function test<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const row = { name, status: "running" };
  cases.push(row);
  console.log(`RUN ${name}`);
  try {
    const value = await fn();
    row.status = "passed";
    console.log(`PASS ${name}`);
    return value;
  } catch (e) {
    row.status = "failed";
    throw e;
  }
}
const emulator = new ContainerEmulator("nanosp", sourceElf, output, apiPort);
console.log(`PUBLIC_FIXTURE_EVIDENCE ${output}`);
try {
  await emulator.start();
  const client = new LedgerBitcoinPrlClient(
    new SpeculosTransport(emulator.url),
    "regtest",
  );
  await test("current C app capabilities and explicit public-account/address approval", async () => {
    assert.equal((await client.capabilities()).capabilityFlags, 3);
  });
  const account = await emulator.approve(
    () => client.exportAccount(0),
    "Approve public key",
    "account",
  );
  const address = await emulator.approve(
    () => client.verifyAddress(account, 0, 0),
    "Confirm",
    "receive",
  );
  assert.equal(address, deriveAddress(account, 0, 0).address);
  evidence.publicAccount = accountToJson(account);
  const home = join(output, "node");
  await mkdir(home);
  await writeFile(join(home, "pearld.conf"), "");
  const reuse = process.env.PEARL_PUBLIC_FIXTURE_REUSE;
  if (reuse) {
    const prior = JSON.parse(readFileSync(join(reuse, "result.json"), "utf8"));
    assert.equal(prior.network, "regtest");
    assert.equal(prior.publicTestSeed, "000102030405060708090a0b0c0d0e0f");
    assert.deepEqual(prior.publicAccount, accountToJson(account));
    assert.equal(prior.node.sha256, sha(readFileSync(nodeBin)));
    assert.equal(prior.firmware.sha256, sha(readFileSync(sourceElf)));
    assert(
      readFileSync(join(reuse, "pearld.log"), "utf8").includes(
        "Shutdown complete",
      ),
    );
    await cp(join(reuse, "node/data"), join(home, "data"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    evidence.publicFixtureChainReuse = {
      source: reuse,
      priorResultSha256: sha(readFileSync(join(reuse, "result.json"))),
      reason:
        "Earlier HTTP mining-request header timeout; cleanly stopped public-only chain",
    };
  }
  const log = createWriteStream(join(output, "pearld.log"));
  node = spawn(
    nodeBin,
    [
      "--regtest",
      "--nolisten",
      "--nodnsseed",
      "--notls",
      "--rpcuser=public-test",
      "--rpcpass=public-test",
      `--rpclisten=127.0.0.1:${rpcPort}`,
      `--configfile=${home}/pearld.conf`,
      `--datadir=${home}/data`,
      `--logdir=${home}/logs`,
      `--rpccert=${home}/rpc.cert`,
      `--rpckey=${home}/rpc.key`,
      `--miningaddr=${address}`,
      "--txindex",
      "--addrindex",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  node.stdout!.pipe(log);
  node.stderr!.pipe(log);
  await ready(() => rpc("getblockcount"), node, "Pearl node");
  await test("isolated real Pearl regtest genesis, no peers, and mature mined fixture coins", async () => {
    assert.equal(await rpc("getblockhash", [0]), NETWORKS.regtest.genesisHash);
    assert.equal(await rpc("getconnectioncount"), 0);
    const initialHeight = await rpc("getblockcount");
    assert(
      reuse ? initialHeight >= 0 && initialHeight < 101 : initialHeight === 0,
    );
    evidence.initialFixtureHeight = initialHeight;
    for (let height = initialHeight; height < 101; ) {
      const count = Math.min(5, 101 - height);
      assert.equal((await rpc("generate", [count])).length, count);
      height += count;
      console.log(`MINED ${height}/101 public regtest blocks`);
    }
    assert.equal(await rpc("getblockcount"), 101);
  });
  for (const recipientType of ["p2tr", "p2mr"] as const) {
    const found =
      await test(`${recipientType}: actual address/history discovery and spendable inputs`, () =>
        discoverAccount(source, account));
    assert(balances(found.snapshot).available > 0n);
    await writeFile(
      join(output, `${recipientType}-watch.json`),
      snapshotToJson(found.snapshot),
    );
    const recipient =
      recipientType === "p2tr"
        ? deriveAddress(account, 0, 1).address
        : scriptToAddress(
            Uint8Array.from([0x52, 0x20, ...new Uint8Array(32).fill(0x42)]),
            "regtest",
          );
    const request = paymentAtRate(
      found.snapshot,
      {
        selected: [],
        recipient,
        amountPrl: "1.23456789",
        changeIndex: recipientType === "p2tr" ? 0 : 1,
      },
      new Set(),
      2000n,
      false,
    );
    const bundle = preparePayment(found.snapshot, request);
    const fee = validateBundle(bundle, account).fee;
    assert.equal(
      bundle.outputs.find((o) => o.role === "recipient")!.amount,
      123456789n,
    );
    assert.equal(fee, parsePrl(request.feePrl));
    await test(`${recipientType}: current UI fee calculation and fresh production input preflight`, async () => {
      requireFreshValidation(
        found.snapshot,
        await checkSnapshot(rpc, "regtest", found.snapshot),
        bundle,
      );
    });
    let durable = false;
    const signed =
      await test(`${recipientType}: explicit C-firmware review/sign and verified-byte persistence`, () =>
        emulator.approve(
          () =>
            client.signBundle(bundle, account, {
              onVerifiedSigned: async (signed) => {
                await writeFile(
                  join(output, `${recipientType}-signed.hex`),
                  hex(signed.bytes) + "\n",
                  { flag: "wx" },
                );
                durable = true;
              },
            }),
          "Sign transaction",
          `${recipientType}-sign`,
        ));
    assert(durable);
    const rawTx = hex(signed.bytes),
      parsed = parseTransaction(rawTx);
    assert.equal(parsed.txid, signed.txid);
    const screens = emulator.screens.filter(
      (s) => s.label === `${recipientType}-sign`,
    );
    const value = (title: RegExp) =>
      screens
        .filter((s) => title.test(s.events[0]?.text ?? ""))
        .map((s) =>
          s.events
            .slice(1)
            .map((e) => e.text)
            .join(""),
        )
        .join("");
    assert.equal(value(/^To(?: \(\d+\/\d+\))?$/), recipient);
    assert.equal(parsePrl(value(/^Amount$/).replace(/ PRL$/, "")), 123456789n);
    assert.equal(parsePrl(value(/^Fees$/).replace(/ PRL$/, "")), fee);
    await test(`${recipientType}: real node rejects mutated signature`, async () => {
      const bad = fromHex(rawTx);
      bad[bad.length - 12] ^= 1;
      await assert.rejects(
        rpc("sendrawtransaction", [hex(bad)]),
        /signature|witness|script/i,
      );
    });
    await test(`${recipientType}: explicit verified regtest submission and mempool acceptance`, async () => {
      assert.equal(await rpc("getconnectioncount"), 0);
      assert.equal(
        (
          await broadcastVerified(rpc, "regtest", {
            bundleHex: hex(encodeBundle(bundle)),
            rawTx,
            expectedTxid: signed.txid,
          })
        ).txid,
        signed.txid,
      );
      assert((await rpc("getrawmempool")).includes(signed.txid));
    });
    await test(`${recipientType}: mine exact bytes and confirm spent inputs/output amounts`, async () => {
      await rpc("generate", [1]);
      const tx = await rpc("getrawtransaction", [signed.txid, 1]);
      assert.equal(tx.confirmations, 1);
      assert.equal(tx.hex, rawTx);
      for (const input of bundle.inputs)
        assert.equal(
          await rpc("gettxout", [input.txid, input.vout, false]),
          null,
        );
      assert.equal((await rpc("getrawmempool")).includes(signed.txid), false);
    });
    artifacts.push({
      recipientType,
      request,
      bundle: bundleToJson(bundle),
      fee: formatPrl(fee),
      txid: signed.txid,
      rawTx,
      confirmations: 1,
    });
    await test(`${recipientType}: post-confirmation wallet refresh discovers change`, async () => {
      const refreshed = await discoverAccount(source, account, {
        minimumIndex: [1, recipientType === "p2tr" ? 0 : 1],
      });
      assert(
        refreshed.snapshot.coins.some(
          (c) => c.txid === signed.txid && c.branch === 1,
        ),
      );
      for (const input of bundle.inputs)
        assert(
          !refreshed.snapshot.coins.some(
            (c) => outpoint(c) === outpoint(input),
          ),
        );
    });
  }
  assert.deepEqual(
    Object.fromEntries(
      reviewedSources.map((p) => [p, sha(readFileSync(join(root, p)))]),
    ),
    sourceBefore,
    "Reviewed source changed during the run",
  );
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = String(error);
  process.exitCode = 1;
  console.error(error);
} finally {
  await emulator.stop();
  if (node && node.exitCode === null) {
    node.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => node!.once("exit", r)),
      pause(5000),
    ]);
    if (node.exitCode === null) node.kill("SIGKILL");
  }
  evidence.finishedAt = new Date().toISOString();
  const sources = [
    "apps/companion/src/fee-quotes.ts",
    "packages/bitcoin-prl-adapter/src/client.ts",
    "apps/companion/src/bridge.ts",
    "packages/wallet/src/watch.ts",
    "tools/hosted-wallet-review/simulator/c-node-roundtrip.ts",
  ];
  evidence.sourceHashesAtStart = sourceBefore;
  evidence.sourceHashes = Object.fromEntries(
    sources.map((p) => [p, sha(readFileSync(join(root, p)))]),
  );
  await save("result.json", evidence);
  console.log(`RESULT ${output}/result.json`);
}
