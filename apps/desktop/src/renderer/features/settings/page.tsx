import type { CapabilitiesDto, HealthDto, ReadyDto, VersionDto } from "@workforce/desktop-client";
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
import { BUDGET_NOTES, capabilityRows } from "./model.js";

export function SettingsPage(props: FeaturePageProps): ReactNode {
  void props;
  const query = useT13Query("settings:probe", async () => {
    const client = getT13Client();
    const [health, ready, version, capabilities] = await Promise.all([
      client.getHealth(),
      client.getReady(),
      client.getVersion(),
      client.getCapabilities(),
    ]);
    return { health, ready, version, capabilities };
  });
  return (
    <T13Page title="设置" subtitle="本机 Runtime 探测、能力矩阵与预算说明。">
      <T13Error message={query.error} />
      {query.loading && query.data === null ? <p style={t13Styles.muted}>加载中…</p> : null}
      {query.data ? (
        <SettingsView
          health={query.data.health}
          ready={query.data.ready}
          version={query.data.version}
          capabilities={query.data.capabilities}
        />
      ) : (
        <SettingsView health={null} ready={null} version={null} capabilities={null} />
      )}
    </T13Page>
  );
}

export function SettingsView(props: {
  health: HealthDto | null;
  ready: ReadyDto | null;
  version: VersionDto | null;
  capabilities: CapabilitiesDto | null;
}): ReactNode {
  return (
    <div>
      <T13Card testId="settings-probe">
        <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>本机探测</h2>
        {props.health ? (
          <p style={t13Styles.health}>
            Daemon 已连接 · pid {props.health.pid} · {props.health.startIdentity}
          </p>
        ) : (
          <p style={t13Styles.muted}>健康检查结果不可用（未伪造在线状态）。</p>
        )}
        {props.version ? (
          <p style={t13Styles.muted}>
            协议 {props.version.protocolVersion} · API {props.version.apiVersion}
          </p>
        ) : (
          <p style={t13Styles.muted}>版本探测待返回。</p>
        )}
        {props.ready ? (
          <ul>
            {Object.entries(props.ready.checks).map(([name, ok]) => (
              <li key={name} style={ok ? t13Styles.health : t13Styles.warning}>
                {name}：{ok ? "通过" : "失败"}
              </li>
            ))}
          </ul>
        ) : (
          <p style={t13Styles.muted}>就绪检查待返回。</p>
        )}
      </T13Card>
      <T13Card testId="settings-capabilities">
        <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>能力</h2>
        {props.capabilities ? (
          <ul>
            {capabilityRows(props.capabilities).map((row) => (
              <li key={`${row.group}-${row.name}`}>
                {row.group} / {row.name}：{row.value}
              </li>
            ))}
          </ul>
        ) : (
          <p style={t13Styles.muted}>能力探测待返回。不支持的按钮不会渲染为可成功点击。</p>
        )}
      </T13Card>
      <T13Card testId="settings-budget">
        <h2 style={{ ...t13Styles.title, fontSize: "var(--wf-font-body)" }}>预算说明</h2>
        <ul>
          {BUDGET_NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </T13Card>
    </div>
  );
}
