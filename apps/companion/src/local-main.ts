import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createWalletServer } from "./web-server.js";
import { createLocalLightService } from "./local-service.js";

const origin = "http://127.0.0.1:5188";
const light = createLocalLightService(origin);
const server = await createWalletServer({
  origin,
  distDirectory: fileURLToPath(new URL("../dist/", import.meta.url)),
  localLight: light.middleware,
});
server.listen(5188, "127.0.0.1", () => {
  console.log(`Pearl browser wallet: ${origin}/`);
  console.log(`Ledger Discover entry: ${origin}/live.html`);
  if (process.env.PEARL_OPEN_BROWSER === "1") {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    execFile(opener, [`${origin}/`], { timeout: 5_000 }, (error) => {
      if (error)
        console.error(
          `Open ${origin}/ in a WebHID-capable browser to connect your Ledger.`,
        );
    });
  }
});
server.on("error", () => {
  console.error(
    "Pearl wallet could not start; port 5188 may already be in use.",
  );
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    server.closeAllConnections();
    server.close(() => {
      void light.stop().finally(() => process.exit());
    });
  });
