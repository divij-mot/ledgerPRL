/** Bundle workspace TypeScript exports before @vercel/node traces API entrypoints. */
import { build } from "vite";
import { fileURLToPath } from "node:url";

await build({
  configFile: false,
  envFile: false,
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: fileURLToPath(
      new URL("../apps/companion/src/hosted-indexer.ts", import.meta.url),
    ),
    outDir: fileURLToPath(
      new URL("../apps/companion/server/dist/", import.meta.url),
    ),
    emptyOutDir: true,
    target: "node24",
    minify: true,
    sourcemap: false,
    rollupOptions: { output: { entryFileNames: "indexer.mjs" } },
  },
});
