import type { HealthDto, ReadyDto, VersionDto } from "@workforce/desktop-client";
import type { ReactNode } from "react";

import {
  Button,
  Card,
  ErrorText,
  List,
  ListRow,
  LoadingText,
  Muted,
  Page,
  StatusText,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useClientQuery } from "../../app/client-query.js";
import { getWorkforceClient } from "../../app/renderer-client.js";
import {
  LOCAL_HOST_TITLE,
  probeHostRuntime,
  type HostRuntimeView,
} from "../runtime/model.js";
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
      <Page
        title="节点详情"
        subtitle={nodeId}
        actions={
          <Button variant="outline" onClick={() => props.navigate("/nodes")}>
            返回本机节点
          </Button>
        }
      >
        <RemoteNodePlaceholder nodeId={nodeId} />
      </Page>
    );
  }
  return <LocalNodePage {...props} nodeId={nodeId ?? LOCAL_NODE_ID} />;
}

function LocalNodePage(props: FeaturePageProps & { nodeId: string }): ReactNode {
  const query = useClientQuery("nodes:local", async () => {
    const client = getWorkforceClient();
    const [health, ready, version, runtime] = await Promise.all([
      client.getHealth(),
      client.getReady(),
      client.getVersion(),
      probeHostRuntime(client),
    ]);
    return { health, ready, version, runtime };
  });
  const detail = props.path.includes("/nodes/");
  const runtime = query.data?.runtime ?? null;
  const status = localNodeStatusLabel({
    health: query.data?.health ?? null,
    ready: query.data?.ready ?? null,
  });
  return (
    <Page
      title={detail ? "节点详情" : "执行节点"}
      subtitle={detail ? props.nodeId : "V0.1 仅本机节点。远程 enrollment 未接入。当前 Host 是 Codex。"}
      actions={
        detail ? (
          <Button variant="outline" onClick={() => props.navigate("/nodes")}>
            返回本机节点
          </Button>
        ) : undefined
      }
    >
      <ErrorText>{query.error}</ErrorText>
      {query.loading && query.data === null ? <LoadingText /> : null}
      {detail ? (
        <LocalNodeCard
          nodeId={LOCAL_NODE_ID}
          health={query.data?.health ?? null}
          ready={query.data?.ready ?? null}
          version={query.data?.version ?? null}
          runtime={runtime}
          detail
        />
      ) : (
        <Card>
          <List testId="node-list">
            <ListRow
              testId="local-node-row"
              title={LOCAL_HOST_TITLE}
              meta={`${status.label} · ${localNodeSubtitle(runtime)}`}
              onClick={() => {
                props.navigate(`/nodes/${LOCAL_NODE_ID}`);
              }}
            />
          </List>
        </Card>
      )}
    </Page>
  );
}

export function LocalNodeCard(props: {
  nodeId: string;
  health: HealthDto | null;
  ready: ReadyDto | null;
  version: VersionDto | null;
  runtime?: HostRuntimeView | null | undefined;
  detail?: boolean | undefined;
  onOpen?: (() => void) | undefined;
}): ReactNode {
  const status = localNodeStatusLabel({ health: props.health, ready: props.ready });
  const tone =
    status.tone === "health" ? "success" : status.tone === "warning" ? "warning" : "muted";
  return (
    <Card testId="local-node-card">
      <div className="wf-card-header wf-card-header-flush">
        <div>
          <p className="wf-list-row-title">{LOCAL_HOST_TITLE}</p>
          <span data-testid="local-node-status">
            <StatusText tone={tone}>{status.label}</StatusText>
          </span>
        </div>
        {props.onOpen ? (
          <Button
            variant="outline"
            onClick={props.onOpen}
          >
            查看详情
          </Button>
        ) : null}
      </div>
      <Muted>
        <span data-testid="local-node-probe">{localNodeSubtitle(props.runtime)}</span>
      </Muted>
      <ul className="wf-list">
        {formatProbeSummary({
          health: props.health,
          ready: props.ready,
          version: props.version,
          runtime: props.runtime ?? null,
        }).map((line) => (
          <li key={line} className="wf-list-row">
            <span className="wf-list-row-meta">{line}</span>
          </li>
        ))}
      </ul>
      {props.detail === true ? (
        <Muted>
          V0.1 仅本机节点。远程 enrollment 未接入。当前 Host 是 Codex；缺 CLI 或未登录时启动会失败。
        </Muted>
      ) : null}
    </Card>
  );
}

export function RemoteNodePlaceholder(props: { nodeId: string }): ReactNode {
  return (
    <Card testId="remote-node-placeholder">
      <p className="wf-list-row-title">远程节点（未接入）</p>
      <Muted>
        <span data-testid="remote-node-status">离线占位 · {props.nodeId}</span>
      </Muted>
      <Muted>不是在线机群。V0.1 不把远程占位显示为可用节点。</Muted>
    </Card>
  );
}
