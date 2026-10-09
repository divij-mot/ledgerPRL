# Dedicated HTTPS Pearl wallet website

The companion can be hosted as a standalone website that connects directly to a Ledger using WebHID. MetaMask is not required. Browser-side code derives the public addresses, validates public chain data, constructs transactions and verifies returned signatures. Private keys remain on the Ledger. Signing and broadcasting require separate user actions.

**Development software, not a production security certification.** Physical devices/OS combinations, independent human review and Ledger approval remain release gates. Do not use valuable funds. HTTPS and successful tests do not make a compromised frontend, dishonest indexer or unreviewed firmware safe.

## Hosting model

Use one dedicated HTTPS origin, for example `https://wallet.example.com`. Do not share this origin with another app, unrelated uploads, third-party scripts, an existing service worker, analytics or session cookies. The browser's account/recovery journal is origin-scoped; changing the hostname is a migration, not a transparent restart.

- A trusted TLS reverse proxy on the **same host** forwards to the backend at `127.0.0.1:8788`. Do not bind the backend to a LAN/public interface, publish this port through a container mapping, or expose its HTTP origin directly.
- The server checks exact configured `Host`, an exact HTTPS `Origin` when present, and `X-Forwarded-Proto: https`. API requests additionally require the exact Origin, a custom same-origin header, public-data disclosure consent and the permitted method. Forwarded host/IP values never establish trust. The TLS proxy is part of the trusted deployment; the forwarded-protocol header is not itself cryptographic TLS proof.
- Static delivery is only `/`, `/index.html` and approved content-hashed files under `/assets/`. The server snapshots a bounded build into memory before listening. It performs no request-driven filesystem lookup and rejects source maps, source paths, directory listings, arbitrary SPA paths, query strings, encoded paths and symlinks. The sample watch-account JSON is not a website route.
- Only `POST /api/indexer/read` and `POST /api/indexer/broadcast` are exposed. There is no upload endpoint, account database, private-node bridge, account/xpub discovery endpoint, arbitrary destination URL or generic RPC gateway. The server does not import the local-node bridge.
- The same-origin proxy contacts only the fixed public mainnet and testnet2 Blockbook services. The browser sends narrow public-address/transaction read paths and, only after broadcast approval, exact signed transaction bytes. It does not upload account keys, the local journal or backups. Invalid extra request fields are rejected before upstream contact.
- The server emits a real restrictive HTTP CSP, including same-origin scripts/styles/workers/connections, no frames, no forms and no inline-script/eval exceptions. WebHID is allowed only for the same origin. It emits HSTS, `nosniff`, no-referrer, frame denial and same-origin resource/opener policy. It emits no CORS grants or cookies. The HTML meta CSP remains an additional restriction; production HTTP CSP does not allow the local development WebSocket.
- HTML/API/errors use `Cache-Control: no-store`. Only content-hashed static assets are immutable-cacheable. No service worker is installed. Do not put a cache or CDN in front of the API or add third-party content transformations.

The supported Node CLI fixes the bind address to loopback. Defaults are port `8788`; the optional `PEARL_WEB_PORT` must be 1024–65535. `PEARL_WEB_ORIGIN` is mandatory and must be one canonical HTTPS origin with no credentials, path, query, fragment or trailing slash. `https://wallet.example.com:8443` is a separate origin requiring that exact Host, browser URL and proxy setup. No RPC credentials are needed or accepted as production configuration. Do not set Vite-prefixed environment variables to secrets: Vite deliberately exposes such values to client builds.

## Build and start

Use the repository's supported Node version (currently 24.19 or newer compatible 24.x) and pinned lockfile. From the repository root:

```sh
npm ci --ignore-scripts
npm run check
PEARL_WEB_ORIGIN=https://wallet.example.com \
  node --import tsx apps/companion/src/web-server.ts
```

`npm run check` includes the production build. To rebuild an already verified checkout alone, use `npm run build --workspace @pearl-ledger/companion`. The server fails closed if no compiled `index.html` with emitted JS/CSS assets is present. Runtime TypeScript loading uses the pinned local `tsx`; retain the workspace packages and installed dependencies, but only compiled static assets are accessible over HTTP.

The process prints a generic startup line/error and no access log, request bodies, addresses, signed transactions, cookies or credentials. Deploy under an unprivileged service account with a **read-only, owner-controlled release tree**. The service account must not be able to edit the frontend it serves, its dependencies or reverse-proxy configuration. Never run this process as root, enable Node's remote inspector, or install it in a shared writable directory. The sample [systemd unit](../apps/companion/deploy/pearl-wallet.service.example) is a template; adjust the checkout and actual supported Node executable paths. This repository does not install services or change host security settings.

Build replacements in a new release directory, run checks, atomically switch the operator-controlled release path and restart the backend. Do not modify a release while it loads or runs. Its in-memory asset snapshot will not pick up edited files automatically. Before a wallet-code upgrade, users should export a full watch-wallet backup and close other wallet tabs. New and old loaded bundles must not operate the same journal concurrently. Never erase journal data or signed/uncertain reservations as an upgrade workaround.

## Trusted public TLS with Caddy

The [Caddyfile template](../apps/companion/deploy/Caddyfile.example) terminates TLS and preserves the original Host. It has no access-log directive and excludes HTTP request error logs, which could contain request metadata; non-request operational logs remain. Do not enable debug, request/body tracing, analytics, `log_credentials`, proxy plugins that inspect bodies, or provider request capture. Review infrastructure logging too.

An operator should:

1. Choose a dedicated hostname under a domain they control and point its DNS A/AAAA records to the intended host. Check that every published IPv4/IPv6 address serves the same approved deployment. Remove an unusable AAAA record rather than letting some clients reach a different service.
2. Install a current supported Caddy release from its [official installation route](https://caddyserver.com/docs/install) and a supported Node runtime. Replace the example hostname consistently in the Caddyfile, `PEARL_WEB_ORIGIN` and any service definition. These are planned operator steps; no installation or DNS change has been performed here.
3. Permit intended HTTPS traffic on port 443 and the needed certificate/redirect traffic on port 80; keep backend port 8788 and management port 2019 unreachable externally. Caddy's automatic HTTPS requires valid DNS and reachable challenge ports unless a separately reviewed challenge arrangement is configured. Certificate issuance can involve certificate-authority terms; the operator must review those when deploying.
4. Validate the edited configuration with `caddy validate --config /path/to/Caddyfile --adapter caddyfile`, then start/reload it through its supported service workflow. Confirm public certificate trust and hostname matching in a normal browser. Do not bypass certificate warnings or disable TLS verification. Never use `curl -k` as an acceptance check.
5. Run the public smoke checks below from a separate client. Check the actual browser network/security panels, not only the loopback server. Confirm no mixed-content requests, CSP violations, unexpected connections or cookies. Confirm the page is a secure context and `navigator.hid` exists in the chosen desktop Chromium/Edge browser.

Caddy automatically provisions and renews publicly trusted certificates for qualifying public hostnames. Keep its certificate/key storage owned by the proxy service and monitor certificate-renewal failures without collecting wallet requests. Private/local CA certificates need an explicitly administered trust setup; this guide does not ask users to install a root certificate or bypass a browser warning. A localhost development URL remains available through the separate loopback Vite workflow.

Official references: [automatic HTTPS and prerequisites](https://caddyserver.com/docs/automatic-https), [reverse proxy and header handling](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [server timeouts and SNI controls](https://caddyserver.com/docs/caddyfile/options), [body limits](https://caddyserver.com/docs/caddyfile/directives/request_body), [service operation](https://caddyserver.com/docs/running). Validate the template against the exact installed Caddy version; this task did not start a real certificate-issuing proxy or alter a public deployment.

## Public smoke checks, without a device or funds

Replace the example hostname. These requests contain no account data or signed transaction. The last one must fail before any upstream request because consent is false.

```sh
curl --fail --show-error --head https://wallet.example.com/
curl --show-error --path-as-is --include https://wallet.example.com/src/main.ts
curl --show-error --path-as-is --include https://wallet.example.com/%2e%2e/.env
curl --show-error --include -X OPTIONS https://wallet.example.com/api/indexer/read
curl --show-error --include https://wallet.example.com/api/indexer/read \
  -H 'Origin: https://wallet.example.com' \
  -H 'X-Pearl-Companion: 1' -H 'Content-Type: application/json' \
  --data '{"network":"mainnet","consent":false,"path":"/api/v2/"}'
```

Expect respectively 200 with the restrictive headers, 404, 404, 405 and 400. A proxy may reject malformed traversal earlier; it must never serve files. Check one actual hashed JS/CSS path from the returned HTML for 200, the correct MIME type and immutable caching. A request with an unrelated Origin must fail; there must be no permissive CORS or `Set-Cookie`. Verify the loopback backend is not reachable remotely. Browser opening/import/backup/receive/signing tests are separate qualification stages; never perform a real broadcast as a hosting smoke test.

## Bounds and privacy

Each API request must be uncompressed JSON with a known Content-Length no greater than 128 KiB. Chunked streaming uploads and `Expect` are refused. Incoming headers are bounded to 8 KiB; request headers/body have 5/10-second deadlines, idle sockets have a 30-second timeout, and the server caps concurrent sockets at 128. Indexer work has a 25-second overall operation deadline, at most 16 active operations, bounded upstream responses and no automatic broadcast retry. Static builds are capped at 128 asset-directory entries, 8 MiB per file and 32 MiB total. These limits reduce abuse; they are not a full volumetric DoS defense. The proxy template also bounds requests/timeouts. If additional edge protection is needed, review its privacy/security tradeoffs before introducing a third-party intermediary.

The browser **must retain** issued-address high-water marks, payment journals, exact saved signed bytes and input reservations in its origin's IndexedDB. Saving the full watch-account public key/chain code and balance snapshot is optional and happens only through the explicit Save watch data action. These are public recovery/signing-safety metadata, not private keys. They are still sensitive financial metadata; anyone with browser-profile access or the same origin's execution privileges may be able to read them. Full backups should be handled privately. Clearing browser data can destroy recovery/uncertainty information and must not be used to unlock funds. Private browsing, eviction, device loss and changing origins can lose local state; export a complete watch-wallet backup and retain the Ledger's ordinary seed backup offline.

With explicit public-service consent, the hosting operator can observe client IP/timing plus derived address/transaction queries and signed broadcast bytes passing through the service. The fixed indexer can link queried addresses, transaction IDs and query timing; it sees the hosting server's egress IP. An external reverse proxy, CDN or hosting provider may also observe this data even if application logging is disabled. This is not anonymous access. No analytics does not mean no observable metadata. The node/indexer can omit, censor or lie about chain data; browser verification is not independent consensus verification. Always compare the recipient, amount and fee on the Ledger screen.

No seed words, PIN, private key, RPC password or API key belongs in the website, a URL, uploaded file, client environment or support report. The Ledger remains the signing authority, but a malicious served application can still misuse public metadata or present a misleading transaction request. Domain, TLS, immutable release, dependency and host security remain important.

## Separate local workflow

`npm run dev` and the existing `preview` command remain loopback Vite workflows. Do not put Vite dev/preview on the internet or use them as the production server. The optional authenticated private-node bridge stays local and is **not mounted** by `web-server.ts`; setting local-node RPC environment variables does not add that route to the website. A static-file-only host cannot provide the same-origin indexer API and is not the supported deployment.

## Automated verification scope

`apps/companion/test/web-server.test.ts` uses actual loopback HTTP requests and injected synthetic upstream responses. It verifies serving/header policy, methods, exact origins/duplicate headers, traversal/source/map denial, immutable asset snapshots, symlink rejection, request bounds, no upload/private-node routes and no forwarding of client Cookie/Authorization. It does not issue certificates, exercise real Caddy/TLS, connect physical devices or send funds. Run the full repository checks again after changes; a unit suite does not establish a public deployment's configuration or browser/hardware compatibility.
