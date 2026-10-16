import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const consoleApiPort = process.env.OSVA_CONSOLE_PORT?.trim() || "4174";
const vitePort = Number.parseInt(
  process.env.OSVA_CONSOLE_VITE_PORT?.trim() || "5173",
  10,
);

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: Number.isFinite(vitePort) ? vitePort : 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${consoleApiPort}`,
        changeOrigin: true,
      },
    },
  },
});
