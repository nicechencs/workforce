---
title: 测试与验证
type: guide
status: current
owner: maintainers
updated: 2026-09-10
---

# 测试与验证

本页按改动范围选择验证。日常开发使用最小、相关的检查；跨包、提交前和 CI 再补完整矩阵。

## 基础命令

从仓库根目录运行：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check:docs
```

`pnpm test` 包含 package/app 单测和当前 M3 Mock HTTP integration，但不证明 headed Electron、真实 Codex、真实 worktree 整合或未覆盖平台通过。

## 按改动面选择

| 改动 | 最小验证 |
| --- | --- |
| Markdown 与治理规则 | `pnpm check:docs` |
| 单一纯函数或 package 内逻辑 | 相关 Vitest + 对应 package typecheck |
| React 页面或 view model | 相关 Vitest + `pnpm --filter @workforce/desktop typecheck` |
| 公共协议、exports、DTO 或 ports | contract 测试 + 消费者 typecheck + `pnpm typecheck` |
| Workflow/DAG/状态转换 | workflow-engine 相关测试 + Application 用例测试 |
| Daemon composition 或 typed client | Daemon 测试 + `tests/integration` 对应场景 |
| Runtime SPI/Host/Adapter | contract suite + Host 场景；真实能力单独标记 |
| SQLite、幂等、恢复或并发 | 失败/重放/重启/乱序测试 + 对应 integration |
| worktree、进程或跨平台路径 | 包级测试 + 实际目标平台证据 |
| 依赖、生产边界、打包或发布 | 完整 `format:check`、lint、typecheck、test、build 和发布专用检查 |

可使用 Vitest 的文件或名称过滤运行相关测试。不要为了局部改动默认运行所有平台或真实付费 Runtime。

## 证据边界

- Mock 通过只能证明 Mock 契约和组合路径，不能证明真实 Runtime 可执行。
- Runtime `describe` 或 `validate` 通过不等于 `start/stream/cancel/reconcile` 已验证。
- HTTP headless 流程不等于 headed Electron 人工路径通过。声称桌面主路径可用时，真窗口验收由 [04-collab-and-review.md](../planning/04-collab-and-review.md) 的 Test-bot 执行，不在本页重复角色表。
- 合成 patch/test/review Artifact 不能代替真实 worktree、测试命令和 Reviewer 输出。
- 未执行的命令写“未运行”；失败命令保留原始用例、退出码和错误摘要。
- 不通过放宽断言、跳过失败分支或静默回退 Mock 隐藏回归。

## 验证记录

交付时记录：

```text
命令：
工作目录：
环境和版本：
退出码：
通过/失败摘要：
对应 commit/digest：
未覆盖范围：
```

后续改动只使受影响证据失效。最终整合产生新 digest 时，重新执行与整合结果有关的测试和审查。
