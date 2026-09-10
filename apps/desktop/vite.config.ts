import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.join(root, "dist/renderer"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: path.join(root, "index.html"),
    },
  },
});
