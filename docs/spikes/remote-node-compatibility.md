---
title: Remote Node Mock compatibility spike
type: reference
status: current
owner: T03 and T05
updated: 2026-09-12
---

# Remote Node Mock compatibility spike

This is a protocol-level compatibility check for the existing `LocalNodeHost` and
`MockRuntimeAdapter`. It proves neither a remote process nor a production remote
runner. It does not change Domain, Task, Event, API, or Runtime transport schemas.

## Reproduction

From the repository root:

```text
pnpm exec vitest run runtimes/mock/src/host-scenarios.test.ts
```

The case `accepts only its configured remote Mock node and isolates an old binding
after replacement` uses the in-process synthetic node
`ndl_01JTESTREMOTEMOCKNODE00000`. It exercises the same public
`StartRunRequest`, `PlacementSnapshot`, `RuntimeHandle`, and `RuntimeEvent` shapes
as a local node.

## Verified compatibility surface

| Concern | Evidence | Boundary |
|---|---|---|
| Placement | A Host accepts a start only when `executionNodeId` equals its configured synthetic node; its binding retains node, runtime-installation, and workspace IDs. | Node selection is in-process configuration, not a network route. |
| Recovery and fencing | A replacement Host obtains the next fencing token and returns the existing handle as unattached at its last trusted status. The prior binding can no longer submit input; its late events become audit-only and cannot update the stored Runtime status, timestamp, or stream terminal state. | `MemoryRuntimeHostStore` models a single stored session, not competing node leases. There is no rebind operation, so replacement is not Runtime reattach. |
| Event lifecycle | A direct Mock-adapter call simulates a late result from the stale binding; the Host persists it for audit without advancing the waiting execution. | Adapter cursor resume remains unsupported; this is not network reconnection or at-least-once delivery evidence. |
| Mutation safety | A request targeted to another node is rejected. Existing lease-expiry coverage continues to reject new starts and input while allowing safe inspect/cancel. | No enrollment, heartbeat, distributed lease arbiter, or remote authorization exists. |

## Platform evidence

| Platform | Result |
|---|---|
| Windows | Automated Mock test run on the current development environment. |
| macOS | Not run. |
| Linux | Not run. |

The test is portable TypeScript logic, but portability is not proof of a real
remote transport. `T16-THREE-PLATFORM-SMOKE` remains responsible for real-platform
evidence.

## Explicit non-results

- No remote process, TLS channel, enrollment, heartbeat, or server-side lease
  coordination was implemented.
- No Daemon/Application API can select or list a live remote node, and no Host can resume a stale binding without an explicit future rebind contract.
- The runtime transport union remains `process | sdk | http`; placement does not
  create a new `remote` transport.
- This result does not make Remote Node execution a V0.1 release capability.

## Follow-up

Keep production remote runner work out of this spike. A future control-plane task
must introduce a schema-first remote protocol and multi-node durable lease store,
then add true transport/reconnect tests before changing the product capability
matrix.
