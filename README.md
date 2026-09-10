# Workforce

Workforce is a local-first AI workforce orchestration platform for coordinating specialized AI workers, runtimes, workflows, tasks, approvals, evaluations, and traceable artifacts.

The project is currently in the V0.1 architecture and implementation-planning stage.

## Documentation

- [V0.1 Blueprint](docs/README.md)
- Architecture decision records: `docs/adr/`
- Protocol specifications and schemas: `docs/protocols/`
- Operational guides: `docs/operations/`

## Initial product direction

- Cross-platform desktop application for Windows, macOS, and Linux
- Electron + React desktop client
- Independent local Node.js/TypeScript daemon
- Runtime adapters for Codex and future agent runtimes
- Durable task/workflow execution with human approval
- Local SQLite storage with an optional future cloud control plane

## Status

Design draft. The next step is initializing the monorepo and implementing the first deterministic vertical slice with a mock runtime.
