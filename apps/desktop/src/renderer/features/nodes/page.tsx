import type { HealthDto, ReadyDto, VersionDto } from "@workforce/desktop-client";
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
import {
  formatProbeSummary,
  isLocalNodeId,
  LOCAL_NODE_ID,
  localNodeStatusLabel,
  localNodeSubtitle,
} from "./model.js";

export function NodesPage(props: FeaturePageProps): ReactNode {
  const nodeId = props.params.nodeId;
  if (nodeId !== undefined && nodeId.length > 0 && !isLocalNodeId(nodeId)) {
    return (
      <T13Page
        title="节点详情"
        subtitle={nodeId}
        actions={
          <T13Button
            onClick={() => {
              props.navigate("/nodes");
            }}
          >
            返回本机节点
          </T13Button>
        }
      >
        <RemoteNodePlaceholder nodeId={nodeId} />
      </T13Page>
    );
  }
  return <LocalNodePage {...props} nodeId={nodeId ?? LOCAL_NODE_ID} />;
}

function LocalNodePage(props: FeaturePageProps & { nodeId: string }): ReactNode {
  const query = useT13Query("nodes:local", async () => {
    const client = getT13Client();
    const [health, ready, version] = await Promise.all([
      client.getHealth(),
      client.getReady(),
      client.getVersion(),
    ]);
    return { health, ready, version };
  });
  const detail = props.path.includes("/nodes/");
  return (
    <T13Page
      title={detail ? "节点详情" : "执行节点"}
      subtitle={detail ? props.nodeId : "V0.1 仅本机节点。远程 enrollment 未接入。"}
    >
      <T13Error message={query.error} />
      {query.loading && query.data === null ? <p style={t13Styles.muted}>加载中…</p> : null}
      <LocalNodeCard
        nodeId={LOCAL_NODE_ID}
        health={query.data?.health ?? null}
        ready={query.data?.ready ?? null}
        version={query.data?.version ?? null}
        detail={detail}
        onOpen={
          detail
            ? undefined
            : () => {
                props.navigate(`/nodes/${LOCAL_NODE_ID}`);
              }
        }
      />
    </T13Page>
  );
}

export function LocalNodeCard(props: {
  nodeId: string;
  health: HealthDto | null;
  ready: ReadyDto | null;
  version: VersionDto | null;
  detail?: boolean | undefined;
  onOpen?: (() => void) | undefined;
}): ReactNode {
  const status = localNodeStatusLabel({ health: props.health, ready: props.ready });
  const toneStyle =
    status.tone === "health"
      ? t13Styles.health
      : status.tone === "warning"
        ? t13Styles.warning
        : t13Styles.muted;
  return (
    <T13Card testId="local-node-card">
      <div style={t13Styles.header}>
        <div>
          <strong>本机 / Mock</strong>
          <p style={toneStyle} data-testid="local-node-status">
            {status.label}
          </p>
        </div>
        {props.onOpen ? <T13Button onClick={props.onOpen}>查看详情</T13Button> : null}
      </div>
      <p style={t13Styles.muted} data-testid="local-node-probe">
        {localNodeSubtitle()}
      </p>
      <ul>
        {formatProbeSummary({
          health: props.health,
          ready: props.ready,
          version: props.version,
        }).map((line) => (
          <li key={line} style={t13Styles.muted}>
            {line}
          </li>
        ))}
      </ul>
      {props.detail === true ? (
        <p style={t13Styles.muted}>
          listNodes / listRuntimes 尚未出现在 typed client 中时，不把本机卡片渲染成远程在线机群。
        </p>
      ) : null}
    </T13Card>
  );
}

export function RemoteNodePlaceholder(props: { nodeId: string }): ReactNode {
  return (
    <T13Card testId="remote-node-placeholder">
      <strong>远程节点（未接入）</strong>
      <p data-testid="remote-node-status" style={t13Styles.muted}>
        离线占位 · {props.nodeId}
      </p>
      <p style={t13Styles.muted}>不是在线机群。V0.1 不把远程占位显示为可用节点。</p>
    </T13Card>
  );
}
