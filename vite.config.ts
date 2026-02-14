import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
        onstart({ startup }) {
          startup();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              output: { format: "cjs" },
            },
          },
        },
      },
      {
        entry: "electron/preload.ts",
        onstart() {},
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              output: { format: "cjs" },
            },
          },
        },
      },
      {
        entry: "electron/mcp-server.ts",
        onstart() {},
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              output: { format: "cjs" },
            },
          },
        },
      },
      {
        entry: "electron/summarizer/processing-mcp.ts",
        onstart() {},
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              output: { format: "cjs" },
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  server: {
    port: 1420,
  },
});
