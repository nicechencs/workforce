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
| T04 | 完成库，部分接线 | SQLite schema + event/receipt repos。Project/Task 列与 `ProjectRecord` 未对齐；M3 用 `world.json` + SQLite events/receipts |
| T05 | 完成库并接入 Daemon | Mock adapter + LocalNodeHost；composition 订阅终态 |
| T06 | 完成库，未接 M3 主路径 | Git worktree 原语存在；Mock 闭环用合成 patch，不强制真实 worktree |
| T07 | 完成库，未接 composition | Policy/redaction 单测通过 |
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

1. **Daemon HTTP M3**（`apps/daemon/tests/composition.test.ts`，3 tests）  
   创建项目 → 绑定 workspace 授权引用 → `:start-planning`（空 body，内部填 Mock 预设）→ `:confirm-plan`（冻结 fixture：`dev_alpha` / `dev_bravo` / `review_integration`）→ `:start` → Mock 运行完成并绑定产物 → artifact 审批 consumed。  
   同 `stateDir` 重启后项目仍在；重放同一 `operationId` **不**新增 Run。  
   Mock pause → `422 unsupported_capability`。  
   硬货币上限 → `422 unknown_cost_not_enforceable`。

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
Developer A/B 隔离 Run + worktree           ⚠️ Mock 成功并绑定合成 patch；未强制独立 git worktree
Review 消费精确版本                          ⚠️ reviewer 任务存在；整合 worktree/测试证据未走 T14 integratePatches
Approval(gate=artifact)                     ✅
导出 bundle/report                          ❌ 未做
重启不重复 Run                              ✅
```

## 5. 剩余工作（建议下一轮）

1. **Headed E2E**：启动 Electron，走创建→规划确认→审批。需要显示服务器。  
2. **SQLite 实体表**：为 Project/Task/Workflow 补齐与 `ProjectRecord` 对齐的 migration（T04），替换 `world.json`。  
3. **真实 worktree + 整合**：T06/T14 接到 composition：每 Run 独立 worktree，`integratePatches`，冲突人工处理。  
4. **SSE 进页面**：Run 控制台目前主要 `listRunEvents`；Main 已有 SSE bridge。  
5. **Codex live**：在已探测机器上跑授权的 `codex exec --json` fixture，映射 JSONL、进程树取消、未知成本。禁止把 session `resume` 当成 cursor。  
6. **T17** 打包。  
7. 根测试目录不是 workspace 包，`@workforce/*` 从 `tests/integration` 无法解析，当前用相对导入 + eslint 豁免。

## 6. 如何跑

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm --filter @workforce/desktop dev   # Vite + Electron；需先能拉起 Daemon
# Daemon 单独：
node --experimental-strip-types apps/daemon/src/index.ts --state-dir /tmp/wf-state
```
