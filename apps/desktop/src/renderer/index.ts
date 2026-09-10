export const processRole = "renderer" as const;

export { describeConnection, renderShell } from "./app/index.js";
export { connectionBanner, shellNav } from "./components/index.js";
export { createRouteRegistry, SHELL_ROUTES } from "./routes/index.js";
