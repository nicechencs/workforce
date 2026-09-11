import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { cn } from "./cn.js";
import {
  IconApprovals,
  IconDashboard,
  IconNodes,
  IconProjects,
  IconRuns,
  IconSettings,
  IconTeams,
  IconWorkflows,
  type IconProps,
} from "./icons.js";

/**
 * Workforce 基础组件层。
 *
 * 视觉在 apps/desktop/src/renderer/styles.css，色值与几何来自
 * packages/ui/src/tokens.ts。页面只组合这里的组件，不再写 inline style
 * 或第二套颜色（docs/product-ui/04-design-system.md §4）。
 */

export type Tone = "default" | "muted" | "accent" | "success" | "warning" | "danger" | "info";

/* ─── Page ──────────────────────────────────────────────────────────────── */

export interface PageProps {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
  testId?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Page(props: PageProps): ReactNode {
  return (
    <section className={cn("wf-page", props.className)} data-testid={props.testId}>
      <PageHeader title={props.title} subtitle={props.subtitle} actions={props.actions} />
      {props.children}
    </section>
  );
}

export function PageHeader(props: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode | undefined;
}): ReactNode {
  return (
    <header className="wf-page-header">
      <div>
        <h1 className="wf-page-header-title">{props.title}</h1>
        {props.subtitle !== undefined ? (
          <p className="wf-page-header-subtitle">{props.subtitle}</p>
        ) : null}
      </div>
      {props.actions !== undefined ? (
        <div className="wf-page-header-actions">{props.actions}</div>
      ) : null}
    </header>
  );
}

/* ─── Card ──────────────────────────────────────────────────────────────── */

export type CardVariant = "default" | "plain" | "subtle";

export function Card(props: {
  title?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  variant?: CardVariant | undefined;
  testId?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}): ReactNode {
  const variant = props.variant ?? "default";
  const hasHeader = props.title !== undefined || props.actions !== undefined;
  return (
    <section
      className={cn(
        "wf-card",
        variant === "plain" && "wf-card-plain",
        variant === "subtle" && "wf-card-subtle",
        props.className,
      )}
      data-testid={props.testId}
    >
      {hasHeader ? (
        <div className="wf-card-header">
          {props.title !== undefined ? <h2 className="wf-card-title">{props.title}</h2> : <span />}
          {props.actions !== undefined ? (
            <div className="wf-chrome-actions">{props.actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={hasHeader ? "wf-card-body" : "wf-card-body wf-card-body-flush"}>
        {props.children}
      </div>
    </section>
  );
}

/** 无标题卡片：正文留白与有标题卡片一致。 */
export function CardBody(props: {
  children: ReactNode;
  className?: string | undefined;
}): ReactNode {
  return (
    <div className={cn("wf-card-body wf-card-body-flush", props.className)}>{props.children}</div>
  );
}

export function MetricGrid(props: { children: ReactNode }): ReactNode {
  return <div className="wf-metric-grid">{props.children}</div>;
}

export function Kpi(props: {
  label: string;
  value: string;
  testId?: string | undefined;
}): ReactNode {
  return (
    <div className="wf-card wf-kpi" data-testid={props.testId}>
      <p className="wf-kpi-label">{props.label}</p>
      <p className="wf-kpi-value">{props.value}</p>
    </div>
  );
}

/* ─── Button ────────────────────────────────────────────────────────────── */

export type ButtonVariant =
  "primary" | "secondary" | "outline" | "ghost" | "danger" | "dangerOutline";
export type ButtonSize = "sm" | "default" | "lg" | "icon";

/**
 * 默认是 `secondary`：一个页面最多一个 `primary` 动作，放在页头、空态、
 * 错误态或对话框确认里，重复列表行不要用 `primary`。
 */
export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant | undefined;
    size?: ButtonSize | undefined;
    testId?: string | undefined;
  },
): ReactNode {
  const { variant = "secondary", size = "default", className, type, testId, ...rest } = props;
  return (
    <button
      {...rest}
      type={type ?? "button"}
      data-btn={variant}
      data-testid={testId}
      className={cn(
        "wf-btn",
        `wf-btn-${variant === "dangerOutline" ? "danger-outline" : variant}`,
        size === "sm" && "wf-btn-sm",
        size === "lg" && "wf-btn-lg",
        size === "icon" && "wf-btn-icon",
        className,
      )}
    />
  );
}

/* ─── Badge / status ────────────────────────────────────────────────────── */

export function Badge(props: {
  tone?: Tone | undefined;
  testId?: string | undefined;
  children: ReactNode;
}): ReactNode {
  const tone = props.tone ?? "default";
  return (
    <span
      className={cn("wf-badge", tone !== "default" && `wf-badge-${tone}`)}
      data-testid={props.testId}
    >
      {props.children}
    </span>
  );
}

export function Dot(props: { tone?: Tone | undefined }): ReactNode {
  const tone = props.tone ?? "default";
  return (
    <span className={cn("wf-dot", tone !== "default" && `wf-dot-${tone}`)} aria-hidden="true" />
  );
}

/** 状态点 + 文字：状态不能只靠颜色表达。 */
export function StatusText(props: { tone?: Tone | undefined; children: ReactNode }): ReactNode {
  const tone = props.tone ?? "default";
  return (
    <span className={cn("wf-inline-status", tone !== "default" && `wf-inline-status-${tone}`)}>
      <Dot tone={tone} />
      {props.children}
    </span>
  );
}

/** Agent / Runtime 品牌圆点，颜色只来自 `--wf-agent-*`。 */
export function AgentDot(props: { id: string; title?: string | undefined }): ReactNode {
  const color = /^[a-z0-9-]+$/.test(props.id)
    ? `var(--wf-agent-${props.id}, var(--wf-text-muted))`
    : "var(--wf-text-muted)";
  return (
    <span
      className="wf-agent-dot"
      style={{ background: color }}
      title={props.title}
      aria-hidden="true"
    />
  );
}

/* ─── 表单 ──────────────────────────────────────────────────────────────── */

export function Field(props: {
  label: string;
  htmlFor: string;
  hint?: string | undefined;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="wf-field">
      <label className="wf-label" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
      {props.hint !== undefined ? <p className="wf-muted">{props.hint}</p> : null}
    </div>
  );
}

export function Input(
  props: InputHTMLAttributes<HTMLInputElement> & { testId?: string | undefined },
): ReactNode {
  const { className, testId, ...rest } = props;
  return <input {...rest} data-testid={testId} className={cn("wf-input", className)} />;
}

export function Textarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & { testId?: string | undefined },
): ReactNode {
  const { className, testId, ...rest } = props;
  return <textarea {...rest} data-testid={testId} className={cn("wf-textarea", className)} />;
}

export function Select(
  props: SelectHTMLAttributes<HTMLSelectElement> & { testId?: string | undefined },
): ReactNode {
  const { className, testId, ...rest } = props;
  return <select {...rest} data-testid={testId} className={cn("wf-select", className)} />;
}

/* ─── Tabs ──────────────────────────────────────────────────────────────── */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  count?: number | undefined;
  disabled?: boolean | undefined;
}

export function Tabs<T extends string>(props: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  testId?: string | undefined;
  tabTestIdPrefix?: string | undefined;
}): ReactNode {
  return (
    <nav
      className="wf-tabs wf-page-tabs"
      role="tablist"
      aria-label={props.ariaLabel}
      data-testid={props.testId}
    >
      {props.items.map((item) => {
        const current = item.id === props.value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={current}
            disabled={item.disabled === true}
            data-testid={
              props.tabTestIdPrefix !== undefined ? `${props.tabTestIdPrefix}${item.id}` : undefined
            }
            className={cn("wf-tab", current && "is-current")}
            onClick={() => {
              if (!current && item.disabled !== true) {
                props.onChange(item.id);
              }
            }}
          >
            {item.label}
            {item.count !== undefined ? <span className="wf-tab-count">{item.count}</span> : null}
          </button>
        );
      })}
    </nav>
  );
}

/** 页内取值控件（不是页级导航）：外观、筛选等小集合互斥选择。 */
export function SegmentedControl<T extends string>(props: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
}): ReactNode {
  return (
    <div className="wf-tabs" role="group" aria-label={props.ariaLabel}>
      {props.items.map((item) => {
        const current = item.id === props.value;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={current}
            disabled={item.disabled === true}
            className={cn("wf-tab", current && "is-current")}
            onClick={() => {
              if (!current && item.disabled !== true) {
                props.onChange(item.id);
              }
            }}
          >
            {item.label}
            {item.count !== undefined ? <span className="wf-tab-count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 可点选 chip。`swatch` 用于主题色/底色这类需要预览色的场合。 */
export function ChipGroup<T extends string>(props: {
  items: readonly { id: T; label: string; swatch?: string | undefined }[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  disabled?: boolean | undefined;
}): ReactNode {
  return (
    <div className="wf-cluster" role="radiogroup" aria-label={props.ariaLabel}>
      {props.items.map((item) => {
        const current = item.id === props.value;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={current}
            disabled={props.disabled === true}
            className={cn("wf-chip", current && "is-current")}
            onClick={() => {
              if (!current && props.disabled !== true) {
                props.onChange(item.id);
              }
            }}
          >
            {item.swatch !== undefined ? (
              <span
                className="wf-chip-swatch"
                style={{ background: item.swatch }}
                aria-hidden="true"
              />
            ) : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── 列表 ──────────────────────────────────────────────────────────────── */

export function List(props: { children: ReactNode; testId?: string | undefined }): ReactNode {
  return (
    <ul className="wf-list" data-testid={props.testId}>
      {props.children}
    </ul>
  );
}

export function ListRow(props: {
  title: ReactNode;
  meta?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
  testId?: string | undefined;
  children?: ReactNode | undefined;
}): ReactNode {
  const body = (
    <>
      <span className="wf-list-row-title">{props.title}</span>
      {props.meta !== undefined ? <span className="wf-list-row-meta">{props.meta}</span> : null}
      {props.children}
    </>
  );
  if (props.onClick === undefined) {
    return (
      <li className="wf-list-row" data-testid={props.testId}>
        {body}
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        className="wf-list-row"
        data-testid={props.testId}
        onClick={props.onClick}
      >
        {body}
      </button>
    </li>
  );
}

export function CardList(props: {
  children: ReactNode;
  className?: string | undefined;
}): ReactNode {
  return <div className={cn("wf-card-list", props.className)}>{props.children}</div>;
}

/* ─── 反馈 ──────────────────────────────────────────────────────────────── */

export type NoticeTone = "info" | "warning" | "danger";

export function Notice(props: {
  tone?: NoticeTone | undefined;
  title?: string | undefined;
  children?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  role?: "status" | "alert" | undefined;
}): ReactNode {
  const tone = props.tone ?? "info";
  return (
    <div className={cn("wf-notice", `wf-notice-${tone}`)} role={props.role ?? "status"}>
      {props.title !== undefined ? <div className="wf-notice-title">{props.title}</div> : null}
      {props.children}
      {props.actions !== undefined ? (
        <div className="wf-notice-actions">{props.actions}</div>
      ) : null}
    </div>
  );
}

export function EmptyState(props: {
  title?: string | undefined;
  children: ReactNode;
  action?: ReactNode | undefined;
  testId?: string | undefined;
}): ReactNode {
  return (
    <div className="wf-empty" data-testid={props.testId}>
      {props.title !== undefined ? <p className="wf-empty-title">{props.title}</p> : null}
      <p className="wf-muted">{props.children}</p>
      {props.action !== undefined ? <div className="wf-chrome-actions">{props.action}</div> : null}
    </div>
  );
}

export function ErrorText(props: { children: ReactNode | null | undefined }): ReactNode {
  if (props.children === null || props.children === undefined || props.children === "") {
    return null;
  }
  return (
    <p className="wf-error-text" role="alert">
      {props.children}
    </p>
  );
}

export function LoadingText(props: { children?: ReactNode | undefined }): ReactNode {
  return (
    <p className="wf-loading" role="status">
      <span className="wf-spinner" aria-hidden="true" />
      {props.children ?? "加载中…"}
    </p>
  );
}

export function Muted(props: { children: ReactNode }): ReactNode {
  return <p className="wf-muted">{props.children}</p>;
}

export function Stack(props: { className?: string | undefined; children: ReactNode }): ReactNode {
  return <div className={cn("wf-stack", props.className)}>{props.children}</div>;
}

export function Cluster(props: { className?: string | undefined; children: ReactNode }): ReactNode {
  return <div className={cn("wf-cluster", props.className)}>{props.children}</div>;
}

export function Split(props: { children: ReactNode }): ReactNode {
  return <div className="wf-split">{props.children}</div>;
}

/* ─── 导航图标映射 ──────────────────────────────────────────────────────── */

export function NavIcon(props: IconProps & { slot: string }): ReactNode {
  const { slot, ...rest } = props;
  switch (slot) {
    case "dashboard":
      return <IconDashboard {...rest} />;
    case "projects":
      return <IconProjects {...rest} />;
    case "teams":
      return <IconTeams {...rest} />;
    case "nodes":
      return <IconNodes {...rest} />;
    case "approvals":
      return <IconApprovals {...rest} />;
    case "runs":
      return <IconRuns {...rest} />;
    case "workflows":
      return <IconWorkflows {...rest} />;
    case "settings":
      return <IconSettings {...rest} />;
    default:
      return <IconProjects {...rest} />;
  }
}
