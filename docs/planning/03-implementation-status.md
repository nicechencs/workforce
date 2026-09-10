# V0.1 实现进度（以代码与测试为准）

日期：2026-09-10  
权威：本文件记录**实际已验证**的实现。任务清单 `02-development-task-backlog.md` 的“均未开始”已过时。

## 1. 本轮目标与结果

目标：跑通 **M3 Mock 完整流程**（规划文档 §5），并行补齐 Daemon 真实用例、Electron/React 壳与 P0 页面。

**HTTP Mock 闭环已通过（headless）。** 未在 headed Electron 窗口中做人工点击验收。Codex **未**做 live `exec`。

## 2. 任务状态（对照实现，不是旧清单）

| ID | 状态 | 证据 |
|---|---|---|
| T00 | 完成 | 决策登记 / 状态矩阵 / 能力矩阵已冻结 |
| T01 | 完成 | pnpm + turbo monorepo；本轮补了 Electron/React/Vite lockfile |
| T02 | 完成（M3 字段） | `packages/protocol` + contract tests |
| T03 | 完成（Windows 证据） | `docs/spikes/*`；macOS/Linux 未测 |
| T04 | 完成库并接入 composition | migration 002 + entity repos；重启以 SQLite 实体表为准，world.json 仅 sidecar |
| T05 | 完成库并接入 Daemon | Mock adapter + LocalNodeHost；composition 订阅终态 |
| T06 | 完成库并接入 Mock 主路径 | Developer A/B 独立 git worktree；`integratePatches` 合入固定 baseline |
| T07 | 完成库并接入 composition | Policy/redaction 单测通过；生产 composition 用 `decideStart` 做启动前拒绝，审批 create/consume 用 `createCanonicalAction` digest |
| T08 | 完成库，部分接线 | `LocalArtifactStore` 打开；Mock 产物主要在 world snapshot |
| T09 | 完成 in-memory 用例 | `m3-path.test.ts`；Daemon 已调用 `WorkforceApp` |
| T10 | **本轮完成 composition** | 生产 `main()` 用真实服务；测试默认 Fake 仍绿 |
| T11 | **本轮完成壳** | Electron + Vite + React + IPC + feature glob |
| T12 | **本轮完成页面** | 项目 / Task / 只读团队 |
| T13 | **本轮完成页面** | 工作台 / Run / 产物 / 审批 / 节点 / 设置 |
| T14 | 完成 fixture | `mockPlanFixture` 已用于 confirm-plan |
| T15 | **本轮起步** | detect/describe/validate；**拒绝** live start |
| T16 | **本轮起步** | `apps/daemon/tests/composition.test.ts` + `tests/integration/m3-mock-client.test.ts` |
| T17 | 未开始 | 打包/签名 |

## 3. 实际验证

环境：Linux，Node 22+，pnpm 9.4。

```text
pnpm lint                 # 通过（tooling/spikes 已从 ESLint 忽略，因其为实验脚本）
pnpm --filter @workforce/daemon typecheck
pnpm --filter @workforce/desktop typecheck
pnpm --filter @workforce/desktop-client typecheck
pnpm exec vitest run      # 全量 unit + integration
```

关键场景：

1. **Daemon HTTP M3**（`apps/daemon/tests/composition.test.ts`）  
   创建项目 → 绑定 workspace 授权引用 → `:start-planning`（空 body，内部填 Mock 预设）→ `:confirm-plan`（冻结 fixture：`dev_alpha` / `dev_bravo` / `review_integration`）→ `:start` → Mock 运行完成并绑定产物 → artifact 审批 consumed。  
   同 `stateDir` 重启后项目仍在；重放同一 `operationId` **不**新增 Run。  
   Mock pause → `422 unsupported_capability`。  
   硬货币上限 → `InMemoryPolicyEngine.decideStart` → `422 unknown_cost_not_enforceable`。  
   计划审批 `actionDigest` 为 `plan.apply` 规范化 digest；digest 不一致的 confirm/approve → `409 conflict`。

2. **Typed client**（`tests/integration/m3-mock-client.test.ts`）  
   `DesktopClient` + loopback 走同一条路径，重放 `:start` 不复制 Run。

3. **既有 Fake HTTP 契约**（`apps/daemon/tests/commands.test.ts` 等）仍通过。`startDaemon` 在未注入 `services` 时仍用 `FakeAppServices`；生产 `apps/daemon/src/index.ts` 使用 `createComposedAppServices`。

4. **桌面**  
   `apps/desktop` unit tests 覆盖 IPC 白名单、hash 路由、feature glob、SSE 解析、页面 view-model（412 保留表单、取消中、未知成本非 0、pause 隐藏）。  
   **未验证：** `pnpm --filter @workforce/desktop dev` 的 headed 窗口、真实点击主路径。

5. **Codex**  
   `runtimes/codex`：PATH/配置探测、能力描述（pause / event.resume = unsupported）、validate、start 抛 `unsupported_capability`。  
   本机 Linux **没有** Codex CLI；未跑 live `codex exec`。

## 4. M3 主路径对照

```text
创建 Project(draft)                         ✅ HTTP + 项目页
绑定 Workspace + 预设 Team + Mock + 预算     ✅ 默认填充；UI 可选目录授权
Project(planning) + Plan Artifact           ✅ fixture，无真实 Planner Run
Approval(gate=plan)                         ✅ start-planning 创建，confirm 消费
发布执行图，Project(ready/running)           ✅
Developer A/B 隔离 Run + worktree           ✅ 独立 worktree + git_diff 产物
Review 消费精确版本                          ✅ integratePatches 后 artifact 审批
Approval(gate=artifact)                     ✅
导出 bundle/report                          ✅ POST /projects/{id}:export
重启不重复 Run                              ✅ SQLite 实体表权威（可删 world.json）
```

## 5. 剩余工作

1. **Headed Electron 点击验收**：`pnpm --filter @workforce/desktop dev` 人工走主路径（本轮 SSE 已接到 Run 控制台，仍无 headed e2e）。  
2. **Codex live**：探测已有；`start` 仍拒绝。需在已安装 CLI 的机器上跑授权 `codex exec --json`。  
3. **预算/reservation 落库**：仍在 sidecar JSON；实体已在 SQLite。  
4. **T17** 打包。  
5. 根 `tests/integration` 仍用相对导入解析 workspace 包。  
6. Policy grant store 仍为进程内；持久化审批记录与 digest 以 SQLite/world 为准。

## 6. 如何跑

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm --filter @workforce/desktop dev   # Vite + Electron；需先能拉起 Daemon
# Daemon 单独：
node --experimental-strip-types apps/daemon/src/index.ts --state-dir /tmp/wf-state
```
