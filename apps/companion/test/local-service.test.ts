/** Real private manifest/source validation; the native runtime and HTTP boundary
 * are replaced so no helper, profile, socket, network or device is opened. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { LIGHT_SOURCE_COMMIT } from "../src/light-runtime.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
test("local service rejects pre-isolation build recipes before creating any native runtime", async () => {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "pearl-recipe-test-"),
  );
  try {
    const directory = join(root, ".tools/light-client");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await mkdir(join(root, "apps/light-client"), {
      recursive: true,
      mode: 0o700,
    });
    const helperSources: Record<string, string> = {};
    for (const name of ["main.go", "go.mod", "go.sum"]) {
      const relative = `apps/light-client/${name}`;
      await writeFile(join(root, relative), name, { mode: 0o600 });
      helperSources[relative] = hash(name);
    }
    const resolveDir = fileURLToPath(new URL("../src/", import.meta.url));
    const output = await build({
      stdin: {
        contents:
          (await readFile(join(resolveDir, "local-service.ts"), "utf8")) +
          '\nexport { created } from "./light-runtime.js";\n',
        resolveDir,
        loader: "ts",
      },
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      logLevel: "silent",
      define: {
        "import.meta.url": JSON.stringify(
          pathToFileURL(join(root, "apps/companion/src/local-service.ts")).href,
        ),
      },
      plugins: [
        {
          name: "no-native-or-http",
          setup(b) {
            b.onResolve(
              { filter: /^\.\/(light-runtime|local-light)\.js$/ },
              (a) => ({ path: a.path, namespace: "fixture" }),
            );
            b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
              contents: a.path.includes("light-runtime")
                ? `export const LIGHT_SOURCE_COMMIT=${JSON.stringify(LIGHT_SOURCE_COMMIT)}; export let created=0; export function createLightRuntime(config){created++;return config;}`
                : "export function localLightMiddleware(origin,load){return load;}",
              loader: "js",
            }));
          },
        },
      ],
    });
    const module = await import(
      "data:text/javascript;base64," +
        Buffer.from(output.outputFiles[0]!.text).toString("base64")
    );
    const manifest = {
      schema: 1,
      sourceCommit: LIGHT_SOURCE_COMMIT,
      executable: join(directory, "pearl-watch"),
      executableSha256: "ab".repeat(32),
      buildTags: ["xmss", "zkpow"],
      helperSources,
    };
    for (const recipe of [undefined, 1, 2]) {
      await writeFile(
        join(directory, "manifest.json"),
        JSON.stringify({ ...manifest, buildRecipe: recipe }),
        { mode: 0o600 },
      );
      const service = module.createLocalLightService("http://127.0.0.1:5188");
      if (recipe === 2)
        assert.equal(
          (await service.middleware()).executable,
          manifest.executable,
        );
      else
        await assert.rejects(service.middleware(), /build identity mismatch/);
      assert.equal(module.created, recipe === 2 ? 1 : 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
