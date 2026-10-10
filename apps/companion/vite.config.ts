import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { lightMiddleware } from "./src/blockbook.js";
import { indexerProxy } from "./src/indexer-proxy.js";
import { createLocalLightService } from "./src/local-service.js";
const origin = "http://127.0.0.1:5188";
const headers = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};
export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      name: "pearl-public-watch-only",
      configureServer(server) {
        const local = createLocalLightService(origin);
        server.middlewares.use(local.middleware);
        server.httpServer?.once("close", () => {
          void local.stop();
        });
        server.middlewares.use(indexerProxy(origin));
        server.middlewares.use(lightMiddleware(origin));
      },
      configurePreviewServer(server) {
        const local = createLocalLightService(origin);
        server.middlewares.use(local.middleware);
        server.httpServer?.once("close", () => {
          void local.stop();
        });
        server.middlewares.use(indexerProxy(origin));
        server.middlewares.use(lightMiddleware(origin));
      },
    },
  ],
  server: {
    headers,
    host: "127.0.0.1",
    port: 5188,
    strictPort: true,
    allowedHosts: ["127.0.0.1", "localhost"],
    proxy: {
      "^/api/(check|reconcile|broadcast)$": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  preview: { host: "127.0.0.1", port: 5188, strictPort: true, headers },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        live: fileURLToPath(new URL("./live.html", import.meta.url)),
      },
    },
  },
});
