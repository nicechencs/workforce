import type { ApprovalDto, ProjectDto, RunDto } from "@workforce/desktop-client";
import type { ReactNode } from "react";

import type { FeaturePageProps } from "../contract.js";
import {
  getT13Client,
  T13Button,
  T13Card,
  T13Error,
  T13Page,
  t13Styles,
  useT13Query,
} from "../_t13_client.js";
import { LOCAL_NODE_ID, localNodeSubtitle } from "../nodes/model.js";
import { formatRunUsage, runStatusLabel } from "../runs/model.js";
import { gateLabel } from "../approvals/model.js";
import { activeProjects, activeRuns, pendingApprovals, projectStatusLabel } from "./model.js";

export function DashboardPage(props: FeaturePageProps): ReactNode {
  const query = useT13Query("dashboard", async () => {
    const client = getT13Client();
    const [approvals, runs, projects] = await Promise.all([
      client.listApprovals({ limit: 20, status: "pending" }),
      client.listRuns({ limit: 50 }),
      client.listProjects({ limit: 50 }),
    ]);
    return {
      approvals: pendingApprovals(approvals.items),
      runs: activeRuns(runs.items),
      projects: activeProjects(projects.items),
    };
  });
  return (
    <T13Page
      title="工作台"
      subtitle="待审批、运行中任务和活跃项目。不是图表仪表盘。"
      actions={
        <T13Button
          kind="primary"
          testId="dashboard-new-project"
          onClick={() => {
            props.navigate("/projects");
          }}
        >
          新建项目
        </T13Button>
      }
    >
      <T13Error message={query.error} />
      {query.loading && query.data === null ? <p style={t13Styles.muted}>加载中…</p> : null}
      <DashboardView
        approvals={query.data?.approvals ?? []}
        runs={query.data?.runs ?? []}
        projects={query.data?.projects ?? []}
        onApproval={(id) => {
          props.navigate(`/approvals/${id}`);
        }}
        onRun={(id) => {
          props.navigate(`/runs/${id}`);
        }}
        onProject={(id) => {
          props.navigate(`/projects/${id}`);
        }}
        onNodes={() => {
          props.navigate(`/nodes/${LOCAL_NODE_ID}`);
        }}
      />
    </T13Page>
  );
}

export function DashboardView(props: {
  approvals: ApprovalDto[];
  runs: RunDto[];
  projects: ProjectDto[];
  onApproval: (id: string) => void;
  onRun: (id: string) => void;
  onProject: (id: string) => void;
  onNodes: () => void;
}): ReactNode {
  return (
    <div>
      <div style={{ display: "flex", gap: "var(--wf-space-md)", flexWrap: "wrap" }}>
        <SummaryChip label="待审批" value={String(props.approvals.length)} testId="dash-pending" />
        <SummaryChip label="运行中" value={String(props.runs.length)} testId="dash-runs" />
        <SummaryChip
          label="活跃项目"
          value={String(props.projects.length)}
          testId="dash-projects"
        />
        <T13Card>
          <p style={t13Styles.muted}>执行节点</p>
          <p>本机 / Mock</p>
          <p style={t13Styles.muted}>{localNodeSubtitle()}</p>
          <T13Button onClick={props.onNodes}>查看本机节点</T13Button>
        </T13Card>
      </div>
      <T13Card testId="dash-approvals">
        <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>需要处理</h2>
        {props.approvals.length === 0 ? (
          <p style={t13Styles.muted}>没有待审批事项。</p>
        ) : (
          <ul style={t13Styles.list}>
            {props.approvals.map((approval) => (
              <li key={approval.id} style={{ marginBottom: "var(--wf-space-sm)" }}>
                <strong>{gateLabel(approval.gate)}</strong>
                <span style={t13Styles.muted}> · {approval.resource}</span>{" "}
                <T13Button
                  onClick={() => {
                    props.onApproval(approval.id);
                  }}
                >
                  打开
                </T13Button>
              </li>
            ))}
          </ul>
        )}
      </T13Card>
      <div style={t13Styles.grid}>
        <T13Card testId="dash-active-runs">
          <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>运行中</h2>
          {props.runs.length === 0 ? (
            <p style={t13Styles.muted}>没有活动 Run。</p>
          ) : (
            <ul style={t13Styles.list}>
              {props.runs.map((run) => (
                <li key={run.id} style={{ marginBottom: "var(--wf-space-sm)" }}>
                  <button
                    type="button"
                    onClick={() => {
                      props.onRun(run.id);
                    }}
                    style={{
                      ...t13Styles.button,
                      width: "100%",
                      textAlign: "left",
                    }}
                  >
                    <div>{run.id}</div>
                    <div style={t13Styles.muted}>
                      {runStatusLabel(run)} · {formatRunUsage(run.usage)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </T13Card>
        <T13Card testId="dash-active-projects">
          <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>活跃项目</h2>
          {props.projects.length === 0 ? (
            <p style={t13Styles.muted}>没有活跃项目。</p>
          ) : (
            <ul style={t13Styles.list}>
              {props.projects.map((project) => (
                <li key={project.id} style={{ marginBottom: "var(--wf-space-sm)" }}>
                  <button
                    type="button"
                    onClick={() => {
                      props.onProject(project.id);
                    }}
                    style={{
                      ...t13Styles.button,
                      width: "100%",
                      textAlign: "left",
                    }}
                  >
                    <div>{project.name}</div>
                    <div style={t13Styles.muted}>{projectStatusLabel(project.status)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </T13Card>
      </div>
    </div>
  );
}

function SummaryChip(props: { label: string; value: string; testId: string }): ReactNode {
  return (
    <T13Card testId={props.testId}>
      <p style={t13Styles.muted}>{props.label}</p>
      <p style={{ fontSize: "var(--wf-font-title)", margin: 0 }}>{props.value}</p>
    </T13Card>
  );
}
