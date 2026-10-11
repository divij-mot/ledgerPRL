/** Uses the already installed Vercel builder; no install, link, pull or deployment. */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');

(async () => {
  const vercelDirectory = process.argv[2];
  assert(vercelDirectory && path.isAbsolute(vercelDirectory), 'Pass the installed Vercel package directory');
  const fromVercel = createRequire(path.join(vercelDirectory, 'package.json'));
  const { build } = fromVercel('@vercel/node');
  const { FileFsRef, download } = fromVercel('@vercel/build-utils');
  const root = path.resolve(__dirname, '../..');
  const config = JSON.parse(await fs.readFile(path.join(root, 'vercel.json'), 'utf8'));
  assert.equal(config.build.env.NODEJS_HELPERS, '0');
  assert.equal(config.env.NODEJS_HELPERS, '0');
  assert.equal(config.build.env.VERCEL_TRACING_DISABLE_AUTOMATIC_FETCH_INSTRUMENTATION, '1');
  assert.equal(config.env.VERCEL_TRACING_DISABLE_AUTOMATIC_FETCH_INSTRUMENTATION, '1');
  process.env.NODEJS_HELPERS = config.build.env.NODEJS_HELPERS;
  process.env.VERCEL_TRACING_DISABLE_AUTOMATIC_FETCH_INSTRUMENTATION = '1';
  process.env.PEARL_WEB_ORIGIN = 'https://wallet.example.com';
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'pearl-hosted-builder-'));
  const results = [];
  const originalFetch = global.fetch;
  let fetches = 0;
  global.fetch = async (url) => {
    assert.equal(url, 'https://blockbook.pearlresearch.ai/api/v2/');
    fetches++;
    return Response.json({ ok: true });
  };
  try {
    for (const name of ['read', 'broadcast']) {
      const entrypoint = `api/indexer/${name}.ts`;
      const result = await build({
        files: { [entrypoint]: new FileFsRef({ fsPath: path.join(root, entrypoint) }) },
        entrypoint, workPath: root,
        config: { zeroConfig: true, excludeFiles: config.functions['api/indexer/*.ts'].excludeFiles, projectSettings: { nodeVersion: '24.x' } },
        meta: { skipDownload: true, runNpmInstallSet: new Set([path.join(root, 'package.json')]) },
      });
      const output = result.output;
      const files = Object.keys(output.files).sort();
      const forbiddenFiles = files.filter((f) => /(^|\/)(?:\.tools|\.local-light|tools|fixtures|light-client|ledger-bitcoin-prl)(?:\/|$)|\.db$|\.bin$|local-service|local-main|light-runtime|serve_native/.test(f));
      assert.deepEqual(forbiddenFiles, []);
      assert.equal(output.shouldAddHelpers, false);
      assert.equal(output.shouldDisableAutomaticFetchInstrumentation, true);
      assert.equal(output.runtime, 'nodejs24.x');
      assert.equal(files.length, 4);
      const outDir = path.join(staging, name);
      await fs.mkdir(outDir);
      await download(output.files, outDir);
      const module = await import(pathToFileURL(path.join(outDir, output.handler)).href);
      assert.equal(typeof module.default, 'function');
      const body = JSON.stringify({ network: 'mainnet', consent: true, path: '/api/v2/' });
      const headers = { host: 'wallet.example.com', origin: process.env.PEARL_WEB_ORIGIN, 'x-forwarded-proto': 'https', 'x-pearl-companion': '1', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) };
      const request = Object.assign(new PassThrough(), { method: 'POST', url: '/api/indexer/read', headers, rawHeaders: Object.entries(headers).flat() });
      let status = 0, responseBody = '';
      const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false, setHeader() {}, writeHead(value) { status = value; }, end(value) { responseBody = value; this.writableEnded = true; } });
      const promise = module.default(request, response);
      request.end(body);
      await promise;
      assert.equal(status, 200);
      assert.deepEqual(JSON.parse(responseBody), { ok: true });
      results.push({ entrypoint, runtime: output.runtime, handler: output.handler, shouldAddHelpers: output.shouldAddHelpers, shouldDisableAutomaticFetchInstrumentation: output.shouldDisableAutomaticFetchInstrumentation, fileCount: files.length, forbiddenFiles, compiledHandlerFixture: 'passed', files });
    }
    assert.equal(fetches, 2);
    const report = { builder: `@vercel/node ${fromVercel('@vercel/node/package.json').version}`, source: `installed Vercel CLI ${fromVercel('./package.json').version}`, externalRequests: 0, results };
    await fs.writeFile(path.join(__dirname, 'node-builder.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(results.map(({ files, ...result }) => result), null, 2));
  } finally {
    global.fetch = originalFetch;
    await fs.rm(staging, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
