import { readFile, lstat, realpath, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { assert } from "@pearl-ledger/sdk";
import { createLightRuntime, LIGHT_SOURCE_COMMIT } from "./light-runtime.js";
import { localLightMiddleware } from "./local-light.js";

async function helperSources(
  root: string,
  relative = "apps/light-client",
): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(join(root, relative), {
    withFileTypes: true,
  })) {
    if (item.name === "bin" || item.name === "target") continue;
    const path = `${relative}/${item.name}`;
    assert(!item.isSymbolicLink(), "Local light source cannot be a symlink");
    if (item.isDirectory()) files.push(...(await helperSources(root, path)));
    else if (
      item.isFile() &&
      (item.name.endsWith(".go") ||
        item.name === "go.mod" ||
        item.name === "go.sum")
    )
      files.push(path);
  }
  return files.sort();
}

/** Configuration comes only from the locally built artifact, never the browser. */
export function createLocalLightService(origin: string) {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  let runtime: ReturnType<typeof createLightRuntime> | undefined;
  let loading: Promise<ReturnType<typeof createLightRuntime>> | undefined;
  const load = async () => {
    if (runtime) return runtime;
    if (!loading)
      loading = (async () => {
        const manifestPath = join(root, ".tools/light-client/manifest.json");
        const stat = await lstat(manifestPath).catch(() => {
          throw new Error(
            "Local sync needs setup. Run npm run setup:light once.",
          );
        });
        assert(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.size <= 4096 &&
            (stat.mode & 0o077) === 0 &&
            stat.uid === process.getuid?.() &&
            (await realpath(manifestPath)) === manifestPath,
          "Invalid local sync manifest",
        );
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        assert(
          manifest.schema === 1 &&
            manifest.sourceCommit === LIGHT_SOURCE_COMMIT &&
            manifest.executable ===
              join(root, ".tools/light-client/pearl-watch") &&
            /^[0-9a-f]{64}$/.test(manifest.executableSha256) &&
            JSON.stringify(manifest.buildTags) ===
              JSON.stringify(["xmss", "zkpow"]),
          "Local sync build identity mismatch",
        );
        assert(
          manifest.helperSources &&
            typeof manifest.helperSources === "object" &&
            Object.keys(manifest.helperSources).length >= 3,
          "Local sync needs rebuilding. Run npm run setup:light.",
        );
        assert(
          JSON.stringify(Object.keys(manifest.helperSources).sort()) ===
            JSON.stringify(await helperSources(root)),
          "Local sync source set changed. Run npm run setup:light to rebuild.",
        );
        for (const [relative, expected] of Object.entries(
          manifest.helperSources,
        )) {
          assert(
            /^apps\/light-client\/(?:[a-zA-Z0-9_/-]+\.go|go\.(?:mod|sum))$/.test(
              relative,
            ) &&
              typeof expected === "string" &&
              /^[0-9a-f]{64}$/.test(expected),
            "Invalid local build source manifest",
          );
          const path = join(root, relative);
          assert(
            (await realpath(path)) === path &&
              createHash("sha256")
                .update(await readFile(path))
                .digest("hex") === expected,
            "Local sync source changed. Run npm run setup:light to rebuild.",
          );
        }
        runtime = createLightRuntime({
          dataRoot: join(root, ".local-light"),
          executable: manifest.executable,
          executableSha256: manifest.executableSha256,
        });
        return runtime;
      })().finally(() => {
        loading = undefined;
      });
    return loading;
  };
  return {
    middleware: localLightMiddleware(origin, load),
    stop: async () => {
      await runtime?.stop();
    },
  };
}
