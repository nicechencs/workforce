import type {
  ArtifactDto,
  ArtifactLineageDto,
  ArtifactVersionDto,
} from "@workforce/desktop-client";
import type { ReactNode } from "react";

import { Card, ErrorText, LoadingText, Muted, Page } from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useClientQuery } from "../../app/client-query.js";
import { getWorkforceClient } from "../../app/renderer-client.js";
import {
  artifactVersionHeading,
  decodeArtifactContent,
  isUnversionedArtifactPath,
} from "./model.js";

export function ArtifactsPage(props: FeaturePageProps): ReactNode {
  const artifactId = props.params.artifactId;
  const versionId = props.params.versionId;
  if (artifactId === undefined || versionId === undefined || isUnversionedArtifactPath(versionId)) {
    return (
      <Page title="产物" subtitle="必须打开精确的 ArtifactVersion。">
        <ErrorText>
          产物查看必须指定 artifactId 与 versionId，不能使用 latest 或无版本内容。
        </ErrorText>
      </Page>
    );
  }
  return <ArtifactVersionPage artifactId={artifactId} versionId={versionId} />;
}

function ArtifactVersionPage(props: { artifactId: string; versionId: string }): ReactNode {
  const query = useClientQuery(`artifact:${props.artifactId}:${props.versionId}`, async () => {
    const client = getWorkforceClient();
    const [artifact, version, content, lineage] = await Promise.all([
      client.getArtifact(props.artifactId),
      client.getArtifactVersion(props.artifactId, props.versionId),
      client.getArtifactVersionContent(props.artifactId, props.versionId),
      client.getArtifactVersionLineage(props.artifactId, props.versionId),
    ]);
    return { artifact, version, content, lineage };
  });
  return (
    <Page title="产物" subtitle={`${props.artifactId} / versions / ${props.versionId}`}>
      <ErrorText>{query.error}</ErrorText>
      {query.loading && query.data === null ? <LoadingText /> : null}
      {query.data ? (
        <ArtifactVersionView
          artifact={query.data.artifact}
          version={query.data.version}
          content={query.data.content}
          lineage={query.data.lineage}
        />
      ) : null}
    </Page>
  );
}

export function ArtifactVersionView(props: {
  artifact: ArtifactDto;
  version: ArtifactVersionDto;
  content: unknown;
  lineage: ArtifactLineageDto;
}): ReactNode {
  const decoded = decodeArtifactContent(props.content);
  return (
    <>
      <Card testId="artifact-meta">
        <p className="wf-list-row-title">
          {artifactVersionHeading(props.artifact.id, props.version)}
        </p>
        <p className="wf-body-note">
          {props.artifact.logicalName} · {props.artifact.kind}
        </p>
        <Muted>
          版本 {props.version.id} · hash {props.version.hash} · {props.version.size} 字节 ·{" "}
          {props.version.mediaType}
        </Muted>
        <Muted>固定版本内容，不读取无版本 content。</Muted>
      </Card>
      <Card title="内容" testId="artifact-content">
        <pre className="wf-mono">{decoded.text}</pre>
      </Card>
      <Card title="血缘" testId="artifact-lineage">
        <Muted>父版本</Muted>
        <IdList ids={props.lineage.parents} empty="无父版本" />
        <Muted>子版本</Muted>
        <IdList ids={props.lineage.children} empty="无子版本" />
      </Card>
    </>
  );
}

function IdList(props: { ids: string[]; empty: string }): ReactNode {
  if (props.ids.length === 0) {
    return <Muted>{props.empty}</Muted>;
  }
  return (
    <ul className="wf-list">
      {props.ids.map((id) => (
        <li key={id} className="wf-list-row">
          <span className="wf-mono">{id}</span>
        </li>
      ))}
    </ul>
  );
}
