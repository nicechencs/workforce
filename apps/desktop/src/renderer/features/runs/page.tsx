import type { CapabilitiesDto, RunDto } from "@workforce/desktop-client";
import { useEffect, useState, type ReactNode } from "react";
import type { WorkforcePreloadApi } from "@workforce/ui";

import type { FeaturePageProps } from "../contract.js";
import {
  formatT13Error,
  getT13Client,
  T13Button,
  T13Card,
  T13Error,
  T13Page,
  t13CommandOptions,
  t13Styles,
  useT13Query,
} from "../_t13_client.js";
import {
  canCancelRun,
  canOfferRerun,
  formatRunUsage,
  isUnknownRunRecovery,
  runStatusLabel,
  shouldShowInput,
  shouldShowPause,
  shouldShowResume,
  shouldShowTakeOver,
  mergeEventLists,
  timelineFromEvents,
  type TimelineRow,
} from "./model.js";

export function RunsPage(props: FeaturePageProps): ReactNode {
  const runId = props.params.runId;
  if (runId !== undefined && runId.length > 0) {
    return <RunConsolePage {...props} runId={runId} />;
  }
  return <RunListPage {...props} />;
}

function RunListPage(props: FeaturePageProps): ReactNode {
  const query = useT13Query("runs:list", async () => {
    const page = await getT13Client().listRuns({ limit: 50 });
    return page.items;
  });
  return (
    <T13Page title="运行记录" subtitle="执行历史、状态与用量。取消中不是已取消。">
      <T13Error message={query.error} />
      {query.loading && query.data === null ? <p style={t13Styles.muted}>加载中…</p> : null}
      <RunListView
        runs={query.data ?? []}
        onOpen={(id) => {
          props.navigate(`/runs/${id}`);
        }}
      />
    </T13Page>
  );
}

export function RunListView(props: { runs: RunDto[]; onOpen: (id: string) => void }): ReactNode {
  if (props.runs.length === 0) {
    return (
      <T13Card>
        <p style={t13Styles.muted}>暂无运行记录。</p>
      </T13Card>
    );
  }
  return (
    <ul style={t13Styles.list}>
      {props.runs.map((run) => (
        <li key={run.id}>
          <T13Card testId={`run-row-${run.id}`}>
            <div style={t13Styles.header}>
              <div>
                <strong>{run.id}</strong>
                <p style={t13Styles.muted}>
                  Task {run.taskId} · 项目 {run.projectId}
                </p>
              </div>
              <T13Button
                kind="primary"
                onClick={() => {
                  props.onOpen(run.id);
                }}
              >
                打开控制台
              </T13Button>
            </div>
            <p data-testid={`run-status-${run.id}`}>{runStatusLabel(run)}</p>
            <p style={t13Styles.muted} data-testid={`run-usage-${run.id}`}>
              {formatRunUsage(run.usage)}
            </p>
          </T13Card>
        </li>
      ))}
    </ul>
  );
}

function RunConsolePage(props: FeaturePageProps & { runId: string }): ReactNode {
  const query = useT13Query(`runs:${props.runId}`, async () => {
    const client = getT13Client();
    const [run, events, capabilities] = await Promise.all([
      client.getRun(props.runId),
      client.listRunEvents(props.runId, { limit: 200 }),
      client.getCapabilities(),
    ]);
    return { run, events: events.items, capabilities };
  });
  const [cancelAccepted, setCancelAccepted] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inputText, setInputText] = useState("");
  const [liveEvents, setLiveEvents] = useState<unknown[]>([]);

  useEffect(() => {
    setLiveEvents([]);
    const api = (globalThis as { window?: { workforce?: WorkforcePreloadApi } }).window?.workforce;
    if (!api) {
      return;
    }
    let subscriptionId: string | undefined;
    let cancelled = false;
    void api.api.subscribeEvents({}).then((ref) => {
      if (!cancelled) {
        subscriptionId = ref.subscriptionId;
      }
    });
    const unsubscribe = api.api.onEvent((event) => {
      setLiveEvents((current) => [...current, event]);
    });
    return () => {
      cancelled = true;
      unsubscribe();
      if (subscriptionId) {
        void api.api.unsubscribeEvents(subscriptionId);
      }
    };
  }, [props.runId]);

  const snapshot = query.data;
  const run = snapshot?.run ?? null;

  async function onCancel(): Promise<void> {
    if (!run) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await getT13Client().cancelRun(run.id, t13CommandOptions(run.stateRevision), {});
      setCancelAccepted(true);
    } catch (error) {
      setActionError(formatT13Error(error));
    } finally {
      setBusy(false);
    }
  }

  async function onInput(): Promise<void> {
    if (!run) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await getT13Client().sendRunInput(
        run.id,
        { text: inputText },
        t13CommandOptions(run.stateRevision),
      );
      setInputText("");
      query.reload();
    } catch (error) {
      setActionError(formatT13Error(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <T13Page
      title={`Run 控制台`}
      subtitle={props.runId}
      actions={
        <T13Button
          onClick={() => {
            props.navigate("/runs");
          }}
        >
          返回列表
        </T13Button>
      }
    >
      <T13Error message={query.error} />
      <T13Error message={actionError} />
      {query.loading && run === null ? <p style={t13Styles.muted}>加载中…</p> : null}
      {run ? (
        <RunConsoleView
          run={run}
          events={mergeEventLists(snapshot?.events ?? [], liveEvents)}
          capabilities={snapshot?.capabilities ?? null}
          cancelAccepted={cancelAccepted}
          busy={busy}
          inputText={inputText}
          onInputText={setInputText}
          onCancel={() => {
            void onCancel();
          }}
          onInput={() => {
            void onInput();
          }}
        />
      ) : null}
    </T13Page>
  );
}

export interface RunConsoleViewProps {
  run: RunDto;
  events: unknown[];
  capabilities: CapabilitiesDto | null;
  cancelAccepted?: boolean | undefined;
  busy?: boolean | undefined;
  inputText?: string | undefined;
  onInputText?: ((value: string) => void) | undefined;
  onCancel?: (() => void) | undefined;
  onInput?: (() => void) | undefined;
}

export function RunConsoleView(props: RunConsoleViewProps): ReactNode {
  const cancelAccepted = props.cancelAccepted === true;
  const status = runStatusLabel(props.run, { cancelAccepted });
  const rows = timelineFromEvents(props.events);
  const structured = rows.filter((row) => !row.raw);
  const raw = rows.filter((row) => row.raw);
  const unknown = isUnknownRunRecovery(props.run.status);
  const showPause = shouldShowPause(props.capabilities);
  const showResume = shouldShowResume(props.capabilities);
  const showInput = shouldShowInput(props.run, props.capabilities);
  const showTakeOver = shouldShowTakeOver(props.capabilities);
  const showCancel = canCancelRun(props.run, { cancelAccepted });

  return (
    <div>
      <T13Card testId="run-console-header">
        <div style={t13Styles.header}>
          <div>
            <strong>{props.run.id}</strong>
            <p data-testid="run-status" style={unknown ? t13Styles.warning : undefined}>
              {status}
            </p>
            {unknown ? (
              <p style={{ ...t13Styles.muted, ...t13Styles.warning }}>
                恢复状态未知：仅可诊断，不显示失败，也不开放危险再执行。
              </p>
            ) : null}
          </div>
          <div style={t13Styles.actions}>
            {showPause ? (
              <T13Button testId="run-pause" disabled>
                暂停（客户端未接入）
              </T13Button>
            ) : null}
            {showResume && props.run.status === "paused" ? (
              <T13Button testId="run-resume" disabled>
                继续（客户端未接入）
              </T13Button>
            ) : null}
            {showCancel ? (
              <T13Button
                kind="danger"
                testId="run-cancel"
                disabled={props.busy === true}
                onClick={props.onCancel}
              >
                取消
              </T13Button>
            ) : null}
            {showTakeOver ? (
              <T13Button testId="run-takeover" disabled>
                接管（客户端未接入）
              </T13Button>
            ) : null}
          </div>
        </div>
        <p style={t13Styles.muted}>
          Task {props.run.taskId} · 项目 {props.run.projectId} · attempt {props.run.attempt} ·
          generation {props.run.generation}
        </p>
      </T13Card>
      <div style={t13Styles.grid}>
        <T13Card testId="run-timeline">
          <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>事件时间线</h2>
          <TimelineList rows={structured} />
          <details>
            <summary style={t13Styles.muted}>诊断日志（stdout/stderr）</summary>
            <TimelineList rows={raw} />
          </details>
        </T13Card>
        <T13Card testId="run-context">
          <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>上下文</h2>
          <p data-testid="run-usage">{formatRunUsage(props.run.usage)}</p>
          <p style={t13Styles.muted}>用量区分未知 / 估算 / 已结算。未知成本不是 0。</p>
          <p style={t13Styles.muted}>节点：本机 · Runtime / Worker 细节以事件为准</p>
          {canOfferRerun(props.run.status) ? <T13Button>重跑</T13Button> : null}
        </T13Card>
      </div>
      {showInput ? (
        <T13Card testId="run-input">
          <label htmlFor="run-input-text">运行输入</label>
          <textarea
            id="run-input-text"
            value={props.inputText ?? ""}
            onChange={(event) => props.onInputText?.(event.target.value)}
            style={{ ...t13Styles.input, minHeight: "4rem", margin: "var(--wf-space-sm) 0" }}
          />
          <T13Button
            kind="primary"
            disabled={props.busy === true}
            onClick={props.onInput}
            testId="run-input-send"
          >
            发送输入
          </T13Button>
        </T13Card>
      ) : null}
    </div>
  );
}

function TimelineList(props: { rows: TimelineRow[] }): ReactNode {
  if (props.rows.length === 0) {
    return <p style={t13Styles.muted}>暂无事件。</p>;
  }
  return (
    <ol style={{ ...t13Styles.list, paddingLeft: 0 }}>
      {props.rows.map((row) => (
        <li
          key={row.key}
          data-testid="timeline-row"
          data-event-key={row.key}
          style={{
            borderBottom: "1px solid var(--wf-color-border)",
            padding: "var(--wf-space-sm) 0",
          }}
        >
          <div style={t13Styles.muted}>{row.time}</div>
          <pre style={t13Styles.pre}>{row.summary}</pre>
        </li>
      ))}
    </ol>
  );
}
