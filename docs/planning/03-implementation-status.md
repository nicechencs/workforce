# V0.1 实现进度（以代码与测试为准）

日期：2026-09-11  
权威：本文件记录**实际已验证**的实现。任务清单 `02-development-task-backlog.md` 的“均未开始”已过时。协作与评审见 [04-collab-and-review.md](04-collab-and-review.md)。  
修订：2026-09-12 — #25 rebase 到 T20 tip（#24 `edce1a4`）。T02 冻结 D18 `orchestrationMode`（`workflow_bound | direct`）于 `packages/protocol` `StartRunRequest`；缺省 `workflow_bound`。**不**宣称 T21 UI、M8 完成或生产 Codex direct。T20 Desktop **UI shell + 写 API 落草稿**已在 main：会话协议未冻结时禁用发送（`CHAT_SESSION_PROTOCOL_FROZEN=false`）；结构化名称才走 `POST /workflows` 写未发布草稿。作者面壳 headed **PASS**（`66a9c284`，`WORKFORCE-PR24-66a9c284-AUTHORING-SHELL-RETEST.md`；先前 `7f85c503` / `WORKFORCE-PR24-7f85c503-AUTHORING-SHELL.md` 仍可引用）。T18 headed create/edit/save/publish **PASS**（`fbe13dea`）与 T19 headed 草稿持久化 **PASS**（`406ee6d2`）保留。M7 **未完成**。D19 远程 enrollment 与容器 runner **未实现**。

## 1. 本轮目标与结果

目标：跑通 **M3 Mock 完整流程**（规划文档 §5），并行补齐 Daemon 真实用例、Electron/React 壳与 P0 页面。产品主对象是 **Project（项目制）**：M3 用预设 Team + 只读工作流目录走完一个项目闭环。M7 **写 API + 协议**已接通（#23 `15c058f`）。T18 画布 UI 已接线且草稿保存走同一套写 API；headed 真窗 create/edit/save/publish 已 **PASS**（`fbe13dea`，main `6eeea107`）。自定义 Team（T19）**桌面写面 UI + 草稿持久化已接线**（main `0e2a156`）；headed 草稿 save→reload **PASS**（`406ee6d2`）。T20 只有 Desktop **作者面壳 + 写 API 落草稿**，对话会话协议仍 **planned**（chat 禁用至 session DTO）。按 Agent 双执行模式是 **M8 已规划、未实现**：T02 已冻结 `orchestrationMode` 字段；T21 UI **未实现**。D19 Placement（本机默认；远程与容器）**产品模型已冻结、实现未完成**。不得把 T18 / T19 / T20 壳写成 M7 或对话编排完成，也不得发明 chat / `:direct` / enrollment endpoint，不得宣称生产 Codex 已支持 direct。happy-dom / proxy 仍不能代替其余真窗路径（目录对话框、SSE、Run 控制台）。

**HTTP Mock 闭环已通过（headless）。** 桌面项目页有 happy-dom 点击 driver（默认 `pnpm test`）；这不是完整真窗口。T18 画布 create/edit/save/publish、T19 草稿 save→reload 与 T20 作者面壳已有 headed **PASS**（T20 复测 `66a9c284`）；目录对话框、SSE、Run 控制台与项目详情六标签的真窗验收仍需要。不得把 T20 headed 壳写成对话生成可用。Codex **未**做 live `exec`。

## 2. 任务状态（对照实现，不是旧清单）

| ID | 状态 | 证据 |
|---|---|---|
| T00 | 完成（项目制 + M7/M8 + D19 Placement 决策已补写） | M0–M3 冻结仍有效；§0 项目制；D15/D16 画布与自定义 Team；D17 对话生成（M7 planned，仅有 UI shell）；D18 双执行模式（M8 planned；`orchestrationMode` 字段已冻结）；D19 本机默认、远程与容器为一等 Placement。M7 **写 API + 协议**已接通。T18 画布 UI **已接线**，headed 真窗 create/edit/save/publish **PASS**（`fbe13dea`）。T19 桌面写面 + 草稿持久化 **已接线**，headed save→reload **PASS**（`406ee6d2`）。**未实现**会话协议 / 编排 Agent（T20 剩余）、双执行 UI（T21）、远程 enrollment 与容器 runner。M7 未完成 |
| T01 | 完成 | pnpm + turbo monorepo；本轮补了 Electron/React/Vite lockfile |
| T02 | 完成（M3 字段）+ M7 写契约扩展 + D18 `orchestrationMode` 冻结 | `packages/protocol` 公开 `TaskDto` / `dependsOn`；M7 扩展 draft/published `WorkflowDto`（nodes/edges 与现有 steps 同一协议）与 `TeamDto` / `TeamVersionDto` 写 payload。D18 启动字段 `orchestrationMode`（`workflow_bound \| direct`）已冻结在 `StartRunRequest`；省略默认 `workflow_bound`，未知值拒绝。**仍无** chat session / 对话草稿 DTO。无新 HTTP path。字段冻结 ≠ T21 UI / M8 |
| T03 | 完成（Windows 证据） | `docs/spikes/*`；macOS/Linux 未测 |
| T04 | 完成库并接入 composition | migration 002/003/004 + entity repos；重启以 SQLite 实体表为准（含预算/reservation 与 `policy_grants`），world.json 仅 sidecar |
| T05 | 完成库并接入 Daemon | Mock adapter + LocalNodeHost；composition 订阅终态 |
| T06 | 完成库并接入 Mock 主路径 | Developer A/B 独立 git worktree；`integratePatches` 合入固定 baseline |
| T07 | 完成库并接入 composition | Policy/redaction 单测通过；生产 composition 用 `decideStart` 做启动前拒绝，审批 create/consume 用 `createCanonicalAction` digest；`GrantStore` 为 `SqliteGrantStore`（`policy_grants`），进程内 `InMemoryGrantStore` 仅测试默认 |
| T08 | 完成库并接入 Mock composition（本切片权威） | 所有权仍是 `packages/artifacts`（不是 Daemon 私有第二套规则）。composition 以 `LocalArtifactStore` 为 Mock 产物字节/元数据权威；公开 content 读精确 `artifactVersionId`。**不是**未开始，也**不是** world.json / `bodyBase64` 权威 |
| T09 | 完成 in-memory 用例 + 发布校验 | `m3-path.test.ts`；`CatalogService` 用同一 `validateWorkflowGraph` 校验有限 DAG；未发布不可执行 / 不可 bind |
| T10 | **本轮完成 composition** + M7 写路由 | 生产 `main()` 用真实服务；矩阵 Workflows/Teams 写 path 已注册（Fake + composed）；`catalog_*` SQLite 权威。测试默认 Fake 仍绿 |
| T11 | **本轮完成壳** | Electron + Vite + React + IPC + feature glob |
| T12 | **本轮完成页面** | 项目 / Task / **只读团队目录** / 只读工作流目录（`GET /workflows` 已发布模板·版本·结构化步骤；空目录诚实空态）。Tasks 展示已发布 `dependsOn` 边。画布作者面见 T18；自定义 Team 写面见 T19 本切片，不要把本行写成「AI 团队仍只有只读预设且无编辑面」。项目详情按修订后的 IA §4.3（六标签 + 页头命令 + Settings 绑定） |
| T13 | **本轮完成页面** | 工作台 / Run / 产物 / 审批 / 节点 / 设置；运行记录已进入一级导航（仍标 P1） |
| T14 | 完成 fixture | `mockPlanFixture` 已用于 confirm-plan |
| T15 | **Process 已接线，live exec 未宣称** | detect/validate + 注入 Process 的 start/stream/cancel（fake Process + fixture 可执行文件）；本机 **没有** live `codex exec` |
| T16 | **本轮起步** | HTTP M3 + typed client（`TaskDto`/`TaskDependency` 来自 `@workforce/protocol`，含公开 `dependsOn`）；桌面 happy-dom 页 driver（非真窗口） |
| T17 | 未开始 | 打包/签名 |
| T18 | 画布 UI 已接线；草稿保存走写 API；headed 真窗 **PASS** | renderer 画布可新建/编辑/连线；保存调用 typed client `createWorkflow` / `createWorkflowVersion` / `patchWorkflow` / `patchWorkflowVersion`（协议 `entry`+`nodes`+`edges`，If-Match=`stateRevision`）。发布走 `publishWorkflowVersion`；空图/非法图诚实失败。未发布草稿不进 `GET /workflows` 列表，reload 走 `GET /workflows/{id}`。headed 真窗 create/edit/save/publish **PASS**（`WORKFORCE-PR22-fbe13dea-CANVAS-RETEST.md`，验证 head `fbe13dea`；已 squash 进 main `6eeea107`）。不宣称 Mock/Codex 可执行未发布图，也不宣称 M7 / T21 完成 |
| T19 | **自定义 Team 编排 UI 已接线**；草稿写 API 已接通；headed 草稿持久化 **PASS** | #21 已 squash 进 main `0e2a156` + #23 写契约：可创建/编辑草稿（role + RuntimeProfile + quantity），`createTeam` / `patchTeam` / `createTeamVersion` / `patchTeamVersion` 真实持久化。默认 `GET /teams` 仍只含 published；reload 后草稿经 `GET /teams?status=draft` + `GET /teams/{id}` 拉回。Test-bot headed **PASS**（验证 head `406ee6d2`，`WORKFORCE-PR21-406ee6d2-DRAFT-PERSIST-RETEST.md`：save→reload 草稿仍在）。Publish / 自定义绑定仅在写 API 与规则允许时启用，**无假 publish/bind**。预设 Software Development Team 卡仍只读。不宣称完整 headed 套件，也不宣称 M7 / T21 完成 |
| T20 | UI shell + 写 API 落草稿（会话协议仍 planned） | `features/workflow-authoring/` 作者面与 happy-dom 测试。工作流目录有「对话生成」入口：发送对话禁用并说明 T02 须冻结 session DTO（`CHAT_SESSION_PROTOCOL_FROZEN=false`）。结构化名称可走 `POST /workflows` + version 写接口落**未发布**草稿，失败保留输入。无假 Agent 回复、不发布、不执行。落草稿后深链 T18 画布路由 `/workflows/:id/versions/:versionId`。Test-bot 作者面壳 headed **PASS**（`66a9c284`，`WORKFORCE-PR24-66a9c284-AUTHORING-SHELL-RETEST.md`；先前 `7f85c503` / `WORKFORCE-PR24-7f85c503-AUTHORING-SHELL.md`）。**未实现**会话协议、编排 Agent、对话生成、完整 headed 套件 |
| T21 | 已规划，未实现（UI） | 双执行模式（D18）。`orchestrationMode` **已冻结**在 protocol `StartRunRequest`。无 workflow-bound / direct 选择面，无 mode 按钮，无调度/HTTP 接线。不得把字段冻结写成 M8 完成或生产 Codex direct |

## 3. 实际验证

环境：Linux，Node 22+，pnpm 9.4。

```text
pnpm lint                 # 通过（tooling/spikes 已从 ESLint 忽略，因其为实验脚本）
pnpm --filter @workforce/daemon typecheck
pnpm --filter @workforce/desktop typecheck
pnpm --filter @workforce/desktop-client typecheck
pnpm exec vitest run      # 全量 unit + integration + happy-dom 页 driver
```

Grant 持久化切片补充（Linux，2026-09-11；未重跑全量 `pnpm test` / `pnpm build`）：

```text
pnpm --filter @workforce/database typecheck
pnpm --filter @workforce/policy typecheck
pnpm --filter @workforce/daemon typecheck
pnpm exec vitest run packages/database packages/policy \
  apps/daemon/tests/grant-store.test.ts apps/daemon/tests/policy.test.ts
pnpm exec vitest run apps/daemon/tests/composition.test.ts
pnpm check:docs
```

公开 Task `dependsOn` + Artifact 权威切片（Linux，2026-09-11；代码已在同分支先前 CI 绿；本文件只同步进度，本轮只跑文档检查）：

```text
pnpm check:docs
```

M7 写 API + 协议切片（Linux，2026-09-11；`20931f0`）：

```text
pnpm format:check     # 退出 0
pnpm lint             # 退出 0（修了 routes.ts unused binding）
pnpm typecheck        # 退出 0（M3 client 按 optional steps 读取）
pnpm check:docs       # 退出 0
pnpm build            # 退出 0
pnpm test             # 本机 Node v22.14.0 全量 isolate 曾超时/环境失败；过滤重跑
                      # workflow-team-writes / composition / m3-mock-client /
                      # approval-command-governance / workflows-catalog-proxy 通过
GitHub Actions pull-request on 20931f0  # success（ubuntu-latest / Node 22）
```

T18 画布保存接线（Linux，2026-09-12；#23 已在 main；#22 squash `6eeea107`）：

```text
pnpm format:check     # 退出 0
pnpm lint             # 退出 0
pnpm typecheck        # 退出 0
pnpm check:docs       # 退出 0
pnpm exec vitest run apps/desktop/src/renderer/features/workflows \
  apps/desktop/tests/workflows-write-proxy.test.ts \
  apps/desktop/tests/workflows-catalog-proxy.test.ts
                      # 4 files / 26 tests 通过（含 create+save+reload 与空图发布诚实失败）
```

headed 真窗 create/edit/save/publish **PASS**（`WORKFORCE-PR22-fbe13dea-CANVAS-RETEST.md`，验证 head `fbe13dea`）。此前 `WORKFORCE-PR22-62b1e620-CANVAS-TRUEWINDOW` 因写 path 未挂载 FAIL；接线后已复测通过。

T19 headed 草稿持久化（2026-09-12；验证 head `406ee6d2`；本文件只同步进度）：

```text
Test-bot WORKFORCE-PR21-406ee6d2-DRAFT-PERSIST-RETEST.md  # PASS：save→reload 草稿仍在
pnpm check:docs                                           # 本轮文档同步
```

T18 与 T19 的 headed PASS 都不是完整 headed 套件，也不是 M7 完成。

T20 作者面壳 + 写 API 落草稿（Linux，2026-09-12；叠 `0e2a156`）：

```text
pnpm exec vitest run apps/desktop/src/renderer/features/workflow-authoring \
  apps/desktop/src/renderer/features/workflows/workflows.test.ts \
  apps/desktop/tests/workflow-authoring-write.test.ts
pnpm --filter @workforce/desktop typecheck
pnpm check:docs
# Test-bot 作者面壳 headed PASS：WORKFORCE-PR24-66a9c284-AUTHORING-SHELL-RETEST.md（验证 head 66a9c284）
# 先前：WORKFORCE-PR24-7f85c503-AUTHORING-SHELL.md（验证 head 7f85c503）
# 不宣称真窗口对话编排可用；会话发送仍禁用
```

关键场景：

1. **Daemon HTTP M3**（`apps/daemon/tests/composition.test.ts`）  
   创建项目 → 绑定 workspace 授权引用 → `:start-planning`（空 body，内部填 Mock 预设）→ `:confirm-plan`（冻结 fixture：`dev_alpha` / `dev_bravo` / `review_integration`）→ `:start` → Mock 运行完成并绑定产物 → artifact 审批 consumed。  
   `GET /tasks` 返回公开 `dependsOn`：`dev_alpha` / `dev_bravo` 为 `[]`，`review_integration` 依赖二者且 `waitFor` 为 `outputs_ready`（`composition.test.ts`、`tests/integration/m3-mock-client.test.ts`）。公开 DTO 只接受 `outputs_ready` 或 `completed`；映射把非 `completed` 的上游写成 `outputs_ready`（本轮未改此行为）。  
   同 `stateDir` 重启后项目仍在；重放同一 `operationId` **不**新增 Run。  
   删除 `world.json` 后预算/reservation/usage key 仍从 SQLite 恢复；硬货币上限仍为 `422 unknown_cost_not_enforceable`。  
   删除 `world.json` 后未消费 Policy grant 仍可 `decide` 一次；已消费 grant 重启后仍为 `grant_consumed`，不能再消费。`credential.copy_env` 即使有 grant 行仍 deny。  
   删除 `world.json` 后公开 Task `dependsOn` 仍在；`GET /artifacts/{id}/versions/{versionId}/content` 仍从 `LocalArtifactStore` 读出与删除前相同的 git_diff 字节。dump 中的 `artifactContents` **不**带 `bodyBase64`。  
   Mock pause → `422 unsupported_capability`。  
   硬货币上限 → `InMemoryPolicyEngine.decideStart` → `422 unknown_cost_not_enforceable`。  
   计划审批 `actionDigest` 为 `plan.apply` 规范化 digest；digest 不一致的 confirm/approve → `409 conflict`。

2. **Typed client**（`tests/integration/m3-mock-client.test.ts`）  
   `DesktopClient` + loopback 走同一条路径，重放 `:start` 不复制 Run。  
   `listTasks` / `getTask` 的公开 `TaskDto.dependsOn` 与 HTTP 一致（review → alpha/bravo，`outputs_ready`），不是内部 DAG 私有字段。  
   `tests` 现为 workspace package（`@workforce/tests`），integration / 后续 sibling 通过 `@workforce/*` 公共导出导入，不再用相对路径或 eslint 豁免。

3. **既有 Fake HTTP 契约**（`apps/daemon/tests/commands.test.ts` 等）仍通过。`startDaemon` 在未注入 `services` 时仍用 `FakeAppServices`；生产 `apps/daemon/src/index.ts` 使用 `createComposedAppServices`。

4. **桌面**  
   `apps/desktop` unit tests 覆盖 IPC 白名单、hash 路由、feature glob、SSE 解析、页面 view-model（412 保留表单、取消中、未知成本非 0、pause 隐藏）。  
   **项目详情标签：** 对照修订后的 IA §4.3.1–§4.3.4：页头保留项目命令与只读摘要；六标签为 概览 / Tasks / Runs / Artifacts / Activity / Settings。WorkspaceBinding 写入只在 Settings（`project-bind-workspace`）；概览只有进度计数（DAG 边在 Tasks 标签，不在概览）。Tasks / Runs / Artifacts / Activity 复用 `listTasks` / `listRuns` / `listArtifacts` / `listEvents`。composed API 的公开 Task DTO **始终**带 `dependsOn`；Tasks 展示真实依赖边（无依赖写「依赖：无」）。「依赖：未返回」只是旧客户端/夹具缺字段时的 UI 回退，不表示现行协议仍是内部-only。深链 `#/projects/:id?tab=` 由项目页读取（壳路由仍只解析 path）。  
   **Headless page driver：** `apps/desktop/tests/main-path.smoke.test.ts` 在 happy-dom 里点项目页，对 composed Mock daemon 走创建 → Settings 绑定工作区（测试 preload 假 picker）→ 页头开始规划 → 确认计划 → 开始执行 → Tasks 核对 `dev_alpha` / `dev_bravo` 及依赖文案（`outputs_ready` 或「依赖：无」）。这是 DOM driver，不是真窗口。默认 `pnpm test` 会跑。  
   **Electron helper（默认关闭）：** `pnpm --filter @workforce/desktop smoke` 才拉起 Vite + Electron，用 `executeJavaScript` 点同一组 test id。`WORKFORCE_DESKTOP_SMOKE` 未设时**不会**跳过原生目录对话框。该命令不能代替真人在真窗口里点（对话框、SSE / Run 控制台、视觉）。默认 `pnpm test` **跳过** Electron 用例。  
   **T18 headed 画布：** Test-bot 在 `fbe13dea` **PASS**（`WORKFORCE-PR22-fbe13dea-CANVAS-RETEST.md`：create/edit/save/publish）。已在 main `6eeea107`。  
   **T19 headed 草稿持久化：** Test-bot 在 `406ee6d2` **PASS**（`WORKFORCE-PR21-406ee6d2-DRAFT-PERSIST-RETEST.md`：save→reload 草稿仍在）。只覆盖这条路径，不代替其余真窗验收。

5. **工作流只读目录**（`apps/daemon/tests/workflows-catalog.test.ts` + typed client + Desktop IPC allowlist + `apps/desktop/tests/workflows-catalog-proxy.test.ts`）  
   生产 `createComposedAppServices` 与 Fake 都实现 `listWorkflows` / `getWorkflow` / `getWorkflowVersion`，并返回已发布 `software-development-team.feature-delivery`（不是空种子）。Daemon 路由已注册。headed 真窗口曾读失败，是因为 Desktop `API_ROUTE_TEMPLATES` 放行了 teams/nodes/runtimes，却漏了这三条只读路径，IPC 代理在到达 loopback 前抛 allowlist 错误；页面因此进「无法读取 GET /workflows」，不是空目录。现已放行三条 GET，以及矩阵上的 Workflow/Team 写 path（`POST/PATCH`、version、`:publish`）和 `GET /teams/{id}/versions/{versionId}`。`proxyConnectedApiRequest`（Electron 主进程同一条代理）对 composed daemon 的 `GET /api/v1/workflows` 必须列出该已发布模板；桌面页走 `listWorkflows` 渲染 `workflow-row-*`，空目录用 `workflow-empty`，读失败用 `workflow-error`，不回退夹具。该只读目录切片当时不是画布编辑器，也不表示 Mock/Codex Runtime 可执行这些定义。T18 画布 headed 真窗见上（`fbe13dea` create/edit/save/publish **PASS**）。

6. **Codex**  
   `runtimes/codex`：PATH/配置探测、能力描述（pause / event.resume = unsupported）。  
   `start/stream/cancel` 走注入的 captured Process：CLI + validate + `resolveStart` 齐备时 `spawnCaptured`；缺 CLI 为 `validation_failed`；缺 Process/`resolveStart`/不完整 context/win32 capture 为 `unsupported_capability`。  
   证据（2026-09-11，Linux，Node v22.14.0，pnpm 9.4.0）：  
   `pnpm --filter @workforce/runtime-codex typecheck` 退出 0；  
   `pnpm --filter @workforce/daemon typecheck` 退出 0；  
   `pnpm exec vitest run runtimes/codex apps/daemon/tests/codex-composition.test.ts` → 6 files / 34 tests 通过（含 fake Process 与 `OsProcessController` + `fixtures/jsonl-double.mjs`，**不是** Codex CLI）。  
   本机 Linux **没有**授权 live `codex exec`；未宣称真实 Runtime 可执行。Daemon Host 仍默认 Mock。

## 4. M3 主路径对照

```text
创建 Project(draft)                         ✅ HTTP + 项目页
绑定 Workspace + 预设 Team + Mock + 预算     ✅ 默认填充；UI 在 Settings 选目录授权（IA §4.3.4）
Project(planning) + Plan Artifact           ✅ fixture，无真实 Planner Run
Approval(gate=plan)                         ✅ start-planning 创建，confirm 消费
发布执行图，Project(ready/running)           ✅
Developer A/B 隔离 Run + worktree           ✅ 独立 worktree + git_diff 产物
Review 消费精确版本                          ✅ integratePatches 后 artifact 审批
Approval(gate=artifact)                     ✅
导出 bundle/report                          ✅ POST /projects/{id}:export
重启不重复 Run                              ✅ SQLite 实体表权威（可删 world.json）
重启保留预算/reservation                     ✅ SQLite budgets / budget_reservations / usage_ledger
重启保留 Policy grant                        ✅ SQLite `policy_grants`（与 `approvals` 分表；不写 world.json）
公开 Task dependsOn（已发布 DAG）            ✅ GET /tasks；review → alpha/bravo，`outputs_ready`
Mock 产物权威                                ✅ LocalArtifactStore；可删 world.json，content 仍可读
```

壳导航按更正后的 [IA §2](../product-ui/01-information-architecture.md)：**P0/P1 是切片深度，一级导航全部 `primary`**。IA 工作流用户目的现为「查看、编辑和发布可复用工作流（含对话生成与画布）」；**当前代码**是只读已发布目录 + T18 画布作者面 + T19 自定义 Team 写面 + T20 作者面壳（会话协议未冻结）。Desktop IPC 已放行 GET 与矩阵写 path。未发布草稿不会出现在目录列表。T18 画布 headed 真窗 create/edit/save/publish 已 **PASS**（`fbe13dea`）。自定义 Team **桌面写面 UI + 草稿写 API 已接线**；headed 草稿 save→reload **PASS**（`406ee6d2`）；默认 `GET /teams` 只回 published。publish/自定义绑定按规则诚实显隐，无假成功。对话编排、按 Agent 直接执行仍未实现。M7 **未完成**。不得宣称 Mock/Codex Runtime 可执行未发布图，也不得宣称 M7 / T21 完成或对话编排已接通。

## 5. 剩余工作

1. **Headed Electron 真窗口点击验收**：happy-dom / opt-in `executeJavaScript` helper **不能**代替人工。用 `pnpm --filter @workforce/desktop dev` 点目录对话框、SSE、Run 控制台、项目详情六标签与视觉。T18 画布与 T19 草稿持久化已有各自 headed PASS，不代替本条其余路径。  
2. **Codex live**：Adapter 已能经 Process 启动/流式/取消；本机仍无 Codex CLI。需在已安装 CLI 的机器上跑授权 `codex exec --json`。Auth `login status`、中途 input、event-cursor resume、win32 captured spawn、Daemon 重启后 re-attach 仍未测或 unsupported。  
3. **T17** 打包。  
4. **M7 可视化画布（T18）UI 已接线，headed 真窗 PASS**：草稿保存走已合入 main 的 #23 写 API。Test-bot 真窗 create/edit/save/publish **PASS**（`WORKFORCE-PR22-fbe13dea-CANVAS-RETEST.md`，head `fbe13dea`；main `6eeea107`）。不宣称 M7 完成，也不宣称 Mock/Codex Runtime 可执行未发布图。  
5. **M7 自定义 Team 编排（T19）UI + 草稿写 API 已接线**：可创建/编辑草稿并经 `createTeam` / `createTeamVersion` / `patch*` 持久化。默认 `GET /teams` 只回 published；列表 reload 走 `GET /teams?status=draft`，详情走 `GET /teams/{id}`。Publish / 自定义绑定仅在写 API 与规则允许时启用，**无假 publish/bind**。未发布 TeamVersion 不能 `:start-planning`。headed 真窗草稿持久化 **PASS**（验证 head `406ee6d2`，`WORKFORCE-PR21-406ee6d2-DRAFT-PERSIST-RETEST.md`；#21 squash 进 main `0e2a156`）。这不是完整 headed 套件，也**不是** M7 完成。不得再写「自定义 Team 写面未实现」「写 API 未落地」或「AI 团队仍只读预设」来概括本切片。  
6. **M7 对话生成工作流（T20）未完成**：Desktop 作者面壳与写 API 落草稿已接通（#24 `edce1a4`）；headed 作者面壳 **PASS**（`66a9c284`，`WORKFORCE-PR24-66a9c284-AUTHORING-SHELL-RETEST.md`）。**会话协议 / 编排 Agent / 对话生成仍 planned**。不得把结构化落草稿或只读目录写成「对话编排已完成」，也不得渲染假 Agent 成功回复。T02 仍须冻结 session / 草稿 DTO 后才能宣称对话路径接通。
7. **M8 双执行模式（T21）未实现**：`orchestrationMode` 已冻结在 protocol；T21 UI / 调度 / 启动接线仍未做。Agent 不能选择 direct；现有 Mock 闭环只是跟随已发布执行图（缺省 `workflow_bound`）。不得预置假 mode，也不得宣称生产 Codex 已验证 direct。
8. 可写项目策略与远程节点 enrollment 仍无公开 API；容器 runner 未实现。UI 只读说明，未伪造已接入远程节点或已可调度容器。产品模型见 D19，**不是**实现完成。  
9. Policy grant 已落 `policy_grants`；未测断电/WAL 强制 fsync。审批记录与 digest 仍在 `approvals`，不要把两张表当成同一对象。  
10. T08 任务卡其余 M5 项（Evaluation / quarantine / 保留）仍未宣称完成。

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
