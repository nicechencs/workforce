import type { CapabilitiesDto, HealthDto, ReadyDto, VersionDto } from "@workforce/desktop-client";
import {
  ACCENT_IDS,
  ACCENT_PALETTES,
  CANVAS_IDS,
  CANVAS_PALETTES,
  type AccentId,
  type CanvasId,
  type ThemeMode,
} from "@workforce/ui";
import type { ReactNode } from "react";

import { useTheme } from "../../app/theme.js";
import {
  Card,
  ChipGroup,
  ErrorText,
  LoadingText,
  Muted,
  Page,
  SegmentedControl,
  StatusText,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useClientQuery } from "../../app/client-query.js";
import { getWorkforceClient } from "../../app/renderer-client.js";
import { BUDGET_NOTES, capabilityRows } from "./model.js";

const THEME_MODE_ITEMS: readonly { id: ThemeMode; label: string }[] = [
  { id: "light", label: "浅色" },
  { id: "dark", label: "深色" },
  { id: "system", label: "跟随系统" },
];

const ACCENT_LABELS: Record<AccentId, string> = {
  indigo: "靛蓝",
  blue: "蓝",
  teal: "青",
  rose: "玫红",
  amber: "橙",
};

const CANVAS_LABELS: Record<CanvasId, string> = {
  gray: "灰",
  white: "白",
  paper: "纸",
  mist: "雾",
  sky: "天蓝",
  mint: "薄荷",
  sand: "沙",
  lilac: "淡紫",
};

export function SettingsPage(props: FeaturePageProps): ReactNode {
  void props;
  const query = useClientQuery("settings:probe", async () => {
    const client = getWorkforceClient();
    const [health, ready, version, capabilities] = await Promise.all([
      client.getHealth(),
      client.getReady(),
      client.getVersion(),
      client.getCapabilities(),
    ]);
    return { health, ready, version, capabilities };
  });
  return (
    <Page title="设置" subtitle="本机 Runtime 探测、能力矩阵、预算说明与界面外观。">
      <ErrorText>{query.error}</ErrorText>
      {query.loading && query.data === null ? <LoadingText /> : null}
      <AppearanceCard />
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
    </Page>
  );
}

/** 外观只改本地偏好，不写后端。色板真源见 docs/product-ui/04-design-system.md §3。 */
export function AppearanceCard(): ReactNode {
  const theme = useTheme();
  const darkActive = theme.scheme === "dark";
  return (
    <Card title="外观">
      <div className="wf-field">
        <span className="wf-label">主题</span>
        <SegmentedControl
          ariaLabel="主题"
          items={THEME_MODE_ITEMS}
          value={theme.mode}
          onChange={theme.setMode}
        />
      </div>
      <div className="wf-field">
        <span className="wf-label">主题色</span>
        <ChipGroup
          ariaLabel="主题色"
          items={ACCENT_IDS.map((id) => ({
            id,
            label: ACCENT_LABELS[id],
            swatch: ACCENT_PALETTES[id].light,
          }))}
          value={theme.accent}
          onChange={theme.setAccent}
        />
      </div>
      <div className="wf-field">
        <span className="wf-label">页面底色</span>
        <ChipGroup
          ariaLabel="页面底色"
          disabled={darkActive}
          items={CANVAS_IDS.map((id) => ({
            id,
            label: CANVAS_LABELS[id],
            swatch: CANVAS_PALETTES[id].canvas,
          }))}
          value={theme.canvas}
          onChange={theme.setCanvas}
        />
        <Muted>
          {darkActive
            ? "底色只在浅色主题生效，深色主题保持统一画布。"
            : "浅色画布色板；深色主题下不覆盖画布变量。"}
        </Muted>
      </div>
    </Card>
  );
}

export function SettingsView(props: {
  health: HealthDto | null;
  ready: ReadyDto | null;
  version: VersionDto | null;
  capabilities: CapabilitiesDto | null;
}): ReactNode {
  return (
    <>
      <Card title="本机探测" testId="settings-probe">
        {props.health ? (
          <StatusText tone="success">
            Daemon 已连接 · pid {props.health.pid} · {props.health.startIdentity}
          </StatusText>
        ) : (
          <Muted>健康检查结果不可用（未伪造在线状态）。</Muted>
        )}
        {props.version ? (
          <Muted>
            协议 {props.version.protocolVersion} · API {props.version.apiVersion}
          </Muted>
        ) : (
          <Muted>版本探测待返回。</Muted>
        )}
        {props.ready ? (
          <ul className="wf-list">
            {Object.entries(props.ready.checks).map(([name, ok]) => (
              <li key={name} className="wf-list-row">
                <StatusText tone={ok ? "success" : "danger"}>
                  {name}：{ok ? "通过" : "失败"}
                </StatusText>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>就绪检查待返回。</Muted>
        )}
      </Card>
      <Card title="能力" testId="settings-capabilities">
        {props.capabilities ? (
          <ul className="wf-list">
            {capabilityRows(props.capabilities).map((row) => (
              <li key={`${row.group}-${row.name}`} className="wf-list-row">
                <span className="wf-list-row-title">
                  {row.group} / {row.name}：{row.value}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>能力探测待返回。不支持的按钮不会渲染为可成功点击。</Muted>
        )}
      </Card>
      <Card title="预算说明" testId="settings-budget">
        <ul className="wf-list">
          {BUDGET_NOTES.map((note) => (
            <li key={note} className="wf-list-row">
              {note}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
