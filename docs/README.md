# Workforce Documentation

## Directory plan

```text
docs/
├── blueprint/   # Product, architecture and MVP baseline
├── adr/         # Architecture Decision Records
├── protocols/   # Versioned JSON Schemas and protocol specifications
└── operations/  # Development, release, diagnostics and support guides
```

Git does not retain empty directories. The `adr`, `protocols`, and `operations` directories will be added with their first real documents.

## V0.1 Blueprint

1. [Product Vision & PRD](blueprint/01-product-vision-prd.md)
2. [Domain Model](blueprint/02-domain-model.md)
3. [System Architecture](blueprint/03-system-architecture.md)
4. [Repository Structure](blueprint/04-repository-structure.md)
5. [Task Protocol](blueprint/05-task-protocol.md)
6. [Artifact Protocol](blueprint/06-artifact-protocol.md)
7. [Runtime Protocol](blueprint/07-runtime-protocol.md)
8. [Workflow State Machine](blueprint/08-workflow-state-machine.md)
9. [Event Model](blueprint/09-event-model.md)
10. [Database Schema](blueprint/10-database-schema.md)
11. [API Design](blueprint/11-api-design.md)
12. [MVP Implementation Plan](blueprint/12-mvp-implementation-plan.md)

## Document status

All blueprint documents are V0.1 drafts. Protocols and implementation details may change through Architecture Decision Records and reviewed pull requests.

