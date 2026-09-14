import type { ApprovalDto } from "@workforce/desktop-client";
import { useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  List,
  ListRow,
  LoadingText,
  Muted,
  Page,
  Textarea,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { commandOptions, formatClientError, useClientQuery } from "../../app/client-query.js";
import { getWorkforceClient } from "../../app/renderer-client.js";
import {
  findWorkerRefByVersionId,
  identityPreviewLine,
  roleLibraryDetailHref,
} from "../role-library/model.js";
import {
  approvalDigest,
  approvalExpiry,
  approvalExtraRefs,
  approvalStatusLabel,
  canApproveApproval,
  canDecideApproval,
  decisionPayload,
  EVALUATION_PENDING,
  EVALUATION_UNAVAILABLE,
  FIELD_UNRETURNED,
  gateLabel,
} from "./model.js";

export function ApprovalsPage(props: FeaturePageProps): ReactNode {
  const approvalId = props.params.approvalId;
  if (approvalId !== undefined && approvalId.length > 0) {
    return <ApprovalDetailPage {...props} approvalId={approvalId} />;
  }
  return <ApprovalListPage {...props} />;
}

function ApprovalListPage(props: FeaturePageProps): ReactNode {
  const query = useClientQuery("approvals:list", async () => {
    const page = await getWorkforceClient().listApprovals({ limit: 50 });
    return page.items;
  });
  return (
    <Page title="审批中心" subtitle="计划与产物门禁。批准必须绑定当前 digest 与版本。">
      <ErrorText>{query.error}</ErrorText>
      {query.loading && query.data === null ? <LoadingText /> : null}
      <ApprovalListView
        approvals={query.data ?? []}
        onOpen={(id) => {
          props.navigate(`/approvals/${id}`);
        }}
      />
    </Page>
  );
}

export function ApprovalListView(props: {
  approvals: ApprovalDto[];
  onOpen: (id: string) => void;
}): ReactNode {
  if (props.approvals.length === 0) {
    return (
      <Card>
        <EmptyState title="暂无审批">没有跨项目待办。工作台也会链到这里。</EmptyState>
      </Card>
    );
  }
  return (
    <Card>
      <List testId="approval-list">
        {props.approvals.map((approval) => (
          <ListRow
            key={approval.id}
            testId={`approval-row-${approval.id}`}
            title={gateLabel(approval.gate)}
            meta={`${approvalStatusLabel(approval.status)} · 项目 ${approval.projectId}`}
            onClick={() => {
              props.onOpen(approval.id);
            }}
          />
        ))}
      </List>
    </Card>
  );
}

function ApprovalDetailPage(props: FeaturePageProps & { approvalId: string }): ReactNode {
  const query = useClientQuery(`approvals:${props.approvalId}`, async () => {
    const client = getWorkforceClient();
    const approval = await client.getApproval(props.approvalId);
    let artifactHref: string | undefined;
    if (approval.artifactVersionId) {
      try {
        const page = await client.listArtifacts({ projectId: approval.projectId, limit: 50 });
        const match = page.items.find((artifact) =>
          artifact.versions.some((version) => version.id === approval.artifactVersionId),
        );
        if (match) {
          artifactHref = `/artifacts/${match.id}/versions/${approval.artifactVersionId}`;
        }
      } catch {
        artifactHref = undefined;
      }
    }
    let roleHref: string | undefined;
    let roleMeta: string | undefined;
    const extra = approvalExtraRefs(approval);
    if (extra.workerVersionId) {
      try {
        const page = await client.listWorkers({ limit: 100 });
        const ref = findWorkerRefByVersionId(page.items, extra.workerVersionId);
        if (ref) {
          roleHref = roleLibraryDetailHref(ref.workerId, { versionId: ref.version.id });
          roleMeta = identityPreviewLine(ref.version);
        }
      } catch {
        roleHref = undefined;
        roleMeta = undefined;
      }
    }
    return { approval, artifactHref, roleHref, roleMeta };
  });
  const [reason, setReason] = useState("人工确认");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approval = query.data?.approval;
  const artifactHref = query.data?.artifactHref;
  const roleHref = query.data?.roleHref;
  const roleMeta = query.data?.roleMeta;

  async function decide(kind: "approve" | "reject" | "request-changes"): Promise<void> {
    if (!approval) {
      return;
    }
    const payload = decisionPayload(approval, reason);
    if (payload === null) {
      setActionError("缺少动作摘要，无法提交审批决定。");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const client = getWorkforceClient();
      const options = commandOptions(approval.stateRevision);
      if (kind === "approve") {
        await client.approve(approval.id, payload, options);
      } else if (kind === "reject") {
        await client.reject(approval.id, payload, options);
      } else {
        await client.requestChanges(approval.id, payload, options);
      }
      query.reload();
    } catch (error) {
      setActionError(formatClientError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      title="审批卡"
      subtitle={props.approvalId}
      actions={
        <Button
          variant="outline"
          onClick={() => {
            props.navigate("/approvals");
          }}
        >
          返回列表
        </Button>
      }
    >
      <ErrorText>{query.error}</ErrorText>
      <ErrorText>{actionError}</ErrorText>
      {query.loading && approval === null ? <LoadingText /> : null}
      {approval ? (
        <>
          <ApprovalCard
            approval={approval}
            reason={reason}
            onReason={setReason}
            busy={busy}
            onOpenTask={
              approval.taskId
                ? () => {
                    props.navigate(`/projects/${approval.projectId}/tasks/${approval.taskId}`);
                  }
                : undefined
            }
            onOpenProject={() => {
              props.navigate(`/projects/${approval.projectId}`);
            }}
            onOpenArtifact={
              artifactHref
                ? () => {
                    props.navigate(artifactHref);
                  }
                : undefined
            }
            onOpenRole={
              roleHref
                ? () => {
                    props.navigate(roleHref);
                  }
                : undefined
            }
            roleMeta={roleMeta}
            onApprove={() => {
              void decide("approve");
            }}
            onReject={() => {
              void decide("reject");
            }}
            onRequestChanges={() => {
              void decide("request-changes");
            }}
          />
          <Card title="判定" testId="approval-evaluation">
            <EmptyState title={EVALUATION_PENDING}>{EVALUATION_UNAVAILABLE}</EmptyState>
          </Card>
        </>
      ) : null}
    </Page>
  );
}

export interface ApprovalCardProps {
  approval: ApprovalDto;
  reason?: string | undefined;
  busy?: boolean | undefined;
  onReason?: ((value: string) => void) | undefined;
  onOpenTask?: (() => void) | undefined;
  onOpenProject?: (() => void) | undefined;
  onOpenArtifact?: (() => void) | undefined;
  onOpenRole?: (() => void) | undefined;
  roleMeta?: string | undefined;
  onApprove?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
  onRequestChanges?: (() => void) | undefined;
}

export function ApprovalCard(props: ApprovalCardProps): ReactNode {
  const digest = approvalDigest(props.approval);
  const extra = approvalExtraRefs(props.approval);
  const approveEnabled = canApproveApproval(props.approval) && props.busy !== true;
  const decideEnabled = canDecideApproval(props.approval) && props.busy !== true && digest !== null;
  const showActions = props.onApprove !== undefined;

  return (
    <Card testId={`approval-card-${props.approval.id}`}>
      <div className="wf-cluster">
        <strong>{gateLabel(props.approval.gate)}</strong>
        <Badge tone="muted" testId="approval-status">
          {approvalStatusLabel(props.approval.status)}
        </Badge>
      </div>
      {props.onOpenProject ? (
        <Button variant="ghost" onClick={props.onOpenProject}>
          项目 {props.approval.projectId}
        </Button>
      ) : (
        <Muted>项目 {props.approval.projectId}</Muted>
      )}
      {props.approval.taskId !== undefined ? (
        props.onOpenTask ? (
          <Button variant="ghost" onClick={props.onOpenTask}>
            Task {props.approval.taskId}
          </Button>
        ) : (
          <Muted>Task {props.approval.taskId}</Muted>
        )
      ) : (
        <Muted>Task {FIELD_UNRETURNED}</Muted>
      )}
      <dl className="wf-detail-grid">
        <dt>资源</dt>
        <dd data-testid="approval-resource">{props.approval.resource}</dd>
        <dt>版本</dt>
        <dd data-testid="approval-version">
          {props.approval.artifactVersionId ? (
            props.onOpenArtifact ? (
              <Button variant="ghost" onClick={props.onOpenArtifact}>
                {props.approval.artifactVersionId}
              </Button>
            ) : (
              props.approval.artifactVersionId
            )
          ) : (
            "未绑定产物版本"
          )}
        </dd>
        <dt>摘要</dt>
        <dd data-testid="approval-digest">{digest ?? "缺失"}</dd>
        <dt>到期</dt>
        <dd data-testid="approval-expiry">{approvalExpiry(props.approval)}</dd>
        <dt>请求时间</dt>
        <dd>{props.approval.requestedAt}</dd>
        <dt>WorkerVersion</dt>
        <dd>
          {extra.workerVersionId ? (
            props.onOpenRole ? (
              <Button variant="ghost" testId="approval-open-role" onClick={props.onOpenRole}>
                {extra.workerVersionId}
                {props.roleMeta ? ` · ${props.roleMeta}` : ""}
              </Button>
            ) : (
              extra.workerVersionId
            )
          ) : (
            FIELD_UNRETURNED
          )}
        </dd>
        <dt>Run</dt>
        <dd>{extra.runId ?? FIELD_UNRETURNED}</dd>
        <dt>节点</dt>
        <dd>{extra.nodeId ?? FIELD_UNRETURNED}</dd>
        <dt>Workspace</dt>
        <dd>{extra.workspaceInstanceId ?? FIELD_UNRETURNED}</dd>
        <dt>影响级别</dt>
        <dd>{extra.impact ?? FIELD_UNRETURNED}</dd>
      </dl>
      {digest === null ? (
        <p className="wf-error-text" data-testid="approval-digest-missing">
          缺少动作摘要，无法批准。版本变更后必须使用审批 DTO 上的当前 digest。
        </p>
      ) : null}
      {showActions ? (
        <div className="wf-cluster wf-mt-12">
          {props.onApprove || props.onReject || props.onRequestChanges ? (
            <>
              <Textarea
                value={props.reason ?? ""}
                onChange={(event) => props.onReason?.(event.target.value)}
                rows={2}
                aria-label="决定原因"
              />
              <Button testId="approval-reject" disabled={!decideEnabled} onClick={props.onReject}>
                拒绝
              </Button>
              <Button
                testId="approval-request-changes"
                disabled={!decideEnabled}
                onClick={props.onRequestChanges}
              >
                要求修改
              </Button>
              <Button
                variant="primary"
                testId="approval-approve"
                disabled={!approveEnabled}
                onClick={props.onApprove}
              >
                批准
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
