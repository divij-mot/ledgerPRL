import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { concat, fromHex, hex } from "@pearl-ledger/sdk";
import {
  networkInfo,
  publicFixture,
  yielded,
} from "../../../packages/bitcoin-prl-adapter/test/fixtures.js";
const root = fileURLToPath(new URL("../../..", import.meta.url)),
  cli = join(root, "apps/cli/src/index.ts");
const protocol = JSON.parse(
  await readFile(
    join(
      root,
      "packages/bitcoin-prl-adapter/test/fixtures/ledger-psbt-v2.json",
    ),
    "utf8",
  ),
);
function run(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (b) => {
        stdout += b;
      });
      child.stderr.on("data", (b) => {
        stderr += b;
      });
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, stdout, stderr }));
    },
  );
}
async function files() {
  const directory = await mkdtemp(join(tmpdir(), "pearl-cli-test-")),
    data = JSON.parse(
      await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
    );
  const bundle = join(directory, "bundle.json"),
    account = join(directory, "account.json");
  await writeFile(bundle, JSON.stringify(data.bundle));
  await writeFile(account, JSON.stringify(data.publicAccount));
  return { directory, bundle, account, output: join(directory, "signed.json") };
}
async function server(
  handler: (
    apdu: Uint8Array,
    response: ServerResponse,
  ) => Promise<Uint8Array | null> | Uint8Array | null,
) {
  const requests: Uint8Array[] = [];
  const http = createServer(
    async (request: IncomingMessage, response: ServerResponse) => {
      try {
        assert.equal(request.url, "/apdu");
        assert.equal(request.method, "POST");
        let body = "";
        for await (const chunk of request) body += chunk;
        const apdu = fromHex(JSON.parse(body).data);
        requests.push(apdu);
        const result = await handler(apdu, response);
        if (result !== null) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ data: hex(result) }));
        }
      } catch (error) {
        response.writeHead(500);
        response.end(String(error));
      }
    },
  );
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  assert(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}
const ok = (value: Uint8Array = new Uint8Array()) =>
  concat(value, Uint8Array.of(0x90, 0));
async function signingServer(
  output: string,
  final: "ok" | "reject" | "lost" = "ok",
  rejectBeforeSign = false,
) {
  const fixture = publicFixture();
  let signatures = 0,
    durableChecks = 0;
  const transport = await server(async (apdu, response) => {
    if (apdu[0] === 0xe1) {
      if (apdu[1] === 6) {
        assert.equal(
          JSON.parse(await readFile(output, "utf8")).kind,
          "pearl-cli-signing-uncertain",
        );
        assert.equal((await stat(output)).mode & 0o777, 0o600);
        return ok(networkInfo());
      }
      if (apdu[1] === 5) return ok(fixture.account.masterFingerprint);
      if (apdu[1] === 0)
        return ok(new TextEncoder().encode(protocol.accountXpub));
      assert.equal(hex(apdu), protocol.signPsbtApduHex);
      if (rejectBeforeSign) return Uint8Array.of(0x69, 0x85);
    } else assert.equal(hex(apdu), "f801000100");
    if (signatures < fixture.signatures.length)
      return concat(
        yielded(fixture.bundle, fixture.signatures, signatures++),
        Uint8Array.of(0xe0, 0),
      );
    const saved = JSON.parse(await readFile(output, "utf8"));
    assert.equal(saved.rawTx, fixture.rawTx);
    assert.equal(saved.txid, fixture.txid);
    durableChecks++;
    if (final === "reject") return Uint8Array.of(0x69, 0x85);
    if (final === "lost") {
      response.destroy();
      return null;
    }
    return ok();
  });
  return {
    ...transport,
    get durableChecks() {
      return durableChecks;
    },
  };
}
test("CLI offline build/inspect/derive keep exact amounts and exclusive0600 files", async () => {
  const f = await files(),
    output = join(f.directory, "bundle.hex");
  const build = await run(["build", f.bundle, output]);
  assert.equal(build.code, 0, build.stderr);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.equal((await run(["build", f.bundle, output])).code, 1);
  const inspect = await run(["inspect", output]);
  assert.equal(inspect.code, 0, inspect.stderr);
  assert.equal(
    JSON.parse(inspect.stdout).bundle.inputs[0].amount,
    "9007199254740993",
  );
  const derived = await run(["derive", f.account, "0", "0"]);
  assert.equal(derived.code, 0);
  assert.match(derived.stdout, /rprl1p/);
  assert.equal((await run(["derive", f.account, "0", "1e2"])).code, 1);
});
test("CLI capabilities use PRL Bitcoin protocol and stringify maximum grains exactly", async () => {
  const transport = await server((apdu) => {
    assert.equal(hex(apdu), "e106000100");
    return ok(networkInfo());
  });
  try {
    const result = await run(["capabilities", "regtest", transport.url]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).maxMoney, "2100000000000000000");
    assert.equal(JSON.parse(result.stdout).protocol, "ledger-bitcoin-prl-v1");
  } finally {
    await transport.close();
  }
});
test("CLI signs through native PSBT protocol and syncs exclusive output before final device ACK", async () => {
  const f = await files(),
    transport = await signingServer(f.output);
  try {
    const result = await run([
      "sign",
      f.bundle,
      f.account,
      f.output,
      transport.url,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(transport.durableChecks, 1);
    assert.equal(
      JSON.parse(await readFile(f.output, "utf8")).rawTx,
      publicFixture().rawTx,
    );
    assert.equal((await stat(f.output)).mode & 0o777, 0o600);
    assert.match(result.stdout, /"saved"/);
  } finally {
    await transport.close();
  }
});
test("CLI retains saved verified bytes and warns when final acknowledgement fails", async () => {
  for (const mode of ["reject", "lost"] as const) {
    const f = await files(),
      transport = await signingServer(f.output, mode);
    try {
      const result = await run([
        "sign",
        f.bundle,
        f.account,
        f.output,
        transport.url,
      ]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(transport.durableChecks, 1);
      assert.equal(
        JSON.parse(await readFile(f.output, "utf8")).txid,
        publicFixture().txid,
      );
      assert.match(
        result.stderr,
        /final device acknowledgement was not confirmed/,
      );
      assert.match(result.stdout, /device-acknowledgement-unconfirmed/);
    } finally {
      await transport.close();
    }
  }
});
test("CLI keeps signing uncertainty on a pre-sign rejection; no automatic retry", async () => {
  const f = await files(),
    transport = await signingServer(f.output, "ok", true);
  try {
    const result = await run([
      "sign",
      f.bundle,
      f.account,
      f.output,
      transport.url,
    ]);
    assert.equal(result.code, 1);
    assert.equal(transport.durableChecks, 0);
    const marker = JSON.parse(await readFile(f.output, "utf8"));
    assert.equal(marker.kind, "pearl-cli-signing-uncertain");
    assert.equal(marker.bundle.inputs[0].amount, "9007199254740993");
    assert.equal(transport.requests.filter((p) => p[1] === 4).length, 1);
  } finally {
    await transport.close();
  }
});
test("existing, symlinked and invalid output paths fail before any device command", async () => {
  const f = await files(),
    transport = await server(() => {
      throw new Error("No device command permitted");
    });
  const existing = join(f.directory, "existing.json"),
    link = join(f.directory, "link.json");
  await writeFile(existing, "preserve me");
  await symlink(existing, link);
  try {
    for (const path of [
      existing,
      link,
      join(f.directory, "missing", "out.json"),
    ]) {
      const result = await run([
        "sign",
        f.bundle,
        f.account,
        path,
        transport.url,
      ]);
      assert.equal(result.code, 1);
    }
    assert.equal(transport.requests.length, 0);
    assert.equal(await readFile(existing, "utf8"), "preserve me");
  } finally {
    await transport.close();
  }
});
