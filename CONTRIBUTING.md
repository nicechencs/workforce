# Contributing

## Toolchain

- Package manager: pnpm 9.4.x (`packageManager` in the root `package.json`).
- Node.js: `>=22`. `.nvmrc` pins the LTS major (`22`). Node 22 and 24 are both supported for local development.
- Install with `pnpm install --frozen-lockfile` after cloning.

Do not use npm or yarn. New third-party dependencies and lockfile edits are owned by T01 / the coordinator after the skeleton lands.

## Commands

Run these from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs `pnpm format:check` instead of rewriting files.

## Packages

Each workspace package is private (`@workforce/<name>`), exports only its public `exports` map, and starts as an empty implementation. Import other packages by name, never by relative path across package boundaries.

`packages/ui` and `apps/desktop/src/renderer` must stay browser-safe: Node built-ins such as `node:fs` are forbidden by ESLint. See the README for package ownership and the T02 schema-entry notes.
