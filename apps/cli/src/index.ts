#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  LedgerPearlClient,
  network,
  parseTransaction,
  SpeculosTransport,
  type NetworkName,
} from "@pearl-ledger/sdk";
const usage = `Pearl Ledger development CLI (no seed import and no software signer)
  inspect <bundle.json|bundle.hex>
  build <bundle.json> <output.hex>
  tx <raw-transaction.hex>
  derive <account.json> <branch> <index>
  capabilities <network> [http://127.0.0.1:5000]
  account <network> <account-index> <output.json> [speculos-url]
  verify <account.json> <branch> <index> [speculos-url]
  sign <bundle.json|bundle.hex> <account.json> <output.json> [speculos-url]
All amounts in bundle JSON are exact integer grain strings. A sign command
requires approval in Speculos/the device UI. It never clicks Approve.
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
function print(value: unknown) {
  process.stdout.write(
    JSON.stringify(
      value,
      (_, v) =>
        typeof v === "bigint"
          ? v.toString()
          : v instanceof Uint8Array
            ? hex(v)
            : v,
      2,
    ) + "\n",
  );
}
async function save(path: string, value: unknown) {
  await writeFile(
    resolve(path),
    JSON.stringify(
      value,
      (_, v) =>
        typeof v === "bigint"
          ? v.toString()
          : v instanceof Uint8Array
            ? hex(v)
            : v,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
async function main(args: string[]) {
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
  const client = new LedgerPearlClient(transport, name);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    if (operation === "capabilities")
      print(await client.capabilities(controller.signal));
    else if (operation === "account") {
      const result = await client.exportAccount(
        integer(rest[1]),
        controller.signal,
      );
      await save(rest[2]!, accountToJson(result));
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
      const result = await client.signBundle(b, a, {
        signal: controller.signal,
        onProgress: (phase) => {
          if (phase === "review")
            process.stderr.write(
              "Review the full recipient, amount, fee and change on the device.\n",
            );
        },
      });
      await save(rest[2]!, result);
      print({ txid: result.txid, vsize: result.vsize, saved: rest[2] });
    }
  } finally {
    process.removeListener("SIGINT", cancel);
    await client.close().catch(() => transport.close());
  }
}
main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
