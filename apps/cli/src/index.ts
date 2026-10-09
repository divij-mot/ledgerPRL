#!/usr/bin/env node
import { open, readFile, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LedgerBitcoinPrlClient,
  VerifiedSigningResultError,
} from "@pearl-ledger/bitcoin-prl-adapter";
import {
  accountFromJson,
  accountToJson,
  bundleFromJson,
  bundleToJson,
  decodeBundle,
  deriveAddress,
  encodeBundle,
  fromHex,
  hex,
  inspectBundle,
  network,
  parseTransaction,
  SpeculosTransport,
  type NetworkName,
} from "@pearl-ledger/sdk";
const usage = `Pearl Ledger Bitcoin-protocol development CLI (no seed import and no software signer)
  inspect <bundle.json|bundle.hex>
  build <bundle.json> <output.hex>
  tx <raw-transaction.hex>
  derive <account.json> <branch> <index>
  capabilities <network> [http://127.0.0.1:5000]
  account <network> <account-index> <output.json> [speculos-url]
  verify <account.json> <branch> <index> [speculos-url]
  sign <bundle.json|bundle.hex> <account.json> <output.json> [speculos-url]
All amounts in bundle JSON are exact integer grain strings. A sign command
requires the matching ledger-bitcoin-prl app and approval in Speculos/the
 device UI. It never clicks Approve. No legacy PRL1 downgrade is attempted.
Signing reserves the exclusive output path before any device command. If it
fails, retain its signing-uncertain record and reconcile before trying again.
There is deliberately no broadcast command; review/export then use a trusted
node's explicit sendrawtransaction action. Do not use development apps with funds.`;
function integer(text: string | undefined): number {
  if (!text || !/^(0|[1-9][0-9]*)$/.test(text))
    throw new Error("Expected unsigned integer");
  const n = Number(text);
  if (!Number.isSafeInteger(n)) throw new Error("Integer out of range");
  return n;
}
async function json(path: string) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}
async function bundle(path: string) {
  const text = (await readFile(resolve(path), "utf8")).trim();
  return text.startsWith("{")
    ? bundleFromJson(JSON.parse(text))
    : decodeBundle(fromHex(text));
}
function jsonText(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_, v) =>
        typeof v === "bigint"
          ? v.toString()
          : v instanceof Uint8Array
            ? hex(v)
            : v,
      2,
    ) + "\n"
  );
}
function print(value: unknown) {
  process.stdout.write(jsonText(value));
}
/** Reserve before a device operation: no overwrite, no symlink following, private permissions. */
async function reserveOutput(path: string): Promise<FileHandle> {
  const target = resolve(path),
    file = await open(target, "wx", 0o600);
  try {
    if (!(await file.stat()).isFile())
      throw new Error("Output must be a regular file");
    // Persist the new directory entry before an approval can generate signatures.
    if (process.platform !== "win32") {
      const directory = await open(dirname(target), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
/** Only the descriptor created exclusively by this invocation can be updated. */
async function writeReserved(file: FileHandle, value: unknown): Promise<void> {
  const bytes = Buffer.from(jsonText(value));
  await file.truncate(0);
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await file.write(
      bytes,
      offset,
      bytes.length - offset,
      offset,
    );
    if (bytesWritten === 0) throw new Error("Output write made no progress");
    offset += bytesWritten;
  }
  await file.sync();
}
export async function main(args: string[]) {
  const [operation, ...rest] = args;
  if (!operation || operation === "help" || operation === "--help") {
    console.log(usage);
    return;
  }
  const required = (n: number) => {
    if (rest.length < n || rest.length > n + 1) throw new Error(usage);
  };
  if (operation === "inspect") {
    required(1);
    const b = await bundle(rest[0]!);
    print({ ...inspectBundle(b), bundle: bundleToJson(b) });
    return;
  }
  if (operation === "build") {
    required(2);
    await writeFile(
      resolve(rest[1]!),
      hex(encodeBundle(bundleFromJson(await json(rest[0]!)))) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return;
  }
  if (operation === "tx") {
    required(1);
    print(parseTransaction((await readFile(resolve(rest[0]!), "utf8")).trim()));
    return;
  }
  if (operation === "derive") {
    required(3);
    print(
      deriveAddress(
        accountFromJson(await json(rest[0]!)),
        integer(rest[1]) as 0 | 1,
        integer(rest[2]),
      ),
    );
    return;
  }
  let name: NetworkName, url: string | undefined;
  if (operation === "capabilities") {
    required(1);
    name = rest[0] as NetworkName;
    url = rest[1];
  } else if (operation === "account") {
    required(3);
    name = rest[0] as NetworkName;
    url = rest[3];
  } else if (operation === "verify") {
    required(3);
    name = accountFromJson(await json(rest[0]!)).network;
    url = rest[3];
  } else if (operation === "sign") {
    required(3);
    name = (await bundle(rest[0]!)).network;
    url = rest[3];
  } else throw new Error(usage);
  network(name);
  const transport = new SpeculosTransport(url);
  const client = new LedgerBitcoinPrlClient(transport, name);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  let output: FileHandle | undefined;
  try {
    if (operation === "account" || operation === "sign")
      output = await reserveOutput(rest[2]!);
    if (operation === "capabilities")
      print(await client.capabilities(controller.signal));
    else if (operation === "account") {
      const result = await client.exportAccount(
        integer(rest[1]),
        controller.signal,
      );
      await writeReserved(output!, accountToJson(result));
      print(accountToJson(result));
    } else if (operation === "verify")
      print({
        verifiedAddress: await client.verifyAddress(
          accountFromJson(await json(rest[0]!)),
          integer(rest[1]) as 0 | 1,
          integer(rest[2]),
          controller.signal,
        ),
      });
    else {
      const b = await bundle(rest[0]!),
        a = accountFromJson(await json(rest[1]!));
      print(inspectBundle(b));
      // This survives interruption. It is a conservative intent/reconciliation record,
      // not evidence that signatures do or do not exist, and is not a wallet journal.
      await writeReserved(output!, {
        kind: "pearl-cli-signing-uncertain",
        network: b.network,
        bundle: bundleToJson(b),
        warning:
          "Signing may be incomplete or may already have succeeded. Do not create a replacement payment before reconciliation.",
      });
      let savedRawTx: string | undefined;
      const result = await client.signBundle(b, a, {
        signal: controller.signal,
        onVerifiedSigned: async (signed) => {
          await writeReserved(output!, signed);
          savedRawTx = signed.rawTx;
        },
        onProgress: (phase) => {
          if (phase === "review")
            process.stderr.write(
              "Review the full recipient, amount, fee and change on the device.\n",
            );
        },
      });
      if (savedRawTx !== result.rawTx)
        throw new Error("Returned signed bytes differ from the durable output");
      if (result.completionWarning)
        process.stderr.write(
          "Signed bytes were saved, but the final device acknowledgement was not confirmed. Reconnect before further device operations; do not re-sign or broadcast automatically.\n",
        );
      print({
        txid: result.txid,
        vsize: result.vsize,
        saved: rest[2],
        ...(result.completionWarning
          ? { completionWarning: result.completionWarning }
          : {}),
      });
    }
  } catch (error) {
    if (error instanceof VerifiedSigningResultError) {
      // The filesystem may be full/unavailable. The typed result must never disappear
      // into a generic error after the hardware has already created valid signatures.
      process.stderr.write(
        "SIGNED TRANSACTION RECOVERY: storage was not confirmed. Retain these exact bytes; do not sign a replacement.\n",
      );
      process.stderr.write(
        jsonText({
          txid: error.signedTransaction.txid,
          wtxid: error.signedTransaction.wtxid,
          rawTx: error.signedTransaction.rawTx,
          storageError: String(error.failure),
        }),
      );
    }
    throw error;
  } finally {
    try {
      await output?.close();
    } finally {
      process.removeListener("SIGINT", cancel);
      await client.close().catch(() => transport.close());
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
