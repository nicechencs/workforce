import type { ApprovalDto } from "@workforce/desktop-client";
import { useState, type ReactNode } from "react";

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
    <T13Page title="审批中心" subtitle="计划与产物门禁。批准必须绑定当前 digest 与版本。">
      <T13Error message={query.error} />
      {query.loading && query.data === null ? <p style={t13Styles.muted}>加载中…</p> : null}
      <ApprovalListView
        approvals={query.data ?? []}
        onOpen={(id) => {
          props.navigate(`/approvals/${id}`);
        }}
      />
    </T13Page>
  );
}

export function ApprovalListView(props: {
  approvals: ApprovalDto[];
  onOpen: (id: string) => void;
}): ReactNode {
  if (props.approvals.length === 0) {
    return (
      <T13Card>
        <p style={t13Styles.muted}>暂无审批。</p>
      </T13Card>
    );
  }
  return (
    <ul style={t13Styles.list}>
      {props.approvals.map((approval) => (
        <li key={approval.id}>
          <ApprovalCard
            approval={approval}
            onOpen={() => {
              props.onOpen(approval.id);
            }}
          />
        </li>
      ))}
    </ul>
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
    <T13Page
      title="审批卡"
      subtitle={props.approvalId}
      actions={
        <T13Button
          onClick={() => {
            props.navigate("/approvals");
          }}
        >
          返回列表
        </T13Button>
      }
    >
      <T13Error message={query.error} />
      <T13Error message={actionError} />
      {query.loading && approval === null ? <p style={t13Styles.muted}>加载中…</p> : null}
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
    </T13Page>
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
    <T13Card testId={`approval-card-${props.approval.id}`}>
      <p>
        <strong>{gateLabel(props.approval.gate)}</strong>
        {" · "}
        <span data-testid="approval-status">{approvalStatusLabel(props.approval.status)}</span>
      </p>
      <p style={t13Styles.muted}>项目 {props.approval.projectId}</p>
      {props.approval.taskId !== undefined ? (
        <p style={t13Styles.muted}>Task {props.approval.taskId}</p>
      ) : null}
      <p data-testid="approval-resource">资源 {props.approval.resource}</p>
      <p data-testid="approval-version">
        版本 {props.approval.artifactVersionId ?? "未绑定产物版本"}
      </p>
      <p data-testid="approval-digest">摘要 {digest ?? "缺失"}</p>
      <p data-testid="approval-expiry">到期 {approvalExpiry(props.approval)}</p>
      <p style={t13Styles.muted}>请求于 {props.approval.requestedAt}</p>
      {digest === null ? (
        <p
          style={{ ...t13Styles.muted, ...t13Styles.danger }}
          data-testid="approval-digest-missing"
        >
          缺少动作摘要，无法批准。版本变更后必须使用审批 DTO 上的当前 digest。
        </p>
      ) : null}
      {showActions ? (
        <div style={{ ...t13Styles.actions, marginTop: "var(--wf-space-md)" }}>
          {props.onOpen ? <T13Button onClick={props.onOpen}>打开审批卡</T13Button> : null}
          {props.onApprove || props.onReject || props.onRequestChanges ? (
            <>
              <textarea
                value={props.reason ?? ""}
                onChange={(event) => props.onReason?.(event.target.value)}
                style={{ ...t13Styles.input, minHeight: "3rem" }}
                aria-label="决定原因"
              />
              <T13Button
                testId="approval-reject"
                disabled={!decideEnabled}
                onClick={props.onReject}
              >
                拒绝
              </T13Button>
              <T13Button
                testId="approval-request-changes"
                disabled={!decideEnabled}
                onClick={props.onRequestChanges}
              >
                要求修改
              </T13Button>
              <T13Button
                kind="primary"
                testId="approval-approve"
                disabled={!approveEnabled}
                onClick={props.onApprove}
              >
                批准
              </T13Button>
            </>
          ) : null}
        </div>
      ) : null}
    </T13Card>
  );
}
