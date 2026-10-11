import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHostedIndexer } from '../../apps/companion/src/hosted-indexer.js';
import { BlockbookSource } from '../../apps/companion/src/blockbook-source.js';
import { loadFeeQuotes } from '../../apps/companion/src/fee-quotes.js';
import { discoverAccount } from '@pearl-ledger/wallet';
import { NETWORKS } from '@pearl-ledger/sdk';
import { publicAccount } from '../../packages/wallet/test/fixtures.js';

const origin = 'https://wallet.example.com';
function call(handler: ReturnType<typeof createHostedIndexer>) {
  const raw = JSON.stringify({ network: 'mainnet', consent: true, path: '/api/v2/' });
  const headers = { host: 'wallet.example.com', origin, 'x-forwarded-proto': 'https', 'content-type': 'application/json', 'x-pearl-companion': '1', 'content-length': String(raw.length) };
  const request = Object.assign(new PassThrough(), { method: 'POST', url: '/api/indexer/read', headers, rawHeaders: Object.entries(headers).flat() });
  let status = 0;
  const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, setHeader() {}, writeHead(value: number) { status = value; }, end() { this.writableEnded = true; } });
  const done = handler(request as unknown as IncomingMessage, response as unknown as ServerResponse);
  request.end(raw);
  return { done, response, status: () => status };
}

test('17 simultaneous requests cap upstream work at 16 and disconnects release every slot', async () => {
  let calls = 0, aborted = 0, pass = false;
  let reached!: () => void;
  const full = new Promise<void>(resolve => { reached = resolve; });
  const handler = createHostedIndexer(origin, async (_url, init) => {
    calls++;
    if (pass) return Response.json({ ok: true });
    if (calls === 16) reached();
    return new Promise<Response>((_resolve, reject) => {
      assert(init?.signal);
      init.signal.addEventListener('abort', () => { aborted++; reject(new Error('fixture cancellation')); }, { once: true });
    });
  });
  const pending = Array.from({ length: 17 }, () => call(handler));
  await full;
  await pending[16]!.done;
  assert.equal(pending[16]!.status(), 429);
  assert.equal(calls, 16);
  for (const invocation of pending.slice(0, 16)) {
    invocation.response.destroyed = true;
    invocation.response.emit('close');
  }
  await Promise.all(pending.map(value => value.done));
  assert.equal(aborted, 16);
  pass = true;
  const after = call(handler);
  await after.done;
  assert.equal(after.status(), 200);
  assert.equal(calls, 17);
});

function emptyChain() {
  const requests: string[] = [];
  let active = 0, peak = 0;
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    requests.push(url);
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    const pathname = new URL(url).pathname;
    if (pathname === '/api/v2/') return Response.json({ blockbook: { decimals: 8, inSync: true, initialSync: false, inSyncMempool: true, bestHeight: 200 }, backend: { chain: 'mainnet', blocks: 200, bestBlockHash: '22'.repeat(32) } });
    if (pathname.includes('/block-index/')) return Response.json({ blockHash: pathname.endsWith('/0') ? NETWORKS.mainnet.genesisHash : '22'.repeat(32) });
    if (pathname.includes('/address/')) return Response.json({ address: pathname.split('/').at(-1), txs: 0, unconfirmedTxs: 0, totalPages: 1, page: 1, itemsOnPage: 1000, txids: [] });
    if (pathname.includes('/estimatefee/')) return Response.json({ result: '0.00001000' });
    assert.fail('unexpected fixture endpoint');
  };
  return { source: new BlockbookSource('mainnet', fetcher), requests, peak: () => peak };
}

test('empty account discovery costs exactly 46 upstream reads, with address concurrency at most five', async () => {
  const fixture = emptyChain();
  const account = { ...publicAccount, network: 'mainnet' as const };
  const result = await discoverAccount(fixture.source, account);
  assert.equal(result.complete, true);
  assert.equal(result.history.length, 0);
  assert.equal(result.snapshot.coins.length, 0);
  assert.equal(fixture.requests.length, 46);
  assert.equal(fixture.requests.filter(url => url.includes('/address/')).length, 40);
  assert.equal(fixture.requests.filter(url => url.includes('/utxo/')).length, 0);
  assert(fixture.peak() <= 5);
});

test('one uncached fee quote group costs six public non-address reads', async () => {
  const fixture = emptyChain();
  const quotes = await loadFeeQuotes(fixture.source);
  assert.equal(quotes.length, 3);
  assert.equal(fixture.requests.length, 6);
  assert(fixture.requests.every(url => !url.includes('/address/') && !url.includes('/utxo/')));
  assert(fixture.peak() <= 3);
});
