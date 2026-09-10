---
title: Workforce 文档风格与治理
type: governance
status: current
owner: maintainers
updated: 2026-09-10
---

# 文档风格与治理

本页约束新建和实质重写的现行文档。现有 blueprint、planning 和 spike 文档按需迁移，不为补元数据制造无关的大规模 diff。

## 元数据

新建或实质重写的现行文档使用 YAML front matter：

```yaml
---
title: 页面标题
type: reference
status: current
owner: maintainers
updated: 2026-09-10
---
```

- `type` 使用 `navigation`、`guide`、`reference`、`architecture`、`protocol`、`decision`、`proposal`、`status`、`governance`、`operations` 或 `archive`。
- `status` 使用 `current`、`proposed`、`historical` 或 `archived`。
- 只有 `current` 文档可以作为当前操作或实现事实的权威入口。
- `updated` 使用 `YYYY-MM-DD`，实现事实或规则变化时更新。

当前检查器要求 `docs/README.md`、`docs/STYLE.md`、`docs/guides/` 和 `docs/reference/` 具有元数据；其他旧文档以后在实质修改时迁移。

## 分类和权威来源

- blueprint 描述产品与协议基线；ADR 和 decision register 记录已接受决定；protocols 描述版本化契约；status 描述源码和测试可确认的当前实现。
- 一个事实只有一个当前权威来源。其他页面只保留短摘要并链接，不复制状态矩阵、能力矩阵或命令清单。
- Proposal 和 spike 不能写成已经实现；Mock 结果不能写成真实 Runtime 或平台验证。
- 过时的一次性计划应标记 `historical` 或移入归档；不要继续充当当前任务清单。

## 内容与链接

- 文件名使用小写 kebab-case；链接使用仓库内相对路径并包含 `.md`。
- 页面开头先说明范围。路径、命令、字段和代码符号使用反引号。
- 表格用于稳定字段和状态；流程图后补充文字结论。
- 修改行为、命令、能力、状态或验证结论时，同一变更更新对应现行文档。
- 新增或修改治理文档后运行 `pnpm check:docs`。

## 文档检查

`pnpm check:docs` 以渐进方式检查当前治理入口：

- 必需元数据；
- 重复标题锚点；
- 仓库内链接和标题片段；
- 链接不得逃出仓库。

检查范围未来可以扩大，但扩大前应先单独清理旧文档，避免功能 PR 被历史问题阻塞。
