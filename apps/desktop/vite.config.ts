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
    // 5173 是首选端口，但不是硬性要求：该端口常被其他本地 dev server 占用
    // （含同机上的其它仓库）。dev.mjs 会读取 Vite 实际发布的地址并交给 Electron，
    // 因此回退到相邻端口是安全的；这里保持 strictPort: false 以免启动直接失败。
    port: 5173,
    strictPort: false,
    watch: {
      // 浏览器 profile / UI 校验脚手架会往应用根目录写临时目录，其中的锁文件
      // （例如 Chrome 的 VariationsSafeSeed*.tmp）会让文件监听抛 EBUSY，
      // 而该错误从 FSWatcher 的 error 事件直接抛到顶层，会整锅端掉 dev server。
      // 这里不与它们共享监听，免得一个同事的 UI 校验把本地启动弄挂。
      ignored: ["**/.ui-check/**", "**/*-profile/**"],
    },
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
