# Stateless hosted adapter qualification

The hosted application serves only `apps/companion/dist` and two Node.js 24 functions: `/api/indexer/read` and `/api/indexer/broadcast`. The functions reuse the existing fixed-host, fixed-path `indexerProxy`; they do not initialize the native light client, read account profiles, create a database, cache wallet/history data, or log request/response bodies. Browser storage remains the wallet journal. Per-request bounded byte buffers and an instance-local concurrency counter are transient processing state.

## Deployment configuration

- Use this repository as the project root, Node.js **24.x**, with the root `vercel.json` settings. `buildCommand` builds the browser, prebundles the stateless server adapter, then verifies the public output allowlist.
- Set **`PEARL_WEB_ORIGIN` in production** to exactly the chosen public origin, for example `https://pearl-wallet.vercel.app`, without a trailing slash, path, port, query or fragment. Production deliberately does not infer its trusted origin from request headers or an automatically assigned hostname. Other aliases will not pass API origin validation.
- Preview builds can omit `PEARL_WEB_ORIGIN` and use `VERCEL_ENV=preview` with the platform-provided `VERCEL_URL`; only an exact generated `*.vercel.app` hostname is accepted. If a preview needs a deliberate custom origin, configure `PEARL_WEB_ORIGIN` explicitly for that environment. Do not accidentally apply the production origin to previews.
- **`NODEJS_HELPERS=0` must be present during function build.** It is configured in both `build.env` and `env` in `vercel.json`. Vercel's Node helpers otherwise read the raw request before our byte limits run. The adapter fails closed if `req.body` exists or the stream was already consumed. A Next.js `bodyParser: false` export is not used as a substitute for this non-Next.js runtime setting. See [Vercel's helper configuration](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration).
- **`VERCEL_TRACING_DISABLE_AUTOMATIC_FETCH_INSTRUMENTATION=1` must also be present during build.** Outbound indexer URL paths can contain addresses or transaction IDs. This public flag disables their automatic fetch instrumentation; the build guard requires it and the actual Node-builder replay checks that both generated functions carry `shouldDisableAutomaticFetchInstrumentation: true`. Ordinary platform request metadata is a separate infrastructure concern.
- The existing `apps/companion/ledger-live.manifest.json` is a localhost development template and is not in the static output. A hosted Discover manifest must separately use the actual reviewed HTTPS deployment URL; do not publish the localhost template.

The adapter requires exact origin/Host/HTTPS-proxy headers and a POST with a single canonical Content-Length, uncompressed `application/json`, no transfer encoding, no unexpected query/path and at most 128 KiB. It enforces the actual byte count and valid UTF-8 before replaying the original bytes to the existing proxy. Upload reading has a 5-second deadline; the existing proxy's 25-second deadline and cancellation remain active. The Vercel ceiling is 35 seconds. No broadcast retries were added, and ambiguous results retain the existing explicit unknown-outcome response.

Hashed browser assets have a one-year immutable cache policy. HTML/API responses remain `no-store`. There are no crons, analytics integrations or storage products in this configuration. Platform infrastructure may still retain ordinary request metadata; application code does not log financial data, and API URLs contain neither addresses nor transaction bytes. The upstream indexer still receives the public data requests explicitly consented to in the browser. The process-local concurrency counter is not a global abuse quota across Vercel instances; Hobby account limits and deployment access settings remain platform configuration.

## Resolved packaging failure

An initial actual `@vercel/node` build produced broken functions: it transpiled workspace `.ts` files to `.js`, but retained SDK/wallet package exports targeting `src/index.ts`. Importing the emitted function failed with `ERR_MODULE_NOT_FOUND`.

`scripts/build-hosted-server.mjs` now bundles the adapter with the existing Vite dependency before function tracing. The generated `apps/companion/server/dist/indexer.mjs` is approximately 58 KiB. The API entrypoints import that artifact. Each traced function contains just four files: its entry, entry source map, the server bundle, and package metadata. There are no npm workspace runtime exports, native binaries, wallet databases or local-light sources in the resulting function.

## Fresh local verification

- Companion TypeScript check passed after integration.
- Six adapter tests passed, including a real loopback Node HTTP request, 18 malformed/helper/origin/framing cases, invalid UTF-8, consent/allowlist rejection, and an exact signed public-fixture submission whose simulated ambiguous failure is not retried. No external broadcast or service call occurred. Evidence: `tests.txt`.
- Actual installed `@vercel/node` **5.7.13**, from Vercel CLI **52.0.0**, built both functions as `nodejs24.x` with `shouldAddHelpers=false`. Both compiled outputs imported and passed an in-process read fixture. Each output contains four files and no forbidden native/private path. Evidence: `node-builder.json`, `node-builder.txt`.
- The static output guard passed against the local client build: 10 hashed assets, approximately 2.06 MB total. It rejects extra files, source maps, unbounded output and non-allowlisted asset names. Client assets may change as the parent completes UI work, so run the final root build command again before deployment.
- Full `vercel build --non-interactive` was attempted and stopped with `project_settings_required`. No project was linked, pulled, created or deployed by this agent. Evidence: `vercel-build.txt`. The parent owns authenticated project setup, final build, plan verification and deployment smoke tests.

Replay with the project's Node 24 runtime:

```sh
node --import tsx --test apps/companion/test/hosted-indexer.test.ts
node scripts/build-hosted-server.mjs
node tools/hosted-adapter-review/check-node-builder.cjs /absolute/path/to/installed/vercel
node scripts/check-hosted-build.mjs
```

The builder replay uses installed dependencies and temporary directories; it does not install packages, link a project, pull environment variables or deploy. A final real Vercel build and HTTPS smoke test must confirm the platform passes the expected raw request headers/body and that HTML/API caching and security headers match the local configuration.
