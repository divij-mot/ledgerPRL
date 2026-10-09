import { defineConfig } from "vite";
import { lightMiddleware } from "./src/blockbook.js";
import { indexerProxy } from "./src/indexer-proxy.js";
const origin = "http://127.0.0.1:5173";
const headers = {
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
};
export default defineConfig({
  plugins: [
    {
      name: "pearl-public-watch-only",
      configureServer(server) {
        server.middlewares.use(indexerProxy(origin));
        server.middlewares.use(lightMiddleware(origin));
      },
      configurePreviewServer(server) {
        server.middlewares.use(indexerProxy(origin));
        server.middlewares.use(lightMiddleware(origin));
      },
    },
  ],
  server: {
    headers,
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    allowedHosts: ["127.0.0.1", "localhost"],
    proxy: {
      "^/api/(check|reconcile|broadcast)$": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true, headers },
  build: { target: "es2022", sourcemap: false },
});
