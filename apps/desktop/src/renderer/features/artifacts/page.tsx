import type {
  ArtifactDto,
  ArtifactLineageDto,
  ArtifactVersionDto,
} from "@workforce/desktop-client";
import type { ReactNode } from "react";

import type { FeaturePageProps } from "../contract.js";
import {
  getT13Client,
  T13Card,
  T13Error,
  T13Page,
  t13Styles,
  useT13Query,
} from "../_t13_client.js";
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
      <T13Page title="产物" subtitle="必须打开精确的 ArtifactVersion。">
        <T13Error message="产物查看必须指定 artifactId 与 versionId，不能使用 latest 或无版本内容。" />
      </T13Page>
    );
  }
  return <ArtifactVersionPage artifactId={artifactId} versionId={versionId} />;
}

function ArtifactVersionPage(props: { artifactId: string; versionId: string }): ReactNode {
  const query = useT13Query(`artifact:${props.artifactId}:${props.versionId}`, async () => {
    const client = getT13Client();
    const [artifact, version, content, lineage] = await Promise.all([
      client.getArtifact(props.artifactId),
      client.getArtifactVersion(props.artifactId, props.versionId),
      client.getArtifactVersionContent(props.artifactId, props.versionId),
      client.getArtifactVersionLineage(props.artifactId, props.versionId),
    ]);
    return { artifact, version, content, lineage };
  });
  return (
    <T13Page title="产物" subtitle={`${props.artifactId} / versions / ${props.versionId}`}>
      <T13Error message={query.error} />
      {query.loading && query.data === null ? <p style={t13Styles.muted}>加载中…</p> : null}
      {query.data ? (
        <ArtifactVersionView
          artifact={query.data.artifact}
          version={query.data.version}
          content={query.data.content}
          lineage={query.data.lineage}
        />
      ) : null}
    </T13Page>
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
    <div>
      <T13Card testId="artifact-meta">
        <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>
          {artifactVersionHeading(props.artifact.id, props.version)}
        </h2>
        <p>
          {props.artifact.logicalName} · {props.artifact.kind}
        </p>
        <p style={t13Styles.muted}>
          版本 {props.version.id} · hash {props.version.hash} · {props.version.size} 字节 ·{" "}
          {props.version.mediaType}
        </p>
        <p style={t13Styles.muted}>固定版本内容，不读取无版本 content。</p>
      </T13Card>
      <T13Card testId="artifact-content">
        <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>内容</h2>
        <pre style={t13Styles.pre}>{decoded.text}</pre>
      </T13Card>
      <T13Card testId="artifact-lineage">
        <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>血缘</h2>
        <p style={t13Styles.muted}>父版本</p>
        <IdList ids={props.lineage.parents} empty="无父版本" />
        <p style={t13Styles.muted}>子版本</p>
        <IdList ids={props.lineage.children} empty="无子版本" />
      </T13Card>
    </div>
  );
}

function IdList(props: { ids: string[]; empty: string }): ReactNode {
  if (props.ids.length === 0) {
    return <p style={t13Styles.muted}>{props.empty}</p>;
  }
  return (
    <ul>
      {props.ids.map((id) => (
        <li key={id}>{id}</li>
      ))}
    </ul>
  );
}
