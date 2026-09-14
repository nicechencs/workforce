import type { ApprovalDto, ArtifactDto, CapabilitiesDto, RunDto } from "@workforce/desktop-client";
import { useEffect, useState, type ReactNode } from "react";
import type { WorkforcePreloadApi } from "@workforce/ui";

import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  List,
  ListRow,
  LoadingText,
  Muted,
  Page,
  Split,
  Textarea,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { commandOptions, formatClientError, useClientQuery } from "../../app/client-query.js";
import { getWorkforceClient } from "../../app/renderer-client.js";
import { pinnedArtifactVersion } from "../projects/model.js";
import {
  canCancelRun,
  canOfferRerun,
  EVALUATION_PENDING,
  EVALUATION_UNAVAILABLE,
  FIELD_UNRETURNED,
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
  const query = useClientQuery("runs:list", async () => {
    const page = await getWorkforceClient().listRuns({ limit: 50 });
    return page.items;
  });
  return (
    <Page title="运行记录" subtitle="执行历史、状态与用量。取消中不是已取消。">
      <ErrorText>{query.error}</ErrorText>
      {query.loading && query.data === null ? <LoadingText /> : null}
      <RunListView
        runs={query.data ?? []}
        onOpen={(id) => {
          props.navigate(`/runs/${id}`);
        }}
      />
    </Page>
  );
}

export function RunListView(props: {
  runs: RunDto[];
  onOpen: (id: string) => void;
}): ReactNode {
  if (props.runs.length === 0) {
    return (
      <Card>
        <EmptyState title="暂无运行记录">跨项目诊断入口。打开控制台后才看 Task / 项目链。</EmptyState>
      </Card>
    );
  }
  return (
    <Card>
      <List testId="run-list">
        {props.runs.map((run) => (
          <ListRow
            key={run.id}
            testId={`run-row-${run.id}`}
            title={run.id}
            meta={
              <>
                <span data-testid={`run-status-${run.id}`}>{runStatusLabel(run)}</span>
                {" · "}
                <span data-testid={`run-usage-${run.id}`}>{formatRunUsage(run.usage)}</span>
              </>
            }
            onClick={() => {
              props.onOpen(run.id);
            }}
          />
        ))}
      </List>
    </Card>
  );
}

function RunConsolePage(props: FeaturePageProps & { runId: string }): ReactNode {
  const query = useClientQuery(`runs:${props.runId}`, async () => {
    const client = getWorkforceClient();
    const [run, events, capabilities] = await Promise.all([
      client.getRun(props.runId),
      client.listRunEvents(props.runId, { limit: 200 }),
      client.getCapabilities(),
    ]);
    const [artifacts, approvals] = await Promise.all([
      listOrEmpty(() => client.listArtifacts({ runId: run.id })),
      listOrEmpty(() => client.listApprovals({ runId: run.id })),
    ]);
    return { run, events: events.items, capabilities, artifacts, approvals };
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
      await getWorkforceClient().cancelRun(run.id, commandOptions(run.stateRevision), {});
      setCancelAccepted(true);
    } catch (error) {
      setActionError(formatClientError(error));
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
      await getWorkforceClient().sendRunInput(
        run.id,
        { text: inputText },
        commandOptions(run.stateRevision),
      );
      setInputText("");
      query.reload();
    } catch (error) {
      setActionError(formatClientError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="Run 控制台"
      subtitle={props.runId}
      actions={
        <Button
          variant="outline"
          onClick={() => {
            props.navigate("/runs");
          }}
        >
          返回列表
        </Button>
      }
    >
      <ErrorText>{query.error}</ErrorText>
      <ErrorText>{actionError}</ErrorText>
      {query.loading && run === null ? <LoadingText /> : null}
      {run ? (
        <RunConsoleView
          run={run}
          events={mergeEventLists(snapshot?.events ?? [], liveEvents)}
          capabilities={snapshot?.capabilities ?? null}
          artifacts={snapshot?.artifacts ?? []}
          approvals={snapshot?.approvals ?? []}
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
          onOpenTask={() => {
            props.navigate(`/projects/${run.projectId}/tasks/${run.taskId}`);
          }}
          onOpenProject={() => {
            props.navigate(`/projects/${run.projectId}`);
          }}
          onOpenArtifact={(artifactId, versionId) => {
            props.navigate(`/artifacts/${artifactId}/versions/${versionId}`);
          }}
          onOpenApproval={(approvalId) => {
            props.navigate(`/approvals/${approvalId}`);
          }}
        />
      ) : null}
    </Page>
  );
}

export interface RunConsoleViewProps {
  run: RunDto;
  events: unknown[];
  capabilities: CapabilitiesDto | null;
  artifacts?: ArtifactDto[] | undefined;
  approvals?: ApprovalDto[] | undefined;
  cancelAccepted?: boolean | undefined;
  busy?: boolean | undefined;
  inputText?: string | undefined;
  onInputText?: ((value: string) => void) | undefined;
  onCancel?: (() => void) | undefined;
  onInput?: (() => void) | undefined;
  onOpenTask?: (() => void) | undefined;
  onOpenProject?: (() => void) | undefined;
  onOpenArtifact?: ((artifactId: string, versionId: string) => void) | undefined;
  onOpenApproval?: ((approvalId: string) => void) | undefined;
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
    <div className="wf-stack">
      <Card testId="run-console-header">
        <div className="wf-card-header wf-card-header-flush">
          <div>
            <p className="wf-list-row-title">{props.run.id}</p>
            <p
              data-testid="run-status"
              className={unknown ? "wf-inline-status-warning" : undefined}
            >
              {status}
            </p>
            {unknown ? (
              <p className="wf-inline-status-warning">
                恢复状态未知：仅可诊断，不显示失败，也不开放危险再执行。
              </p>
            ) : null}
          </div>
          <div className="wf-cluster">
            {showPause ? (
              <Button testId="run-pause" disabled>
                暂停（客户端未接入）
              </Button>
            ) : null}
            {showResume && props.run.status === "paused" ? (
              <Button testId="run-resume" disabled>
                继续（客户端未接入）
              </Button>
            ) : null}
            {showCancel ? (
              <Button
                variant="dangerOutline"
                testId="run-cancel"
                disabled={props.busy === true}
                onClick={props.onCancel}
              >
                取消
              </Button>
            ) : null}
            {showTakeOver ? (
              <Button testId="run-takeover" disabled>
                接管（客户端未接入）
              </Button>
            ) : null}
          </div>
        </div>
        <div className="wf-cluster">
          {props.onOpenTask ? (
            <Button variant="ghost" onClick={props.onOpenTask}>
              Task {props.run.taskId}
            </Button>
          ) : (
            <Muted>Task {props.run.taskId}</Muted>
          )}
          {props.onOpenProject ? (
            <Button variant="ghost" onClick={props.onOpenProject}>
              项目 {props.run.projectId}
            </Button>
          ) : (
            <Muted>项目 {props.run.projectId}</Muted>
          )}
          <Muted>
            attempt {props.run.attempt} · generation {props.run.generation}
          </Muted>
        </div>
      </Card>
      <Split>
        <Card title="事件时间线" testId="run-timeline">
          <TimelineList rows={structured} />
          <details>
            <summary className="wf-muted">诊断日志（stdout/stderr）</summary>
            <TimelineList rows={raw} />
          </details>
        </Card>
        <Card title="上下文" testId="run-context">
          <p data-testid="run-usage">{formatRunUsage(props.run.usage)}</p>
          <Muted>用量区分未知 / 估算 / 已结算。未知成本不是 0。</Muted>
          <Muted>WorkerVersion：{FIELD_UNRETURNED}</Muted>
          <Muted>Host：本机 Codex</Muted>
          <Muted>Runtime：{props.run.transport ?? FIELD_UNRETURNED}</Muted>
          <Muted>节点：{FIELD_UNRETURNED}</Muted>
          <Muted>WorkspaceInstance：{FIELD_UNRETURNED}</Muted>
          <Muted>编排模式：{props.run.orchestrationMode ?? FIELD_UNRETURNED}</Muted>
          {canOfferRerun(props.run.status) ? <Button>重跑</Button> : null}
        </Card>
      </Split>
      <Card title="产物">
        {(props.artifacts ?? []).length === 0 ? (
          <Muted>还没有精确版本产物。完成不能看时间线气泡。</Muted>
        ) : (
          <List>
            {(props.artifacts ?? []).map((artifact) => {
              const version = pinnedArtifactVersion(artifact);
              if (version === null) {
                return (
                  <ListRow
                    key={artifact.id}
                    title={artifact.logicalName}
                    meta={`${artifact.kind} · 无版本，不能打开 latest`}
                  />
                );
              }
              return (
                <ListRow
                  key={artifact.id}
                  title={artifact.logicalName}
                  meta={`${artifact.kind} · ${version.id}`}
                  onClick={
                    props.onOpenArtifact
                      ? () => {
                          props.onOpenArtifact?.(artifact.id, version.id);
                        }
                      : undefined
                  }
                />
              );
            })}
          </List>
        )}
      </Card>
      <Card title="判定">
        <EmptyState title={EVALUATION_PENDING}>{EVALUATION_UNAVAILABLE}</EmptyState>
      </Card>
      <Card title="审批">
        {(props.approvals ?? []).length === 0 ? (
          <Muted>没有绑定这条 Run 的审批。</Muted>
        ) : (
          <List>
            {(props.approvals ?? []).map((approval) => (
              <ListRow
                key={approval.id}
                title={approval.gate}
                meta={approval.status}
                onClick={
                  props.onOpenApproval
                    ? () => {
                        props.onOpenApproval?.(approval.id);
                      }
                    : undefined
                }
              />
            ))}
          </List>
        )}
      </Card>
      {showInput ? (
        <Card testId="run-input">
          <label className="wf-label" htmlFor="run-input-text">
            运行输入
          </label>
          <Textarea
            id="run-input-text"
            value={props.inputText ?? ""}
            rows={3}
            onChange={(event) => props.onInputText?.(event.target.value)}
          />
          <Button
            variant="primary"
            disabled={props.busy === true}
            onClick={props.onInput}
            testId="run-input-send"
          >
            发送输入
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function TimelineList(props: { rows: TimelineRow[] }): ReactNode {
  if (props.rows.length === 0) {
    return <Muted>暂无事件。</Muted>;
  }
  return (
    <ol className="wf-timeline">
      {props.rows.map((row) => (
        <li
          key={row.key}
          data-testid="timeline-row"
          data-event-key={row.key}
          className="wf-timeline-row"
        >
          <Muted>{row.time}</Muted>
          <pre className="wf-mono">{row.summary}</pre>
        </li>
      ))}
    </ol>
  );
}

async function listOrEmpty<T>(load: () => Promise<{ items: T[] }>): Promise<T[]> {
  try {
    return (await load()).items;
  } catch {
    return [];
  }
}
