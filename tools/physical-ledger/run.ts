/** Opt-in physical pilot. All account/transaction material stays in a private tmp directory. */
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, chmod, open, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { LedgerBitcoinPrlClient as NodeLedgerBitcoinPrlClient, VerifiedSigningResultError } from "../../packages/bitcoin-prl-adapter/src/index.js";
import { accountToJson, bundleToJson, deriveAddress, finalizeTransaction, hex, NETWORKS, type NetworkName, type SigningBundle } from "../../packages/sdk/src/index.js";
import { assertPearlApdu } from "../../apps/companion/src/pearl-apdu.js";

const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
if (!args.includes("--physical")) {
  console.error("No hardware opened. Use --physical --python PATH --network mainnet --candidate-hash SHA256 [--synthetic-sign].");
  process.exit(2);
}
const network = option("--network") as NetworkName;
const python = option("--python"), candidateHash = option("--candidate-hash");
if (!args.includes("--python") || !args.includes("--network") || !args.includes("--candidate-hash") || !Object.hasOwn(NETWORKS, network) || !/^[0-9a-f]{64}$/.test(candidateHash ?? "")) throw Error("Invalid explicit pilot arguments");
const directory = await mkdtemp("/private/tmp/pearl-physical-");
await chmod(directory, 0o700);
const save = async (name: string, value: unknown) => {
  const file = await open(`${directory}/${name}`, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v)); await file.sync(); } finally { await file.close(); }
  const folder = await open(directory, "r");
  try { await folder.sync(); } finally { await folder.close(); }
};
const summary: Record<string, unknown> = { sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), candidateHash, network, synthetic: args.includes("--synthetic-sign"), broadcast: false };
const child = spawn(python!, [fileURLToPath(new URL("./bridge.py", import.meta.url)), "--physical"], { stdio: ["pipe", "pipe", "pipe"] });
let terminal = false, pending: { resolve: (value: Uint8Array) => void; reject: (error: Error) => void } | undefined;
let privateError = "";
child.stderr.on("data", chunk => { if (privateError.length < 16_384) privateError += String(chunk); });
const close = async () => { if (terminal) return; terminal = true; child.stdin.end(); child.kill("SIGTERM"); };
const fail = (error: Error) => { pending?.reject(error); pending = undefined; void close(); };
child.on("error", fail);
child.stdin.on("error", fail);
child.on("exit", () => fail(new Error("HID bridge closed")));
createInterface({ input: child.stdout }).on("line", line => {
  try {
    const result = JSON.parse(line);
    if (!pending || typeof result.response !== "string" || !/^(?:[0-9a-f]{2}){2,65536}$/.test(result.response)) throw Error("Malformed HID response");
    pending.resolve(Uint8Array.from(Buffer.from(result.response, "hex"))); pending = undefined;
  } catch { fail(new Error("Malformed HID bridge output")); }
});
const transport = { close, async exchange(apdu: Uint8Array, signal?: AbortSignal) {
  if (terminal || pending || signal?.aborted) throw Error("HID session closed, busy or cancelled");
  assertPearlApdu(apdu, "bitcoin-prl");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => fail(new Error("Device operation cancelled"));
  try {
    return await new Promise<Uint8Array>((resolve, reject) => {
      pending = { resolve, reject };
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => fail(new Error("HID exchange timed out")), 130_000);
      child.stdin.write(JSON.stringify({ apdu: hex(apdu) }) + "\n", error => { if (error) fail(error); });
    });
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
} };
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
try {
  const client = new NodeLedgerBitcoinPrlClient(transport, network);
  await client.capabilities(controller.signal); summary.capabilitiesVerified = true;
  console.log("Approve public account export on your Ledger.");
  const account = await client.exportAccount(0, controller.signal);
  await save("public-account.json", accountToJson(account)); summary.accountExportApproved = true;
  console.log("Compare and approve the receive address on your Ledger.");
  const address = await client.verifyAddress(account, 0, 0, controller.signal);
  if (address !== deriveAddress(account, 0, 0).address) throw Error("Address mismatch");
  await save("verified-address.json", { address }); summary.addressVerified = true;
  if (args.includes("--synthetic-sign")) {
    const bundle: SigningBundle = { network, account: 0, version: 1, lockTime: 0,
      inputs: [{ txid: randomBytes(32).toString("hex"), vout: 0, amount: 200001000n, scriptPubKey: deriveAddress(account, 0, 0).scriptPubKey, sequence: 0xffffffff, branch: 0, index: 0 }],
      outputs: [{ amount: 100000000n, scriptPubKey: deriveAddress(account, 0, 1).scriptPubKey, role: "recipient", branch: 0, index: 0 }, { amount: 100000000n, scriptPubKey: deriveAddress(account, 1, 0).scriptPubKey, role: "change", branch: 1, index: 0 }] };
    await save("synthetic-intent.json", { nonexistentPrevout: true, bundle: bundleToJson(bundle) });
    console.log("Synthetic review: 1 PRL to this account, 1 PRL change, 0.00001000 PRL fee. Random nonexistent input; no broadcast.");
    const signed = await client.signBundle(bundle, account, { signal: controller.signal, onVerifiedSigned: async result => {
      const checked = finalizeTransaction(bundle, result.signatures);
      if (checked.rawTx !== result.rawTx || checked.txid !== result.txid) throw Error("Independent finalization mismatch");
      await save("signed-before-ack.json", result);
      if (JSON.parse(await readFile(`${directory}/signed-before-ack.json`, "utf8")).rawTx !== result.rawTx) throw Error("Signed persistence read-back mismatch");
    } });
    summary.syntheticSignaturesVerified = true; summary.completionWarning = signed.completionWarning ?? null;
  }
  summary.ok = true;
} catch (error) {
  summary.ok = false;
  await save("failure.json", { error: error instanceof Error ? error.message : "Pilot failed", privateError, signed: error instanceof VerifiedSigningResultError ? error.signedTransaction : undefined }).catch(() => {});
  process.exitCode = 1;
} finally {
  await close(); await save("summary.json", summary);
  console.log(JSON.stringify({ ...summary, privateOutputDirectory: directory }));
}
