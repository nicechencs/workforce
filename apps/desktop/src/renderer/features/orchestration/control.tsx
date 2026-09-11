import type { OrchestrationMode } from "@workforce/protocol";
import type { ReactNode } from "react";

import { buttonStyle, cardStyle, mutedStyle, rowStyle, titleStyle } from "../projects/ui.js";
import {
  DIRECT_COPY,
  MODE_LABELS,
  SLICE_NOTE,
  WORKFLOW_BOUND_COPY,
  canSelectMode,
  type OrchestrationProbe,
} from "./model.js";

export interface OrchestrationModeControlProps {
  selected: OrchestrationMode;
  probe: OrchestrationProbe;
  disabled?: boolean;
  onChange: (mode: OrchestrationMode) => void;
}

export function OrchestrationModeControl(props: OrchestrationModeControlProps): ReactNode {
  const disabled = props.disabled === true;
  return (
    <section style={cardStyle} data-testid="orchestration-mode-control">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>执行模式</h2>
      <p style={mutedStyle} data-testid="orchestration-mode-slice-note">
        {SLICE_NOTE}
      </p>
      <div style={rowStyle} role="radiogroup" aria-label="orchestrationMode">
        <ModeButton
          mode="workflow_bound"
          selected={props.selected}
          enabled={!disabled && canSelectMode("workflow_bound", props.probe)}
          onChange={props.onChange}
        />
        <ModeButton
          mode="direct"
          selected={props.selected}
          enabled={!disabled && canSelectMode("direct", props.probe)}
          onChange={props.onChange}
        />
      </div>
      <p style={mutedStyle} data-testid="orchestration-mode-workflow-bound-copy">
        {WORKFLOW_BOUND_COPY}
      </p>
      <p
        style={mutedStyle}
        data-testid="orchestration-mode-direct-copy"
        data-enabled={props.probe.direct ? "true" : "false"}
      >
        {props.probe.direct ? DIRECT_COPY : props.probe.reason}
      </p>
    </section>
  );
}

function ModeButton(props: {
  mode: OrchestrationMode;
  selected: OrchestrationMode;
  enabled: boolean;
  onChange: (mode: OrchestrationMode) => void;
}): ReactNode {
  const pressed = props.selected === props.mode;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={pressed}
      disabled={!props.enabled}
      data-testid={`orchestration-mode-${props.mode}`}
      style={buttonStyle(pressed ? "primary" : "secondary", !props.enabled)}
      onClick={() => {
        if (props.enabled) {
          props.onChange(props.mode);
        }
      }}
    >
      {MODE_LABELS[props.mode]}
    </button>
  );
}
