---
title: Workforce UI 设计系统
type: reference
status: current
owner: maintainers
updated: 2026-09-11
---

# Workforce UI 设计系统

**范围：** 本页是 Workforce 桌面客户端（`apps/desktop/src/renderer`）视觉语言的当前权威来源，规定 token 语义、字号、圆角、间距、表面、组件选择与状态呈现。页面组合与信息架构仍以 [01-information-architecture.md](01-information-architecture.md) 和 [03-p0-wireframes.md](03-p0-wireframes.md) 为准；本页不发明 API、状态值或页面能力。

**日期：** 2026-09-11

**对齐基线：** AgentHub（`D:\demo\chen\2026\AgentHub`）的 `src/styles/tokens.ts` 与 `docs/ui/design-system.md`。Workforce 采用**同一套语义角色与几何阶梯**，不复制其实现栈。差异清单见 §7。

## 1. 设计原则

1. **安静的桌面工具。** 中性表面加上克制的强调；Agent / Runtime 品牌色只用于小型身份标记，不做大面积背景。
2. **一个主操作。** 一个页面最多一个 `primary` 按钮，位置在页头、空态、错误态或确认对话框；重复的列表行不使用 `primary`。
3. **可行动的空态。** 数据为空时给出下一步；没有下一步时明确说明原因，不伪造内容。
4. **渐进披露。** 主列保持可扫读；解释性内容进入空态、`Notice`、`Muted` 说明或对话框。
5. **局部失败是常态。** 一个能力或探测失败不清空整页；健康区块继续渲染，仅标记不可用区块。
6. **危险先解释。** 破坏性或写配置的动作先说明影响与后果，再执行。
7. **不伪造成功。** 未实现的能力不渲染可点击成功态；Mock、合成数据和未运行 Runtime 不得写成已完成（与 AGENTS.md 红线一致）。

## 2. Token 与几何

运行时真源是 `packages/ui/src/tokens.ts`。CSS 变量由 `main.tsx` 注入，业务代码只引用语义变量或本页 §4 的组件，**不得再写 hex、第二套字号或第二套圆角**。

### 2.1 字号阶

四档，禁止新增第五档。分区标题与正文同字号，靠字重区分。

| 标准 | CSS 变量 | 像素 | 用途 |
|---|---|---:|---|
| display | `--wf-font-display` | 22 | 空态主句 |
| title | `--wf-font-title` | 18 | 页标题、关键数字 |
| body | `--wf-font-body` | 14 | 正文、按钮、列表名、表单、分区标题、对话框标题 |
| meta | `--wf-font-meta` | 12 | 表头、时间、路径、角标、说明文字 |

行高由同名前缀的 `--wf-leading-*` 提供。

### 2.2 表面与颜色

| 角色 | 变量 | 用途 |
|---|---|---|
| Canvas | `--wf-bg-canvas` | 页面、主列、顶栏、状态栏 |
| Panel | `--wf-bg-panel` | 卡片、侧栏、内容面板 |
| Raised | `--wf-bg-raised` | 轨道上被抬起的项（选中 Tab、分段控件选中项） |
| Subtle | `--wf-bg-subtle` | 内嵌条带、表头、次级说明块 |
| Hover | `--wf-bg-hover` | 指针悬停在可交互项 |
| Active | `--wf-bg-active` | 当前页项、当前预览目标 |

文字三档递进：`--wf-text-primary` / `--wf-text-secondary` / `--wf-text-muted`，禁用态 `--wf-text-disabled`。边框三档：`--wf-border` / `--wf-border-strong` / `--wf-border-control`（表单控件边框）。

**深色主题是一等公民**，由 `html.dark` 提供整套变量，不是页面级覆盖。选中态用 `bg-raised` 抬起（深色下 `bg-panel` 比 `bg-hover` 更深，不能当选中底色）。

**产品主题色**是 `--wf-accent`（含 `hover` / `pressed` / `foreground` / `subtle` / `text`）。默认蓝；设置页在 indigo / blue / teal / rose / amber 五档里切换，只写 `html[data-accent]`。禁止硬编码主题色 hex，禁止拿 Agent 品牌色当页面背景或语义状态色。

**浅色画布色板**由 `html[data-canvas]` 提供（gray / white / paper / mist / sky / mint / sand / lilac），**只在浅色主题生效**；深色下不覆盖 `--wf-bg-canvas`。

状态色是语义色：`--wf-success` / `--wf-warning` / `--wf-danger` / `--wf-info`。状态必须同时有文字或图标，颜色不能单独承载语义。

### 2.3 间距、圆角与高度

- 间距阶梯：4 / 8 / 12 / 16 / 24 / 32（`--wf-space-*`）。相邻卡片之间用 12px，不要叠加多个 margin。
- 控件圆角 8px（`--wf-radius-btn`）；卡片、面板与应用壳 12px（`--wf-radius-card`）；输入壳与用户气泡 16px（`--wf-radius-lg`）；产品标 / Agent 图标 22%（`--wf-radius-mark`）。徽标、圆点、进度轨道可用 `--wf-radius-full`。不得新增其它圆角值。
- 控件高度 `--wf-control-h`（28px）/ `--wf-control-h-lg`（32px）；顶栏 `--wf-chrome-h`（44px）；状态栏 `--wf-statusbar-h`（32px）。
- 阴影：`--wf-shadow-xs` 卡片、`--wf-shadow-sm` 轻抬起控件、`--wf-shadow-md` 菜单/浮层、`--wf-shadow-lg` 对话框。**按钮悬停不加阴影**，只改填充与文字色。

### 2.4 应用壳几何

- 窗内画布缝 12px；底栏上方留 4px 缝，底栏方角贴窗底、只用上边框。
- 左侧导航是圆角面板卡片（默认 220px，可折叠为 56px 图标轨）；主列是独立的圆角面板。
- 页面内容统一 `--wf-space-12` 内边距（`.wf-page`），顶栏已含页标题，正文第一块不再额外加顶距。

## 3. 组件层

页面只组合 `apps/desktop/src/renderer/components/ui.tsx` 导出的组件，不新写 inline style，也不引入第二套 UI 库。

| 需求 | 组件 | 规则 |
|---|---|---|
| 页面骨架 | `Page` / `PageHeader` | 一个页面一个 `title`；`subtitle` 是 meta 档说明 |
| 独立内容块 | `Card` | `default` 带边框与 xs 阴影；`plain` 嵌在已有框内；`subtle` 弱底无边框 |
| 指标 | `Kpi` / `MetricGrid` | 数值用 title 档，标签用 meta 档 |
| 主要或次要命令 | `Button` | `primary` ≤ 1；其余按权重用 `secondary` / `outline` / `ghost` / `danger` / `dangerOutline`。默认 `secondary` |
| 文本录入 | `Input` / `Textarea` | 统一高度与焦点环，不自绘搜索框 |
| 表单字段 | `Field` | 标签用 meta 档，与控件成对 |
| 页级导航 | `Tabs` | 设置、项目详情等页内分区 |
| 页内取值 | `SegmentedControl` / `ChipGroup` | 外观、筛选这类小集合互斥选择；`ChipGroup` 支持色板预览 |
| 列表 | `List` / `ListRow` | 身份 + 一行 meta 的轻量列表；行点击即打开 |
| 状态 | `Badge` / `Dot` / `StatusText` | `StatusText` = 圆点 + 文字，避免只靠颜色 |
| Agent 身份 | `AgentDot` | 颜色只来自 `--wf-agent-*`，不在页面写 hex |
| 提示 | `Notice` | 页级条件与可行动提示，`tone` 取 info / warning / danger |
| 空态与加载 | `EmptyState` / `LoadingText` / `ErrorText` | 覆盖 loading / empty / error；`ErrorText` 用 `role="alert"` |
| 详情键值 | `.wf-detail-grid` | `dt` 用 meta 档浅色，`dd` 用正文色 |

### 3.1 动作层级

| 页面角色 | 处理 |
|---|---|
| 页面唯一主要结果 | `Button variant="primary"`，只在页头、空态、错误态或对话框确认 |
| 行内安全主命令 | `Button`（默认 `secondary`） |
| 行内次要动作 / 工具栏 | `outline` / `ghost` |
| 危险入口（确认前） | `dangerOutline`；破坏性确认本身用 `danger` |
| 停止中的操作 | `dangerOutline`，不要用删除图标 |

### 3.2 图标

`apps/desktop/src/renderer/components/icons.tsx` 以内联 SVG 提供 lucide 几何图标。三档尺寸，禁止第四档：

| 角色 | 尺寸 | 描边 | 用途 |
|---|---:|---:|---|
| nav | 18px | 1.6 | 侧栏一级导航 |
| chrome | 16px | 1.75 | 顶栏、按钮、图标按钮 |
| inline | 14px | 1.75 | 行内动作、状态、小按钮 |

图标按钮必须有 `aria-label`；`title` 只作悬停提示，不作为可访问名称。

## 4. 状态与可访问性

每个页面或独立加载块覆盖四种状态：

| 状态 | 处理 |
|---|---|
| Loading | 同密度骨架或 `LoadingText`；稳定区域替换时设置 `aria-busy` |
| Empty | `EmptyState` 给出下一步，或明确说明为何没有下一步 |
| Error | `ErrorText` 给出可读摘要与重试入口；不回退夹具冒充已接通 |
| Partial | 保留健康区块，只标记不可用区块 |

- 焦点可见：统一 2px 主题色焦点环，不用背景色代替焦点。
- 状态不能只靠颜色：必须配对文字、图标形状或可访问标签。
- 工具栏、网格、列表行的尺寸在加载与长文本下保持稳定，避免抖动。
- 尊重 `prefers-reduced-motion`：面板过渡与骨架动画在减动效下关闭。

## 5. 实现边界与所有权

| 路径 | 内容 | 唯一写入负责人 |
|---|---|---|
| `packages/ui/src/tokens.ts`、`theme.ts` | token 真源、CSS 变量生成、主题偏好模型 | T11 |
| `apps/desktop/src/renderer/styles.css` | 语义 class 层（结构、状态、响应式） | T11 |
| `apps/desktop/src/renderer/components/` | 基础组件、图标、`cn`、应用壳 `shell-frame` | T11 |
| `apps/desktop/src/renderer/app/theme.tsx` | `bootstrapTheme` / `ThemeProvider` / `useTheme` | T11 |
| `apps/desktop/src/renderer/features/**` | 页面组合；只消费上述组件 | T12 / T13 / T18 / T19 / T20 / T21 |

- 新增公共组件或 token 属于共享契约变更：先向 T11 提交具体字段、理由与兼容性影响，不在 feature 目录复制私有类型或第二套样式。
- feature 目录不得自写 `var(--wf-*)` 之外的色值、字号、圆角，也不得新增全局 CSS。
- Token 或主题模型变更必须同步 `packages/ui/src/tokens.test.ts` / `theme.test.ts`，并保持对比度断言通过。

## 6. 审查清单

- 是否使用了语义 token / 组件，而没有新增 hex、字号或圆角？
- 页面是否最多一个 `primary`，且重复列表行没有用它？
- Loading / empty / error / partial 四态是否都覆盖？
- 状态是否配对文字或图标，而不是只靠颜色？
- 深色主题下是否仍然可读（选中项用 `bg-raised`，浅色画布色板不覆盖深色）？
- 图标是否只用三档尺寸，图标按钮是否有可访问名称？
- 危险动作是否解释了影响，且未实现能力没有渲染可点击成功态？
- 是否可以在键盘上完成主流程，且焦点环可见？

## 7. 与 AgentHub 的对齐基线与刻意差异

**对齐（同一语义，同名角色）：**

- 四档字号、5 档圆角中的 8/12/16 + 22% 标记、4/8/12/16/24/32 间距阶梯；
- surface / text / border / status / accent 角色划分，深浅两套主题；
- 5 个主题色与浅色画布色板，`html[data-accent]` / `html[data-canvas]` 承载；
- 「一页最多一个主操作」「状态不能只靠颜色」「空态可行动」「重叠卡片只用一条 8px 缝」等组件与状态规则；
- 应用壳：圆角面板 + 12px 画布缝 + 方角贴窗底栏。

**刻意差异（因技术栈与仓库边界不同，不复制 AgentHub 实现）：**

| 维度 | AgentHub | Workforce | 原因 |
|---|---|---|---|
| 样式机制 | Tailwind + CVA + Radix + `cn()` | 手写语义 class 层（`styles.css`）+ 基础组件 | renderer 目前只有 React + Vite，引入 Tailwind/Radix 会改动根 lockfile 与构建链，超出本次设计对齐范围 |
| token 前缀 | `--bg-canvas` 等 | `--wf-` 前缀 | 避免与宿主页面或第三方样式串档 |
| 图标 | `lucide-react` 依赖 | `components/icons.tsx` 内联 SVG（同尺寸/描边档） | 不新增运行时依赖，视觉与 AgentHub 一致 |
| 主题注入 | Vite 插件生成 virtual CSS + `index.html` 内联脚本 | `main.tsx` 注入 `<style>` + 挂载前 `bootstrapTheme()` | 桌面 `index.html` 的 CSP 不允许内联脚本，改在模块加载期同步落地 |
| 页面导航 | react-router | hash 路由（`app/hash-router.ts`） | 桌面壳既有约定，不属于视觉对齐范围 |
| 文案 | 中英双语字典 | 中文优先 | 与 Workforce 现有产品语言一致 |

**未对齐、仍为后续项：** Dialog / DropdownMenu / Tooltip / Toast / Table / Skeleton 等复合组件；无障碍树与焦点陷阱的自动化测试；`prefers-reduced-motion` 之外的动效规范。这些在 T11 领取时按需补齐，不在页面内各自实现。

## 8. 变更要求

- 修改 token、主题模型或基础组件时，同一变更必须包含：对应测试、`pnpm typecheck`、相关 Vitest，以及需要时的 `pnpm --filter @workforce/desktop build`。
- 修改本页或新增设计相关文档后运行 `pnpm check:docs`。
- 产品或规划文档实质变化时，向 [communication-history.md](../planning/communication-history.md) 追加当日（Asia/Taipei）条目。
