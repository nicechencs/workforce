export const packageName = "@workforce/desktop" as const;

export { processRole as mainProcessRole } from "./main/index.js";
export { processRole as preloadProcessRole } from "./preload/index.js";
export { requiredCoordinatorDependencies } from "./main/required-dependencies.js";
export { startDesktopApp } from "./main/start.js";
