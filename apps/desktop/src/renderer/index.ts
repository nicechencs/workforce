export const processRole = "renderer" as const;

export {
  createIpcTransport,
  createShellRegistry,
  describeConnection,
  loadFeatureModules,
  parseHashPath,
  pathToHash,
  renderShell,
  shouldRenderFeaturePage,
  slotForHash,
  useWorkforceClient,
  useWorkforceConnection,
  useWorkforceNavigate,
} from "./app/index.js";
export { connectionBanner, shellNav } from "./components/index.js";
export { createRouteRegistry, SHELL_ROUTES } from "./routes/index.js";
