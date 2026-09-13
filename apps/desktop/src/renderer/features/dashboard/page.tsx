import type { ApprovalDto, ProjectDto, RunDto } from "@workforce/desktop-client";
import type { ReactNode } from "react";

import {
  Button,
  Card,
  ErrorText,
  Kpi,
  List,
  ListRow,
  LoadingText,
  MetricGrid,
  Muted,
  Page,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useClientQuery } from "../../app/client-query.js";
import { getWorkforceClient } from "../../app/renderer-client.js";
import { gateLabel } from "../approvals/model.js";
import { LOCAL_NODE_ID, localNodeSubtitle } from "../nodes/model.js";
import { formatRunUsage, runStatusLabel } from "../runs/model.js";
import {
  activeProjects,
  activeRuns,
  failedRuns,
  pendingApprovals,
  projectStatusLabel,
  unreadyProjects,
} from "./model.js";

export function DashboardPage(props: FeaturePageProps): ReactNode {
  const query = useClientQuery("dashboard", async () => {
    const client = getWorkforceClient();
    const [approvals, runs, projects] = await Promise.all([
      client.listApprovals({ limit: 20, status: "pending" }),
      client.listRuns({ limit: 50 }),
      client.listProjects({ limit: 50 }),
    ]);
    return {
      approvals: pendingApprovals(approvals.items),
      runs: activeRuns(runs.items),
      failed: failedRuns(runs.items),
      projects: activeProjects(projects.items),
      unready: unreadyProjects(projects.items),
    };
  });
  return (
    <Page
      title="工作台"
      subtitle="下一步行动：待审批、失败 Run、未配齐项目。不是图表仪表盘。"
      actions={
        <Button
          variant="primary"
          testId="dashboard-new-project"
          onClick={() => {
            props.navigate("/projects");
          }}
        >
          新建项目
        </Button>
      }
    >
      <ErrorText>{query.error}</ErrorText>
      {query.loading && query.data === null ? <LoadingText /> : null}
      <DashboardView
        approvals={query.data?.approvals ?? []}
        runs={query.data?.runs ?? []}
        failed={query.data?.failed ?? []}
        projects={query.data?.projects ?? []}
        unready={query.data?.unready ?? []}
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
    </Page>
  );
}

export function DashboardView(props: {
  approvals: ApprovalDto[];
  runs: RunDto[];
  failed?: RunDto[] | undefined;
  projects: ProjectDto[];
  unready?: ProjectDto[] | undefined;
  onApproval: (id: string) => void;
  onRun: (id: string) => void;
  onProject: (id: string) => void;
  onNodes: () => void;
}): ReactNode {
  const failed = props.failed ?? [];
  const unready = props.unready ?? [];
  return (
    <div className="wf-stack">
      <MetricGrid>
        <Kpi label="待审批" value={String(props.approvals.length)} testId="dash-pending" />
        <Kpi label="运行中" value={String(props.runs.length)} testId="dash-runs" />
        <Kpi label="活跃项目" value={String(props.projects.length)} testId="dash-projects" />
      </MetricGrid>

      <Card title="需要处理" testId="dash-approvals">
        {props.approvals.length === 0 ? (
          <Muted>没有待审批事项。</Muted>
        ) : (
          <List>
            {props.approvals.map((approval) => (
              <ListRow
                key={approval.id}
                title={gateLabel(approval.gate)}
                meta={approval.resource}
                onClick={() => {
                  props.onApproval(approval.id);
                }}
              />
            ))}
          </List>
        )}
      </Card>

      <div className="wf-split">
        <Card title="运行中" testId="dash-active-runs">
          {props.runs.length === 0 ? (
            <Muted>没有活动 Run。</Muted>
          ) : (
            <List>
              {props.runs.map((run) => (
                <ListRow
                  key={run.id}
                  title={run.id}
                  meta={`${runStatusLabel(run)} · ${formatRunUsage(run.usage)}`}
                  onClick={() => {
                    props.onRun(run.id);
                  }}
                />
              ))}
            </List>
          )}
        </Card>
        <Card title="失败 Run" testId="dash-failed-runs">
          {failed.length === 0 ? (
            <Muted>没有失败或超时的 Run。</Muted>
          ) : (
            <List>
              {failed.map((run) => (
                <ListRow
                  key={run.id}
                  title={run.id}
                  meta={`${runStatusLabel(run)} · Task ${run.taskId}`}
                  onClick={() => {
                    props.onRun(run.id);
                  }}
                />
              ))}
            </List>
          )}
        </Card>
      </div>

      <div className="wf-split">
        <Card title="未配齐" testId="dash-unready-projects">
          {unready.length === 0 ? (
            <Muted>没有草稿或规划中的项目。</Muted>
          ) : (
            <List>
              {unready.map((project) => (
                <ListRow
                  key={project.id}
                  title={project.name}
                  meta={`${projectStatusLabel(project.status)} · 去项目详情配齐 Team / Workspace`}
                  onClick={() => {
                    props.onProject(project.id);
                  }}
                />
              ))}
            </List>
          )}
        </Card>
        <Card title="活跃项目" testId="dash-active-projects">
          {props.projects.length === 0 ? (
            <Muted>没有活跃项目。</Muted>
          ) : (
            <List>
              {props.projects.map((project) => (
                <ListRow
                  key={project.id}
                  title={project.name}
                  meta={projectStatusLabel(project.status)}
                  onClick={() => {
                    props.onProject(project.id);
                  }}
                />
              ))}
            </List>
          )}
        </Card>
      </div>

      <Card title="执行节点" testId="dash-local-node">
        <List>
          <ListRow title="本机 / Mock" meta={localNodeSubtitle()} onClick={props.onNodes} />
        </List>
      </Card>
    </div>
  );
}
