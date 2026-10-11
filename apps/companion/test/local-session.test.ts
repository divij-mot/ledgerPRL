import test from "node:test";
import assert from "node:assert/strict";
import { LocalSession } from "../src/local-session.js";
import { publicAccount } from "../../../packages/wallet/test/fixtures.js";
import { accountId } from "@pearl-ledger/wallet";

const account = { ...publicAccount, network: "mainnet" as const };
test("a restored account can close its existing server profile before this page starts sync", async () => {
  const session = new LocalSession();
  let closed = false;
  await session.close(
    async (route, body: any) => {
      assert.equal(route, "/api/local/close");
      assert.equal(body.owner, accountId(account));
      closed = true;
      return { closed: true };
    },
    undefined,
    account,
  );
  assert(closed);
});

test("close waits for an in-flight start and sends its exact owner", async () => {
  const session = new LocalSession();
  let finish!: (value: unknown) => void;
  const calls: { route: string; body: any }[] = [];
  const post = async (route: string, body: unknown) => {
    calls.push({ route, body });
    if (route.endsWith("/start"))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return { closed: true };
  };
  const starting = session.start(account, [-1, -1], post);
  const closing = session.close(post);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  finish({ ready: false });
  await Promise.all([starting, closing]);
  assert.equal(calls[1]!.route, "/api/local/close");
  assert.equal(calls[1]!.body.owner, accountId(account));
  await session.close(post);
  assert.equal(calls.length, 2);
});

test("uncertain startup and failed close retain ownership; cancellation cannot silently switch profiles", async () => {
  const session = new LocalSession();
  await assert.rejects(
    session.start(account, [-1, -1], async () => {
      throw Error("lost response");
    }),
  );
  await assert.rejects(
    session.close(async () => {
      throw Error("busy");
    }),
  );
  const different = { ...account, chainCode: new Uint8Array(32).fill(9) };
  assert.throws(
    () => session.start(different, [-1, -1], async () => ({})),
    /previous local/,
  );
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(
    session.close(async () => {
      throw Error("must not post");
    }, cancel.signal),
  );
  await session.close(async (_route, body: any) => {
    assert.equal(body.owner, accountId(account));
    return { closed: true };
  });
  await session.start(different, [-1, -1], async () => ({}));
});
