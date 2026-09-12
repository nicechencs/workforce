import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { cn } from "./cn.js";
import { IconChevronDown, IconX } from "./icons.js";

export type OverlayTone = "info" | "warning" | "danger";

/* ─── Dialog ───────────────────────────────────────────────────────────── */

export function Dialog(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode | undefined;
  testId?: string | undefined;
}): ReactNode {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const previous = document.activeElement;
    const panel = panelRef.current;
    panel?.focus();
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== "Tab" || panel === null) {
        return;
      }
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, [props.open, props.onClose]);

  if (!props.open) {
    return null;
  }
  return (
    <div className="wf-dialog-backdrop" onClick={props.onClose}>
      <div
        ref={panelRef}
        className="wf-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={props.testId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="wf-dialog-header">
          <h2 id={titleId} className="wf-dialog-title">
            {props.title}
          </h2>
          <button
            type="button"
            className="wf-btn wf-btn-ghost wf-btn-icon"
            aria-label="关闭"
            onClick={props.onClose}
          >
            <IconX size={16} />
          </button>
        </div>
        <div className="wf-dialog-body">{props.children}</div>
        {props.actions !== undefined ? (
          <div className="wf-dialog-footer">{props.actions}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ─── Dropdown ───────────────────────────────────────────────────────────── */

export interface DropdownItem {
  id: string;
  label: string;
  disabled?: boolean | undefined;
  danger?: boolean | undefined;
}

export function DropdownMenu(props: {
  label: ReactNode;
  items: readonly DropdownItem[];
  onSelect: (id: string) => void;
  ariaLabel: string;
  testId?: string | undefined;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="wf-dropdown">
      <button
        type="button"
        className="wf-btn wf-btn-outline"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.ariaLabel}
        data-testid={props.testId}
        onClick={() => setOpen((current) => !current)}
      >
        {props.label}
        <IconChevronDown size={14} />
      </button>
      {open ? (
        <ul className="wf-menu" role="menu" aria-label={props.ariaLabel}>
          {props.items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled === true}
                className={cn("wf-menu-item", item.danger === true && "wf-menu-item-danger")}
                onClick={() => {
                  if (item.disabled === true) {
                    return;
                  }
                  props.onSelect(item.id);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ─── Tooltip ───────────────────────────────────────────────────────────── */

export function Tooltip(props: {
  content: string;
  children: ReactNode;
}): ReactNode {
  const tooltipId = useId();
  return (
    <span className="wf-tooltip">
      <span aria-describedby={tooltipId}>{props.children}</span>
      <span id={tooltipId} className="wf-tooltip-content" role="tooltip">
        {props.content}
      </span>
    </span>
  );
}

/* ─── Toast ─────────────────────────────────────────────────────────────── */

export function ToastRegion(props: { children: ReactNode }): ReactNode {
  return (
    <div className="wf-toast-region" aria-live="polite" aria-relevant="additions">
      {props.children}
    </div>
  );
}

export function Toast(props: {
  tone?: OverlayTone | undefined;
  children: ReactNode;
  onDismiss?: (() => void) | undefined;
}): ReactNode {
  const tone = props.tone ?? "info";
  return (
    <div className={cn("wf-toast", `wf-toast-${tone}`)} role="status">
      <div className="wf-toast-body">{props.children}</div>
      {props.onDismiss !== undefined ? (
        <button
          type="button"
          className="wf-btn wf-btn-ghost wf-btn-icon"
          aria-label="关闭通知"
          onClick={props.onDismiss}
        >
          <IconX size={14} />
        </button>
      ) : null}
    </div>
  );
}
