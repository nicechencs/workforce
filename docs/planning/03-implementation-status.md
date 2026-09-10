# V0.1 实现进度（以代码与测试为准）

日期：2026-09-10  
权威：本文件记录**实际已验证**的实现。任务清单 `02-development-task-backlog.md` 的“均未开始”已过时。协作与评审见 [04-collab-and-review.md](04-collab-and-review.md)。

## 1. 本轮目标与结果

目标：跑通 **M3 Mock 完整流程**（规划文档 §5），并行补齐 Daemon 真实用例、Electron/React 壳与 P0 页面。

**HTTP Mock 闭环已通过（headless）。** 桌面项目页有 happy-dom 点击 driver（默认 `pnpm test`）；这不是真实 Electron 窗口。真窗口人工点击仍需要。Codex **未**做 live `exec`。

## 2. 任务状态（对照实现，不是旧清单）

| ID | 状态 | 证据 |
|---|---|---|
| T00 | 完成 | 决策登记 / 状态矩阵 / 能力矩阵已冻结 |
| T01 | 完成 | pnpm + turbo monorepo；本轮补了 Electron/React/Vite lockfile |
| T02 | 完成（M3 字段） | `packages/protocol` + contract tests |
| T03 | 完成（Windows 证据） | `docs/spikes/*`；macOS/Linux 未测 |
| T04 | 完成库并接入 composition | migration 002/003 + entity repos；重启以 SQLite 实体表为准（含预算/reservation），world.json 仅 sidecar |
| T05 | 完成库并接入 Daemon | Mock adapter + LocalNodeHost；composition 订阅终态 |
| T06 | 完成库并接入 Mock 主路径 | Developer A/B 独立 git worktree；`integratePatches` 合入固定 baseline |
| T07 | 完成库并接入 composition | Policy/redaction 单测通过；生产 composition 用 `decideStart` 做启动前拒绝，审批 create/consume 用 `createCanonicalAction` digest |
| T08 | 完成库，部分接线 | `LocalArtifactStore` 打开；Mock 产物主要在 world snapshot |
| T09 | 完成 in-memory 用例 | `m3-path.test.ts`；Daemon 已调用 `WorkforceApp` |
| T10 | **本轮完成 composition** | 生产 `main()` 用真实服务；测试默认 Fake 仍绿 |
| T11 | **本轮完成壳** | Electron + Vite + React + IPC + feature glob |
| T12 | **本轮完成页面** | 项目 / Task / 只读团队 / 只读工作流（模板·版本·结构化步骤，夹具；无画布编辑器） |
| T13 | **本轮完成页面** | 工作台 / Run / 产物 / 审批 / 节点 / 设置；运行记录已进入一级导航（仍标 P1） |
| T14 | 完成 fixture | `mockPlanFixture` 已用于 confirm-plan |
| T15 | **本轮起步** | detect/describe/validate；**拒绝** live start |
| T16 | **本轮起步** | HTTP M3 + typed client；桌面 happy-dom 页 driver（非真窗口） |
| T17 | 未开始 | 打包/签名 |

## 3. 实际验证

环境：Linux，Node 22+，pnpm 9.4。

```text
pnpm lint                 # 通过（tooling/spikes 已从 ESLint 忽略，因其为实验脚本）
pnpm --filter @workforce/daemon typecheck
pnpm --filter @workforce/desktop typecheck
pnpm --filter @workforce/desktop-client typecheck
pnpm exec vitest run      # 全量 unit + integration + happy-dom 页 driver
```

关键场景：

1. **Daemon HTTP M3**（`apps/daemon/tests/composition.test.ts`）  
   创建项目 → 绑定 workspace 授权引用 → `:start-planning`（空 body，内部填 Mock 预设）→ `:confirm-plan`（冻结 fixture：`dev_alpha` / `dev_bravo` / `review_integration`）→ `:start` → Mock 运行完成并绑定产物 → artifact 审批 consumed。  
   同 `stateDir` 重启后项目仍在；重放同一 `operationId` **不**新增 Run。  
   删除 `world.json` 后预算/reservation/usage key 仍从 SQLite 恢复；硬货币上限仍为 `422 unknown_cost_not_enforceable`。  
   Mock pause → `422 unsupported_capability`。  
   硬货币上限 → `InMemoryPolicyEngine.decideStart` → `422 unknown_cost_not_enforceable`。  
   计划审批 `actionDigest` 为 `plan.apply` 规范化 digest；digest 不一致的 confirm/approve → `409 conflict`。

2. **Typed client**（`tests/integration/m3-mock-client.test.ts`）  
   `DesktopClient` + loopback 走同一条路径，重放 `:start` 不复制 Run。  
   `tests` 现为 workspace package（`@workforce/tests`），integration / 后续 sibling 通过 `@workforce/*` 公共导出导入，不再用相对路径或 eslint 豁免。

3. **既有 Fake HTTP 契约**（`apps/daemon/tests/commands.test.ts` 等）仍通过。`startDaemon` 在未注入 `services` 时仍用 `FakeAppServices`；生产 `apps/daemon/src/index.ts` 使用 `createComposedAppServices`。

4. **桌面**  
   `apps/desktop` unit tests 覆盖 IPC 白名单、hash 路由、feature glob、SSE 解析、页面 view-model（412 保留表单、取消中、未知成本非 0、pause 隐藏）。  
   **Headless page driver：** `apps/desktop/tests/main-path.smoke.test.ts` 在 happy-dom 里点项目页，对 composed Mock daemon 走创建 → 绑定工作区（测试 preload 假 picker）→ 开始规划 → 确认计划 → 开始执行。这是 DOM driver，不是真窗口。默认 `pnpm test` 会跑。  
   **Electron helper（默认关闭）：** `pnpm --filter @workforce/desktop smoke` 才拉起 Vite + Electron，用 `executeJavaScript` 点同一组 test id。`WORKFORCE_DESKTOP_SMOKE` 未设时**不会**跳过原生目录对话框。该命令不能代替真人在真窗口里点（对话框、SSE / Run 控制台、视觉）。默认 `pnpm test` **跳过** Electron 用例。

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
重启保留预算/reservation                     ✅ SQLite budgets / budget_reservations / usage_ledger
```

壳导航按更正后的 [IA §2](../product-ui/01-information-architecture.md)：**P0/P1 是切片深度，一级导航全部 `primary`**。IA 工作流用户目的为「查看模板、版本和结构化步骤」，不用「管理」暗示画布。线框 §1 侧栏与 §7 只读页含「工作流」。实现仍是夹具只读；不发明 `GET /workflows`，不宣称真实 Runtime 可执行。

## 5. 剩余工作

1. **Headed Electron 真窗口点击验收**：happy-dom / opt-in `executeJavaScript` helper **不能**代替人工。用 `pnpm --filter @workforce/desktop dev` 点目录对话框、SSE、Run 控制台与视觉。  
2. **Codex live**：探测已有；`start` 仍拒绝。需在已安装 CLI 的机器上跑授权 `codex exec --json`。  
3. **T17** 打包。  
4. Policy grant store 仍为进程内；持久化审批记录与 digest 以 SQLite/world 为准。  
5. 工作流目录 API（`GET /workflows`）仍薄；页面夹具不等于已发布 Runtime 或可编辑定义。

## 6. 如何跑

```bash
pnpm install --frozen-lockfile
pnpm test                                          # 含 happy-dom 页 driver；不启动 Electron
pnpm --filter @workforce/desktop smoke             # opt-in Electron helper；不能代替人工真窗口
WORKFORCE_DESKTOP_SMOKE_HEADED=1 pnpm --filter @workforce/desktop smoke
pnpm --filter @workforce/desktop dev               # Vite + Electron；目录对话框仍是原生的
# Daemon 单独：
node --experimental-strip-types apps/daemon/src/index.ts --state-dir /tmp/wf-state
```

桌面 smoke 环境变量：

| 变量 | 作用 |
|---|---|
| `WORKFORCE_DESKTOP_SMOKE=1` | 才启用 Electron helper（默认关闭）。`dev`/`start` 不读此开关时行为不变 |
| `WORKFORCE_DESKTOP_SMOKE_OUT` | helper 结果 JSON（`scripts/smoke.mjs` 写入） |
| `WORKFORCE_SMOKE_WORKSPACE` | **仅当** `WORKFORCE_DESKTOP_SMOKE=1` 时跳过 `showOpenDialog` |
| `WORKFORCE_DESKTOP_SMOKE_HEADED=1` | helper 显示窗口、不加强制 headless |
| `WORKFORCE_STATE_DIR` | 隔离 daemon / Electron `userData` |
