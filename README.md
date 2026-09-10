# Workforce

Workforce is a local-first AI workforce orchestration platform for coordinating specialized AI workers, runtimes, workflows, tasks, approvals, evaluations, and traceable artifacts.

The V0.1 architecture is frozen. This repository is a TypeScript pnpm + Turborepo monorepo; package implementations are owned by the task cards in `docs/planning/02-development-task-backlog.md`.

## Toolchain

| Tool            | Pin                                                                               |
| --------------- | --------------------------------------------------------------------------------- |
| Node.js         | `>=22` (`.nvmrc` is `22` LTS; Node 22 and 24 are both fine for local development) |
| Package manager | pnpm `9.4.0` (`packageManager` field; do not use npm or yarn)                     |
| Orchestration   | Turborepo                                                                         |
| Language        | TypeScript, strict                                                                |
| Test            | Vitest                                                                            |
| Lint / format   | ESLint + Prettier                                                                 |

## Development commands

Run from the repository root after a clean checkout:

```bash
pnpm install --frozen-lockfile
pnpm format          # rewrite with Prettier
pnpm format:check    # CI check; does not write
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test` is a toolchain smoke plus the browser/Node boundary check. It does not mean any product behavior is implemented.

## Workspace layout

```text
apps/desktop                 Electron shell (empty)
apps/daemon                  Local daemon composition root (empty)
packages/*                   Shared libraries (empty public API)
runtimes/mock                Mock runtime adapter (empty)
runtimes/codex               Codex adapter (empty)
templates/software-development-team
tooling/eslint               Shared ESLint config + boundary test
tooling/typescript           Shared tsconfig presets
tests/contract|integration|e2e|platform
```

Every workspace package is `private: true`, named `@workforce/<id>`, and publishes only the paths listed in its `exports` map. Import `@workforce/domain`, never `../../packages/domain/src/...`.

## Package ownership

Matches `docs/planning/decision-register.md` §4. After this skeleton, package source belongs to the listed task; lockfile and new third-party dependencies stay with T01 / the coordinator.

| Package / directory                                                                                                    | Write owner                       | Notes                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| `docs/planning/decision-register.md` and other decision files, blueprint consistency                                   | T00 / coordinator                 | Frozen baseline                                         |
| Root `package.json` / lockfile / turbo / tsconfig / lint / CI                                                          | T01, then lockfile to coordinator | This skeleton                                           |
| `packages/protocol`, `domain`, `runtime-spi`, `application/src/ports`, `events/src/contracts`, `testkit/src/contracts` | T02                               | After T00+T01                                           |
| `tooling/spikes`, `docs/spikes`                                                                                        | T03                               | Not created here                                        |
| `packages/database`, `packages/events/src/store\|outbox\|subscriptions`                                                | T04                               | After T02                                               |
| `runtimes/mock`, `packages/runtime-sdk`                                                                                | T05                               | After T02                                               |
| `packages/workspace`, `packages/process`                                                                               | T06                               | After T02; `process` is a confirmed independent package |
| `packages/policy`, `packages/observability`                                                                            | T07                               | After T02                                               |
| `packages/artifacts`                                                                                                   | T08                               | After T02                                               |
| `packages/workflow-engine`, `application/src/use-cases/{projects,tasks,runs,approvals,budgets,recovery}`               | T09                               | After T02                                               |
| `apps/daemon`, `packages/desktop-client`                                                                               | T10                               | After T02                                               |
| `apps/desktop/src/{main,preload,renderer/app,renderer/routes,renderer/components}`, `packages/ui`                      | T11                               | After T02                                               |
| `renderer/features/{projects,tasks,teams}`                                                                             | T12                               | After UI contracts                                      |
| `renderer/features/{runs,artifacts,approvals,nodes,settings,dashboard}`                                                | T13                               | After UI contracts                                      |
| `templates/software-development-team`, `application/src/use-cases/{planning,delivery}`                                 | T14                               | After T02                                               |
| `runtimes/codex`                                                                                                       | T15                               | After T02+T03                                           |
| `tests/{contract,integration,e2e,platform}`                                                                            | T16 / coordinator                 | Scenarios from T02 onward                               |
| `tooling/release`, packaging config                                                                                    | T17                               | Later                                                   |

Public type gaps: send a contract-change request. Do not copy types or edit a neighboring module.

## Browser / Node boundary

`packages/ui` and `apps/desktop/src/renderer` must not import Node built-ins (`node:fs`, `fs`, `path`, and other `node:*` modules).

- TypeScript: those trees use the browser tsconfig (`types: []`, DOM lib only).
- ESLint: `no-restricted-imports` in `@workforce/eslint-config`.
- Proof: `tooling/eslint/node-boundary.test.ts` lints a `node:fs` import as if it lived in `packages/ui` and the renderer, and expects the rule to fail.

## Package `exports` (T02 entry)

Each package currently exports a single public path:

```json
{
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  }
}
```

T02 should treat `packages/protocol` as the executable schema source.

To add schema files:

1. Put modules under `packages/protocol/src/` (recommended: `src/schemas/`).
2. Re-export from `packages/protocol/src/index.ts`, **or** add a dedicated public path in `packages/protocol/package.json`:

   ```json
   {
     "exports": {
       ".": "./src/index.ts",
       "./schemas": "./src/schemas/index.ts"
     }
   }
   ```

3. Consumers import `@workforce/protocol` or `@workforce/protocol/schemas` only. Do not deep-import `src/internal`.
4. JSON Schema / DTO / OpenAPI generation stays inside `packages/protocol`. Other packages depend on the generated public exports.
5. New third-party dependencies need a lockfile change from T01 / the coordinator.

The same `exports` rule applies to `domain`, `runtime-spi`, `application` ports, `events` contracts, and `testkit` contracts.

## Documentation

- [V0.1 Blueprint](docs/README.md)
- Architecture decision records: `docs/adr/`
- Protocol specifications and schemas: `docs/protocols/` (T02)
- Operational guides: `docs/operations/` (later)

## Status

Monorepo skeleton (T01). Product logic, SQLite schema, Electron windows, and Fastify routes are intentionally absent.
