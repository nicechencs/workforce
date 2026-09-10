/**
 * Exact third-party packages T11 needs once the coordinator updates the lockfile.
 * This task does not run `pnpm add` and does not edit pnpm-lock.yaml.
 */
export const requiredCoordinatorDependencies = {
  package: "@workforce/desktop",
  reason:
    "Electron main/preload/renderer bundling. Modules in this change typecheck without these packages.",
  dependencies: {
    react: "19.1.1",
    "react-dom": "19.1.1",
  },
  devDependencies: {
    electron: "44.3.0",
    vite: "7.1.5",
    "@vitejs/plugin-react": "4.5.2",
    "@types/react": "19.1.12",
    "@types/react-dom": "19.1.9",
  },
  optionalNative: {
    koffi: "2.14.1",
    reason:
      "Optional CreateMutexW binding. The shipped mutex layer is exclusive named-pipe / unix-socket bind plus loopback exclusive listen.",
  },
} as const;
