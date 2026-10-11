import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "dist"), { recursive: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ["src/index.tsx"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2022",
  outfile: "dist/snap.js",
  sourcemap: false,
  minify: false,
  metafile: true,
  legalComments: "eof",
  jsx: "automatic",
  jsxImportSource: "@metamask/snaps-sdk",
});
const source = await readFile(resolve(root, "dist/snap.js"));
const manifest = {
  version: "0.1.0",
  description:
    "Development-only public PRL account review and external Ledger signature verification. No private keys.",
  proposedName: "Pearl Ledger Companion",
  manifestVersion: "0.1",
  platformVersion: "12.0.1",
  source: {
    shasum: createHash("sha256").update(source).digest("base64"),
    location: {
      npm: {
        filePath: "dist/snap.js",
        packageName: "@pearl-ledger/metamask-snap",
        registry: "https://registry.npmjs.org/",
      },
    },
  },
  initialPermissions: {
    "endowment:rpc": {
      allowedOrigins: [
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
      ],
      maxRequestTime: 180000,
    },
    snap_dialog: {},
    snap_manageState: {},
  },
};
// Current MetaMask checksum covers stable manifest (without shasum) plus source, not source alone.
// Algorithm: MetaMask/snaps packages/snaps-utils/src/{snaps,checksum}.ts; official CLI validates it.
const hash = (bytes) => createHash("sha256").update(bytes).digest();
const stable = (value) =>
  JSON.stringify(value, (_key, current) =>
    current && typeof current === "object" && !Array.isArray(current)
      ? Object.fromEntries(
          Object.keys(current)
            .sort()
            .map((key) => [key, current[key]]),
        )
      : current,
  );
const checksummable = structuredClone(manifest);
delete checksummable.source.shasum;
const files = [
  ["snap.manifest.json", Buffer.from(stable(checksummable))],
  ["dist/snap.js", source],
];
manifest.source.shasum = hash(
  Buffer.concat(
    files.sort(([a], [b]) => (a < b ? -1 : 1)).map(([, bytes]) => hash(bytes)),
  ),
).toString("base64");
await writeFile(
  resolve(root, "snap.manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await writeFile(
  resolve(root, "dist/build-inputs.json"),
  JSON.stringify(result.metafile, null, 2) + "\n",
);
console.log(
  `Built local-only PRL Snap: ${source.length} bytes; Snap checksum ${manifest.source.shasum}`,
);

await build({
  absWorkingDir: root,
  entryPoints: ["demo/demo.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  outfile: "dist/demo.js",
  sourcemap: false,
  minify: false,
});
await copyFile(
  resolve(root, "demo/index.html"),
  resolve(root, "dist/index.html"),
);
await copyFile(resolve(root, "demo/demo.css"), resolve(root, "dist/demo.css"));
