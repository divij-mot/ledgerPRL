/** Read-only HTTPS deployment checks; no addresses, account keys or valid broadcast payloads. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const origin = process.argv[2];
const url = new URL(origin);
assert(url.protocol === 'https:' && url.origin === origin && !url.username && !url.password, 'Pass one exact HTTPS origin');
const results = [];
async function check(label, target, init = {}, statuses = [200]) {
  const response = await fetch(origin + target, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const chunks = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        total += value.length;
        assert(total <= 4 * 1024 * 1024, `${label}: unexpectedly large response`);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const bytes = Buffer.concat(chunks, total);
  const body = new TextDecoder().decode(bytes);
  const headers = Object.fromEntries(['content-type','cache-control','content-security-policy','permissions-policy','x-frame-options','referrer-policy','x-content-type-options'].map(name => [name,response.headers.get(name)]));
  results.push({ label, target, status: response.status, bytes: bytes.length, bodySha256: createHash('sha256').update(bytes).digest('hex'), headers });
  assert(statuses.includes(response.status), `${label}: HTTP ${response.status}, expected ${statuses.join('/')}`);
  return { response, body, headers };
}
function post(body, extra = {}) {
  return { method: 'POST', headers: { origin, 'x-pearl-companion': '1', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) };
}
try {
  const html = await check('Ledger Discover entry', '/live.html');
  assert(html.body.includes('id="app"'), 'Wallet entry missing');
  assert(html.headers['cache-control']?.includes('no-store'), 'HTML must not be stored');
  assert(html.headers['content-security-policy']?.includes("connect-src 'self'"), 'Same-origin CSP missing');
  assert(html.headers['content-security-policy']?.includes("frame-ancestors 'none'"), 'Framing restriction missing');
  assert(html.headers['permissions-policy']?.includes('camera=(self)'), 'Camera permission policy missing');
  const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html.body)?.[1];
  assert(asset, 'No hashed script found');
  const cached = await check('Immutable script cache', asset, { method: 'HEAD' });
  assert(cached.headers['cache-control']?.includes('immutable'), 'Hashed asset cache missing');
  const notices = await check('Shipped jsQR attribution', '/third-party-notices.txt');
  assert(notices.body.includes('jsqr 1.4.0') && notices.body.includes('Apache License'), 'jsQR licence missing');
  for (const target of ['/.env', '/.local-light/.owner.json', '/apps/light-client/bin/pearl-watch', '/api/local/status', '/api/check']) {
    await check('Private/native path absent', target, {}, [404]);
  }
  await check('API rejects GET', '/api/indexer/read', {}, [405]);
  const valid = { network: 'mainnet', consent: true, path: '/api/v2/' };
  const read = await check('Public chain status via raw adapter', '/api/indexer/read', post(valid));
  assert(read.headers['cache-control']?.includes('no-store'), 'API must not be stored');
  assert(JSON.parse(read.body).backend.chain === 'mainnet', 'Unexpected public chain');
  await check('Origin isolation', '/api/indexer/read', post(valid, { origin: 'https://untrusted.example' }), [403]);
  await check('Disclosure consent required', '/api/indexer/read', post({ ...valid, consent: false }), [400]);
  await check('Arbitrary URL rejected', '/api/indexer/read', post({ ...valid, path: 'https://127.0.0.1/private' }), [400]);
  await check('Compressed upload rejected', '/api/indexer/read', post(valid, { 'content-encoding': 'gzip' }), [415]);
  await check('128 KiB body bound', '/api/indexer/read', post(' '.repeat(128 * 1024 + 1)), [413]);
  await check('Native network rejected', '/api/indexer/read', post({ ...valid, network: 'regtest' }), [400]);
  await check('Broadcast consent rejection before submission', '/api/indexer/broadcast', post({ network: 'mainnet', consent: false }), [400]);
  await writeFile(new URL('./preview-results.json', import.meta.url), JSON.stringify({ origin, checkedAt: new Date().toISOString(), outcome: 'passed', realBroadcasts: 0, walletAddresses: 0, results }, null, 2) + '\n');
  console.log(`Passed ${results.length} read-only hosted checks.`);
} catch (error) {
  await writeFile(new URL('./preview-results.json', import.meta.url), JSON.stringify({ origin, checkedAt: new Date().toISOString(), outcome: 'incomplete', error: String(error), realBroadcasts: 0, walletAddresses: 0, results }, null, 2) + '\n');
  throw error;
}
