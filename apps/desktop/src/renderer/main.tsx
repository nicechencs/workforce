import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { tokensAsCssVariables } from "@workforce/ui";

import { loadRendererFeatureRegistry } from "./app/feature-loader.js";
import { ShellApp } from "./app/shell-app.js";
import { ThemeProvider, bootstrapTheme } from "./app/theme.js";
import "./styles.css";

const tokenStyle = document.createElement("style");
tokenStyle.setAttribute("data-workforce-tokens", "true");
tokenStyle.textContent = tokensAsCssVariables();
document.head.prepend(tokenStyle);

// 在 React 挂载前同步落地主题，避免首屏先浅色再切深色。
bootstrapTheme();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Workforce renderer root #root is missing");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <ShellApp registry={loadRendererFeatureRegistry()} />
    </ThemeProvider>
  </StrictMode>,
);
