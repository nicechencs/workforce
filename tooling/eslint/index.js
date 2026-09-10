import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const NODE_IMPORT_MESSAGE =
  "Browser packages cannot import Node built-in modules. Keep packages/ui and the desktop renderer on the browser side of the boundary.";

const nodeBuiltinNames = [
  "assert",
  "async_hooks",
  "buffer",
  "child_process",
  "cluster",
  "console",
  "constants",
  "crypto",
  "dgram",
  "diagnostics_channel",
  "dns",
  "domain",
  "events",
  "fs",
  "fs/promises",
  "http",
  "http2",
  "https",
  "inspector",
  "module",
  "net",
  "os",
  "path",
  "perf_hooks",
  "process",
  "punycode",
  "querystring",
  "readline",
  "repl",
  "stream",
  "string_decoder",
  "sys",
  "timers",
  "tls",
  "trace_events",
  "tty",
  "url",
  "util",
  "v8",
  "vm",
  "wasi",
  "worker_threads",
  "zlib",
];

const nodeBuiltinRestriction = {
  paths: nodeBuiltinNames.flatMap((name) => [
    { name, message: NODE_IMPORT_MESSAGE },
    { name: `node:${name}`, message: NODE_IMPORT_MESSAGE },
  ]),
  patterns: [
    {
      group: ["node:*"],
      message: NODE_IMPORT_MESSAGE,
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "coverage/**",
      "docs/**",
      "tooling/spikes/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.es2022,
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/packages/*/src/*",
                "../packages/*",
                "../../packages/*",
                "@workforce/*/src",
                "@workforce/*/src/*",
              ],
              message:
                "Import workspace packages through @workforce/* public exports, not relative paths.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    ignores: ["packages/ui/**", "apps/desktop/src/renderer/**"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["packages/ui/**/*.{js,ts,tsx}", "apps/desktop/src/renderer/**/*.{js,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "no-restricted-imports": ["error", nodeBuiltinRestriction],
    },
  },
);
