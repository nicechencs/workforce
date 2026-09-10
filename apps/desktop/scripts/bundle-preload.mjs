import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function bundlePreload() {
  await build({
    configFile: false,
    root,
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir: path.join(root, "dist/preload"),
      emptyOutDir: false,
      sourcemap: true,
      minify: false,
      rollupOptions: {
        input: path.join(root, "src/preload/electron-entry.ts"),
        external: ["electron"],
        output: {
          format: "cjs",
          entryFileNames: "electron-entry.cjs",
          inlineDynamicImports: true,
          exports: "auto",
        },
      },
    },
  });
}

const invokedDirectly =
  Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  await bundlePreload();
}
