import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const consoleApiPort = process.env.OSVA_CONSOLE_PORT?.trim() || "4174";

export default defineConfig({
  plugins: [react()],
  root: "src/client",
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${consoleApiPort}`,
        changeOrigin: true,
      },
    },
  },
});
