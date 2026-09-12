import type { OrchestrationMode } from "@workforce/protocol";
import type { ReactNode } from "react";

import { Card, Field, Muted, Notice, Select } from "../../components/ui.js";
import {
  DIRECT_COPY,
  DIRECT_TASK_REQUIRED,
  MODE_LABELS,
  SLICE_NOTE,
  WORKFLOW_BOUND_COPY,
  canSelectMode,
  type OrchestrationProbe,
} from "./model.js";

export interface OrchestrationTaskOption {
  id: string;
  title: string;
}

export interface OrchestrationModeControlProps {
  selected: OrchestrationMode;
  probe: OrchestrationProbe;
  disabled?: boolean;
  onChange: (mode: OrchestrationMode) => void;
  tasks?: readonly OrchestrationTaskOption[];
  selectedTaskId?: string;
  onSelectTask?: (taskId: string) => void;
}

export function OrchestrationModeControl(props: OrchestrationModeControlProps): ReactNode {
  const disabled = props.disabled === true;
  const directEnabled = !disabled && canSelectMode("direct", props.probe);
  const tasks = props.tasks ?? [];
  return (
    <Card title="执行模式" testId="orchestration-mode-control">
      <p className="wf-muted" data-testid="orchestration-mode-slice-note">
        {SLICE_NOTE}
      </p>
      <div className="wf-cluster" role="radiogroup" aria-label="orchestrationMode">
        <ModeButton
          mode="workflow_bound"
          selected={props.selected}
          enabled={!disabled && canSelectMode("workflow_bound", props.probe)}
          onChange={props.onChange}
        />
        <ModeButton
          mode="direct"
          selected={props.selected}
          enabled={directEnabled}
          onChange={props.onChange}
        />
      </div>
      <p className="wf-muted" data-testid="orchestration-mode-workflow-bound-copy">
        {WORKFLOW_BOUND_COPY}
      </p>
      <p
        className="wf-muted"
        data-testid="orchestration-mode-direct-copy"
        data-enabled={props.probe.direct ? "true" : "false"}
      >
        {props.probe.direct ? DIRECT_COPY : props.probe.reason}
      </p>
      {props.probe.direct && props.selected === "direct" ? (
        <Field label="直接执行目标 Task" htmlFor="wf-orchestration-direct-task">
          <Select
            id="wf-orchestration-direct-task"
            testId="orchestration-direct-task"
            value={props.selectedTaskId ?? ""}
            disabled={disabled || !directEnabled}
            onChange={(event) => {
              props.onSelectTask?.(event.target.value);
            }}
          >
            <option value="">选择已有 Task</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}（{task.id}）
              </option>
            ))}
          </Select>
          {tasks.length === 0 ? <Muted>{DIRECT_TASK_REQUIRED}</Muted> : null}
        </Field>
      ) : null}
      {props.probe.direct ? null : <Notice tone="warning">{props.probe.reason}</Notice>}
    </Card>
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
      className={pressed ? "wf-chip is-current" : "wf-chip"}
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
