---
title: 开源对标学习笔记
type: reference
status: current
owner: maintainers
updated: 2026-09-11
---

# 开源对标学习笔记

本页把开源项目当成**学习笔记**，不是选型广告，也不表示我们已接入或打算采用这些栈。读的时候只提取想法、边界和失败插入点，对照已冻结决策。路径按上游仓库常见名字书写；树若移动，用文件名/符号搜索，不要把本页当成对方仓库的目录契约。

深读只保留两条：**Eigent**（桌面 workforce 产品切分）和 **OpenHands**（编码运行时控制面）。其余项目见文末扫读清单。

## 我们保留的差异化

下列五条是读任何对标时的固定对照。对标可以启发实现细节，**不能**改写这些决策。

| 我们保留 | 含义（压缩） | 权威 |
| --- | --- | --- |
| `packages/protocol` 可执行 schema | 跨进程字段只来自协议包生成的 schema / DTO / OpenAPI；禁止各包手写分叉 | [D01](../planning/decision-register.md#d01-r01-契约权威来源)、[ADR 0003](../adr/0003-v01-contract-freeze.md) |
| Plan gate → 冻结 DAG | Planner 产出不可变 Plan Artifact；用户确认 `plan` gate 后才发布执行 WorkflowVersion。活动执行图不得被 Planner 改写，也不得在运行期无界重规划 | [D02](../planning/decision-register.md#d02-r02-planner-与不可变-dag)、[IA §4.3.4](../product-ui/01-information-architecture.md#434-与-createplanstart-的关系) |
| 未知成本 ≠ 0 | 展示区分 unknown / estimated / settled；硬货币上限无法强制时拒绝启动，不得把未知写成 `0` | [D14](../planning/decision-register.md#d14-r14-预算) |
| git worktree 隔离 | 每 Run 独立 worktree，不共享可写目录；整合走独立 integration worktree | [D10](../planning/decision-register.md#d10-r10-代码汇总) |
| Approval digest | 审批绑定 action type、规范化参数 digest、资源/版本、principal、policy version；`plan` 与 `artifact` gate 不得混用 | [D11](../planning/decision-register.md#d11-r11-审批与接管)、[D04](../planning/decision-register.md#d04-r04-可恢复执行的存储原则)（pending approval digest 存储） |

本地持久化权威是 SQLite（`world.json` 只是 sidecar），见 [D04](../planning/decision-register.md#d04-r04-可恢复执行的存储原则)、[D06](../planning/decision-register.md#d06-r06-事件序号与-sse-cursor)。这与「桌面 + 本地 daemon + SQLite」骨架对标有关，但不把对方实现当成我们的存储设计。

## A. Eigent（eigent-ai/eigent）

入口：[eigent-ai/eigent](https://github.com/eigent-ai/eigent)。目标是看清 **Electron 壳 / 本地后端 / worker 工厂 / 权限 / workspace-git** 的产品切分，用来对照 `apps/desktop` ↔ `apps/daemon`。**不**借用 Python / CAMEL 栈。

### A · 学什么 / 不学什么 / 对应决策

| | 内容 |
| --- | --- |
| 学什么 | 进程边界：壳、preload、本地后端各管什么。工具权限面（谁能调 terminal / git / human）。workforce 模式与单 agent 模式如何切换。worker factory → 具体 hands / toolkit 的装配，对照我们的 Runtime SPI，而不是抄 API。`workspace_git` 的生命周期、snapshot、发布策略，对照 worktree 隔离而不是照搬目录布局。 |
| 不学什么 | Python 后端、CAMEL Workforce API、MCP / 社交 toolkit 海洋、云同步、对方 benchmark 套件、`src/` 里的 UI 细节。运行期重新拆解任务（`step_solve` / coordinator 再分解）**不是**我们的执行模型。 |
| 对应决策 | 冻结图：[D02](../planning/decision-register.md#d02-r02-planner-与不可变-dag)。worktree：[D10](../planning/decision-register.md#d10-r10-代码汇总)。权限启动前拒绝：[D12](../planning/decision-register.md#d12-r12-policy-执行点)。桌面只走 typed bridge：[决策登记 §1 本地通信](../planning/decision-register.md#1-冻结总表)。页头「确认计划 / 开始执行」：[IA §4.3](../product-ui/01-information-architecture.md#43-项目详情)。 |

对方在运行期继续拆解；我们在 Plan 确认后冻结 DAG。读 A2 时把这个对比写在笔记第一行。

### A · 30 min 压缩版指针

完整大纲约 45–60 min（A0–A5）。没有整块时间时只走下面四段：**A0 + A2 分钟 9–11 + A3 分钟 14–16 + A4 分钟 18–20**。

| 段 | 在上游搜这些路径 / 符号 | 读什么 |
| --- | --- | --- |
| A0 地图 | `README.md`、`README_CN.md`、`AGENTS.md`；`CONTRIBUTING.md` 前三分之一；扫目录 `electron/`、`backend/`、`src/`、`server/` | 产品切分和仓库地图。停在「壳 / 后端 / worker」边界，不进 UI。 |
| A2 ★ 生命周期（9–11） | `chat_service` 的 `step_solve` / `build_context_for_workforce` / `session_mode`；`utils/workforce.py`；`single_agent_worker.py`；`run_runtime` 下 `coordinator` 与 `step_coordinator`；`run_controller` | 会话如何进入 workforce、步骤如何推进。记下**他们运行期再分解**；我们确认 Plan 后不再改执行图。 |
| A3 worker（14–16） | `agent/README`；factory：`toolkit_assembler` / `developer` / `single_agent`；hands：`interface` / `capabilities` / `full_hands` / `sandbox_hands` | 工厂如何装配 worker。`toolkit/*` 只确认存在 human / workspace_git / terminal，不要沉进去。 |
| A4 红线（18–20） | `permission_policy` 的 engine + models；`artifacts.py`；`workspace_git` 的 `workforce` / `lifecycle` / `publish_policy` / `snapshot`；`run_journal` 的 `models` + `semantic_events` + `recorder`（跳过巨大的 `store.py`） | 权限、产物、git 工作区、运行日志的语义边界。 |

45–60 min 再补 **A1**（`electron/main`、`electron/preload`、`backend/main.py`、`app/router.py`、`backend/README.md`，对照我们的 desktop ↔ daemon）和 **A5**（把下面五条对照写回自己的笔记）。跳过 MCP / 社交 toolkit、云同步、benchmark 集、`src/` UI 细节。

### A · 读后对照

1. 壳 / 后端 / preload 边界是否能一句话画出来，并对照 `apps/desktop` Main 代理、Renderer 只走 typed bridge。
2. workforce 模式与 single-agent 如何切换；我们没有「运行期换编排内核」，只有确认前后的 Plan vs 冻结图。
3. factory → hands 对照 Runtime SPI（[07 §4](../blueprint/07-runtime-protocol.md#4-adapter-spi)），不要把对方 toolkit 当成 SPI。
4. `workspace_git` 对照 [D10](../planning/decision-register.md#d10-r10-代码汇总) 的每 Run worktree，不要假设目录布局可搬。
5. 他们缺、我们已冻结：确认后的不可变 DAG、未知成本 ≠ 0、Approval digest。

## B. OpenHands

多仓，不要只读 Canvas。[OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) 是产品壳与文档入口；控制面与工作区在 **software-agent-sdk**，前端约束在 **typescript-client**。目标：控制面 ↔ Agent Server ↔ Workspace ↔ events + typed client，对照 `runtimes/codex`、Run 可观测性和 Codex **live** 风险。

### B · 学什么 / 不学什么 / 对应决策

| | 内容 |
| --- | --- |
| 学什么 | 四仓箭头：谁拥有 Agent Server、SDK、Workspace、typed client。Workspace 隔离与事件如何离开 Agent Server。前端只经 typed client、CI 禁止裸 `fetch` 的边界测法。Run 控制台在看什么事件，对照 [IA §4.5](../product-ui/01-information-architecture.md#45-run-控制台) / [§6.1](../product-ui/01-information-architecture.md#61-运行记录)。 |
| 不学什么 | 单 SWE-agent 产品形态、Helm / 云 / 企业认证 / 分析、Playwright 内核、把 Canvas 当 IA 蓝本。不要把对方 Agent Server 事件模型写成我们已经实现的 Runtime 事件。 |
| 对应决策 | Runtime 边界：[D01](../planning/decision-register.md#d01-r01-契约权威来源) + [07 §4](../blueprint/07-runtime-protocol.md#4-adapter-spi)。worktree / `packages/workspace`：[D10](../planning/decision-register.md#d10-r10-代码汇总)。前端不得私造 endpoint：[D08](../planning/decision-register.md#d08-r08-首版-api-与页面)。SSE cursor：[D06](../planning/decision-register.md#d06-r06-事件序号与-sse-cursor)。Codex live 仍拒绝 start：进度 [§5](../planning/03-implementation-status.md#5-剩余工作)。 |

### B · 30 min 压缩版指针

完整大纲约 45–60 min。压缩版只走 **B0 分钟 1–2 + B1 分钟 4–6 + B2 分钟 9–10**。

| 段 | 在上游搜这些路径 / 符号 | 读什么 |
| --- | --- | --- |
| B0 地图（1–2） | `OpenHands/OpenHands` 的 `README` 与 `AGENTS.md` **Repository boundaries** 表；扫 `electron/`、`src/`、`specs/`、`docs/` | 先分清哪些仓是产品壳、哪些是 Agent Server / SDK。不要从 Canvas 开始。 |
| B1 ★ SDK（4–6） | `software-agent-sdk` 的 `README` / `AGENTS` / `DEVELOPMENT`；packages **只看角色**：`openhands-agent-server`、`sdk`、`workspace`、`tools`；examples 看 1–2 个 | 控制面、工作区、工具的所有权。可选：对方 client 的 OpenAPI 生成，对照我们的 `packages/protocol`，不要复制生成链。 |
| B2 壳与 typed client（9–10） | OpenHands `electron/`；`typescript-client` README（前端只走 typed client；CI 禁裸 `fetch`）；Canvas `AGENTS` 的 API Access Rules | 壳如何被门禁挡住直接打 API。对照 `packages/desktop-client` 与 Renderer typed bridge。 |

有余量再读 **B3**：`OpenHands/automation` README（何时跑 vs 跑什么）。跳过 Helm / 云 / 企业认证 / 分析、Playwright 实现、把 Canvas 当一级 IA。

### B · Codex live 三条风险

对照 `runtimes/codex`。当前进度是探测 / describe / validate 已有，`start/stream/cancel` 可经注入的 captured Process 走通（fake / fixture，**不是** live CLI）；Linux CI 机器没有 Codex CLI，也没有 live `exec` 证据。Mock HTTP 与 happy-dom 页 driver **不是** headed 真窗口，更不是 live Runtime。见 [测试证据边界](../guides/testing-and-validation.md#证据边界) 与进度 [§5](../planning/03-implementation-status.md#5-剩余工作)。

1. **Sandbox：** 对方 Workspace / sandbox hands 是隔离故事。本仓库 T03 记录的本机 Codex 默认 unrestricted；[D12](../planning/decision-register.md#d12-r12-policy-执行点) 要求无法实施的硬限制必须启动前拒绝。live 前要写清「我们能强制什么 / 必须拒什么」，不要假设已有同等沙箱。
2. **Events：** Agent Server 事件流如何映射到 Runtime SPI 的 `stream` / cursor / `reconcile`（[07 §4](../blueprint/07-runtime-protocol.md#4-adapter-spi)、[D06](../planning/decision-register.md#d06-r06-事件序号与-sse-cursor)）。映射错了会把会话恢复当成 event cursor，或把对方 completed 写成 Task 验收。
3. **Control-plane：** 对方是单 SWE-agent 控制面。我们是多 Runtime SPI，外加 `plan` / `artifact` / `budget` gate。live 只解决 Adapter `start/stream/cancel/reconcile`；不得借 live 叙事放松审批 digest 或未知成本规则，也不得用 Mock / headed helper 冒充已验证。

### B · 读后对照

1. 能画出四仓箭头：OpenHands 壳 → Agent Server → Workspace → events，typed client 是前端唯一入口。
2. Workspace 隔离对照 `packages/workspace` 与 [D10](../planning/decision-register.md#d10-r10-代码汇总) worktree，而不是对方目录名。
3. Agent Server 事件是 Codex live 的主要风险面，不是已经完成的适配。
4. typed-client 门禁（禁裸 `fetch`）可借鉴为边界测试，权威仍是 `packages/protocol` + desktop-client。
5. 他们是单编码 agent 栈；我们保留多 Runtime SPI、Plan 冻结图、审批 digest 与预算门。

## 其他可扫读

深读时间不够时只扫形态，不写采用结论。

| 优先级 | 项目 | 扫什么 |
| --- | --- | --- |
| 原 P0、现只扫 | CAMEL Workforce | coordinator → 专科 worker、pipeline fork/join、HITL 插入点。对照 [D02](../planning/decision-register.md#d02-r02-planner-与不可变-dag)：我们是 Planner → Plan 确认 → 冻结图，不是运行期再编排。不学 Python API。 |
| 二选一扫内核 | LangGraph 或 Mastra | 耐久 checkpoint、interrupt / HITL、定义态 vs 运行态。Mastra 与我们同为 TS（`.then` / `.parallel` / `.branch`、suspend/resume）。若加深 T09，先单独写「Mastra 控制流 vs 冻结 DAG」对比，再碰代码。不要整仓拉入 LangChain。 |
| P1 本地壳 | Orkas、AGNT | Orkas：Commander + 专科并行进度 UI。AGNT：Electron + 本地 Express + SQLite，骨架接近 desktop ↔ daemon ↔ SQLite；看 evals / traces 缺口即可。 |
| P1 审批 UX | Aider、Cline | Aider：commit 作为审计单元 → Artifact 谱系想法（[D10](../planning/decision-register.md#d10-r10-代码汇总) / Artifact 精确版本）。Cline：逐步人批节奏，对照我们的 plan gate vs artifact gate（[D02](../planning/decision-register.md#d02-r02-planner-与不可变-dag)、[D11](../planning/decision-register.md#d11-r11-审批与接管)、[IA §4.8](../product-ui/01-information-architecture.md#48-审批中心)）。 |
| P1 角色 vs 流 | CrewAI Flows | Crew（模板角色）vs Flow（确认后不可变执行图）。模板角色只对 `templates/software-development-team` 有启发。 |
| 只看 IA | Dify、n8n | 工作流页 + 运行记录的壳信息架构（[IA §2](../product-ui/01-information-architecture.md#2-一级导航)、[§6.1](../product-ui/01-information-architecture.md#61-运行记录)、[§6.2](../product-ui/01-information-architecture.md#62-工作流)）。我们的画布编辑 Workforce 有限 DAG（[D15](../planning/decision-register.md#d15-可视化工作流画布编辑器)），不采用其栈。 |
| 语义对照 | Temporal、Inngest | 耐久 / 幂等 Run 语义，只服务测试与状态矩阵。V0.1 **明确不**上 Temporal（[ADR 0002](../adr/0002-multi-node-technology-strategy.md)）。 |
| 叙事即可 | Continue | 本地 IDE host 叙事；不要把范围扩成「再做一个 Continue」。 |
| 模板角色 | MetaGPT、ChatDev | 只给软件开发团队模板看角色图，不引入其框架。 |
| 降权 | 云 SaaS chatbot、BabyAGI / 早期 AutoGPT、维护态 AutoGen | 不排期。OpenAgentd / Mind Agency 最多扫 Run 可视化与 YAML DAG + checkpoint + review gate。 |

## 明确非目标

- 插件 / Agent marketplace。
- 全自动无人值守（跳过 plan / artifact / budget gate）。
- 一上来换成 Temporal 或把 Inngest 当工作流引擎。
- 用 Mock、单测或 happy-dom / opt-in Electron helper 冒充 headed 真窗口或 Codex live。
- 把 Dify / n8n 当架构蓝本或通用 iPaaS。画布是产品能力（[D15](../planning/decision-register.md#d15-可视化工作流画布编辑器)、[IA §6.2](../product-ui/01-information-architecture.md#62-工作流)），不是后置项，也不采用其栈。
- 换用 Eigent 的 Python / CAMEL 栈，或未经单独评估就引入 LangChain monorepo。
