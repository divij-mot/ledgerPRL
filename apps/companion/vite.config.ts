import { defineConfig } from "vite";
import { lightMiddleware } from "./src/blockbook.js";
const origin = "http://127.0.0.1:5173";
export default defineConfig({
  plugins: [
    {
      name: "pearl-public-watch-only",
      configureServer(server) {
        server.middlewares.use(lightMiddleware(origin));
      },
      configurePreviewServer(server) {
        server.middlewares.use(lightMiddleware(origin));
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    allowedHosts: ["127.0.0.1", "localhost"],
    proxy: {
      "^/api/(check|broadcast)$": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { target: "es2022", sourcemap: false },
});
