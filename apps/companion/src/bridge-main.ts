import { createBridge, type BridgeConfig } from "./bridge.js";
import type { NetworkName } from "@pearl-ledger/sdk";
const config: BridgeConfig = {
  rpcUrl: process.env.PEARL_RPC_URL ?? "http://127.0.0.1:8334",
  rpcUser: process.env.PEARL_RPC_USER ?? "",
  rpcPassword: process.env.PEARL_RPC_PASSWORD ?? "",
  network: (process.env.PEARL_NETWORK ?? "regtest") as NetworkName,
  origin: process.env.PEARL_COMPANION_ORIGIN ?? "http://127.0.0.1:5188",
  port: Number(process.env.PEARL_BRIDGE_PORT ?? "8787"),
  allowBroadcast: process.env.PEARL_ALLOW_BROADCAST === "1",
};
try {
  const server = createBridge(config);
  server.requestTimeout = 60_000;
  server.headersTimeout = 10_000;
  server.listen(config.port, "127.0.0.1", () =>
    console.log(
      `Pearl ${config.network} bridge on loopback port ${config.port}; broadcast ${config.allowBroadcast ? "enabled" : "disabled"}. RPC credentials are server-side only.`,
    ),
  );
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Bridge configuration failed",
  );
  process.exitCode = 1;
}
