import type { ApprovalDto } from "@workforce/desktop-client";
import { useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  Card,
  CardList,
  ErrorText,
  LoadingText,
  Muted,
  Page,
  Textarea,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { formatT13Error, getT13Client, t13CommandOptions, useT13Query } from "../_t13_client.js";
import {
  approvalDigest,
  approvalExpiry,
  approvalStatusLabel,
  canApproveApproval,
  canDecideApproval,
  decisionPayload,
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
  const query = useT13Query("approvals:list", async () => {
    const page = await getT13Client().listApprovals({ limit: 50 });
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
        <Muted>暂无审批。</Muted>
      </Card>
    );
  }
  return (
    <CardList>
      {props.approvals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          onOpen={() => {
            props.onOpen(approval.id);
          }}
        />
      ))}
    </CardList>
  );
}

function ApprovalDetailPage(props: FeaturePageProps & { approvalId: string }): ReactNode {
  const query = useT13Query(`approvals:${props.approvalId}`, () =>
    getT13Client().getApproval(props.approvalId),
  );
  const [reason, setReason] = useState("人工确认");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approval = query.data;

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
      const client = getT13Client();
      const options = t13CommandOptions(approval.stateRevision);
      if (kind === "approve") {
        await client.approve(approval.id, payload, options);
      } else if (kind === "reject") {
        await client.reject(approval.id, payload, options);
      } else {
        await client.requestChanges(approval.id, payload, options);
      }
      query.reload();
    } catch (error) {
      setActionError(formatT13Error(error));
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
        <ApprovalCard
          approval={approval}
          reason={reason}
          onReason={setReason}
          busy={busy}
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
      ) : null}
    </Page>
  );
}

export interface ApprovalCardProps {
  approval: ApprovalDto;
  reason?: string | undefined;
  busy?: boolean | undefined;
  onReason?: ((value: string) => void) | undefined;
  onOpen?: (() => void) | undefined;
  onApprove?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
  onRequestChanges?: (() => void) | undefined;
}

export function ApprovalCard(props: ApprovalCardProps): ReactNode {
  const digest = approvalDigest(props.approval);
  const approveEnabled = canApproveApproval(props.approval) && props.busy !== true;
  const decideEnabled = canDecideApproval(props.approval) && props.busy !== true && digest !== null;
  const showActions = props.onApprove !== undefined || props.onOpen !== undefined;

  return (
    <Card testId={`approval-card-${props.approval.id}`}>
      <div className="wf-cluster">
        <strong>{gateLabel(props.approval.gate)}</strong>
        <Badge tone="muted" testId="approval-status">
          {approvalStatusLabel(props.approval.status)}
        </Badge>
      </div>
      <Muted>项目 {props.approval.projectId}</Muted>
      {props.approval.taskId !== undefined ? <Muted>Task {props.approval.taskId}</Muted> : null}
      <dl className="wf-detail-grid">
        <dt>资源</dt>
        <dd data-testid="approval-resource">{props.approval.resource}</dd>
        <dt>版本</dt>
        <dd data-testid="approval-version">
          {props.approval.artifactVersionId ?? "未绑定产物版本"}
        </dd>
        <dt>摘要</dt>
        <dd data-testid="approval-digest">{digest ?? "缺失"}</dd>
        <dt>到期</dt>
        <dd data-testid="approval-expiry">{approvalExpiry(props.approval)}</dd>
        <dt>请求时间</dt>
        <dd>{props.approval.requestedAt}</dd>
      </dl>
      {digest === null ? (
        <p className="wf-error-text" data-testid="approval-digest-missing">
          缺少动作摘要，无法批准。版本变更后必须使用审批 DTO 上的当前 digest。
        </p>
      ) : null}
      {showActions ? (
        <div className="wf-cluster wf-mt-12">
          {props.onOpen ? <Button onClick={props.onOpen}>打开审批卡</Button> : null}
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
