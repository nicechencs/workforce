# Contributing

## Agent entry

Development Agents start from [AGENTS.md](AGENTS.md), then read only the guides triggered by the current task. Agent roles, handoff, review, reasoning levels, and validation live in:

- [Agent workflow](docs/guides/agent-workflow.md)
- [Agent capabilities and tools](docs/reference/agent-runtime.md)
- [Testing and validation](docs/guides/testing-and-validation.md)
- Named-bot PR pipeline and decision red lines: [04-collab-and-review.md](docs/planning/04-collab-and-review.md)

Before editing, record the current branch, HEAD, working-tree changes, task acceptance criteria, owned files, and prohibited files. Parallel Agents must use separate writable worktrees and non-overlapping write scopes.

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
pnpm check:docs
```

CI runs `pnpm format:check` instead of rewriting files.

## Packages

Each workspace package is private (`@workforce/<name>`), exports only its public `exports` map, and starts as an empty implementation. Import other packages by name, never by relative path across package boundaries.

`packages/ui` and `apps/desktop/src/renderer` must stay browser-safe: Node built-ins such as `node:fs` are forbidden by ESLint. See the README for package ownership and the T02 schema-entry notes.

## Review and delivery

- The implementer runs module tests and records the exact commands and results.
- Cross-package changes require the affected contract/integration tests and an independent review of the final diff or ArtifactVersion.
- Session review returns `APPROVED` or `CHANGES REQUIRED` with locations and evidence. The named-bot PR verdict (`pass` / `conditional` / `reject`) lives only in [04-collab-and-review.md](docs/planning/04-collab-and-review.md).
- Mock, synthetic Artifact, or Runtime discovery results must not be reported as live Runtime proof.
- Do not push, create a pull request, publish, or force-apply an integration conflict unless the current task explicitly authorizes it.

New or substantially rewritten documentation follows [docs/STYLE.md](docs/STYLE.md) and must pass `pnpm check:docs`.
