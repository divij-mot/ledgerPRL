/** Fail the hosted build if anything except reviewed static output would be published. */
import assert from "node:assert/strict";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.VERCEL === "1") {
  assert.equal(
    process.env.NODEJS_HELPERS,
    "0",
    "Hosted raw-body helpers must remain disabled",
  );
  assert.equal(
    process.env.VERCEL_TRACING_DISABLE_AUTOMATIC_FETCH_INSTRUMENTATION,
    "1",
    "Automatic outgoing fetch tracing must remain disabled for address privacy",
  );
}

const root = fileURLToPath(new URL("../apps/companion/dist/", import.meta.url));
const topLevel = [
  "assets",
  "index.html",
  "live.html",
  "third-party-notices.txt",
];
assert.deepEqual(
  (await readdir(root)).sort(),
  topLevel.sort(),
  "Unexpected hosted static output",
);
assert(
  (await lstat(path.join(root, "assets"))).isDirectory(),
  "Assets directory required",
);
let total = 0;
const assets = await readdir(path.join(root, "assets"));
assert(assets.length <= 128, "Too many static assets");
for (const file of assets) {
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8,}\.(js|css|png|webp|svg|ico|woff|woff2)$/.test(
      file,
    ),
    "Unexpected static asset",
  );
}
for (const relative of [
  ...topLevel.filter((name) => name !== "assets"),
  ...assets.map((name) => `assets/${name}`),
]) {
  const stat = await lstat(path.join(root, relative));
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size > 0 &&
      stat.size <= 8 * 1024 * 1024,
    "Invalid static file",
  );
  total += stat.size;
}
assert(total <= 32 * 1024 * 1024, "Hosted static output exceeds its bound");
for (const entry of ["index.html", "live.html"]) {
  const html = await readFile(path.join(root, entry), "utf8");
  const links = [...html.matchAll(/(?:src|href)="(\/[^"\s]+)"/g)].map(
    (match) => match[1],
  );
  assert(
    links.some((link) => link.endsWith(".js")) &&
      links.some((link) => link.endsWith(".css")),
    "Missing static entry assets",
  );
  assert(
    links.every(
      (link) => link.startsWith("/assets/") && assets.includes(link.slice(8)),
    ),
    "Entry refers to non-static output",
  );
}
console.log(
  `Hosted output verified: ${assets.length} immutable assets, ${total} bytes; no wallet state or native executable.`,
);
