import { useEffect, useState } from "react";
import type { PageDto } from "@workforce/desktop-client";

import type { FeaturePageProps } from "../contract.js";
import { asCatalogClient, hasCatalogMethod, useWorkforceClient } from "../hooks.js";
import {
  badgeStyle,
  buttonStyle,
  cardStyle,
  listItemStyle,
  listStyle,
  mutedStyle,
  pageStyle,
  titleStyle,
} from "../projects/ui.js";
import {
  asTeamView,
  PRESET_TEAM,
  rejectCustomTeamSave,
  teamById,
  teamPageModel,
  type TeamView,
} from "./model.js";

export function TeamsPage(props: FeaturePageProps) {
  const client = useWorkforceClient();
  const [teams, setTeams] = useState<TeamView[]>([PRESET_TEAM]);
  const [note, setNote] = useState<string | null>(teamPageModel().note);
  const [source, setSource] = useState<"preset" | "live">("preset");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const catalog = asCatalogClient(client);
      if (!hasCatalogMethod(catalog, "listTeams")) {
        return;
      }
      try {
        const page: PageDto<unknown> = await catalog.listTeams();
        const parsed = page.items.map(asTeamView).filter((item): item is TeamView => item !== null);
        if (!cancelled && parsed.length > 0) {
          const model = teamPageModel({ liveTeams: parsed });
          setTeams(model.teams);
          setNote(model.note);
          setSource(model.source);
        }
      } catch {
        if (!cancelled) {
          const model = teamPageModel();
          setTeams(model.teams);
          setNote(model.note);
          setSource(model.source);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const teamId = props.params.teamId;
  if (teamId) {
    const team = teamById(teams, teamId) ?? (teamId === PRESET_TEAM.id ? PRESET_TEAM : null);
    return (
      <main style={pageStyle}>
        <p>
          <button
            type="button"
            style={buttonStyle("secondary")}
            onClick={() => props.navigate("/teams")}
          >
            返回 AI 团队
          </button>
        </p>
        {team ? <TeamCard team={team} note={note} source={source} /> : <p>未找到该团队。</p>}
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={titleStyle}>AI 团队</h1>
      {note ? <p style={mutedStyle}>{note}</p> : null}
      <p style={mutedStyle}>只读预设，不提供创建或保存自定义团队。</p>
      <section style={cardStyle}>
        <ul style={listStyle}>
          {teams.map((team) => (
            <li
              key={team.id}
              style={listItemStyle}
              onClick={() => props.navigate(`/teams/${team.id}`)}
            >
              <strong>{team.name}</strong>
              <div style={mutedStyle}>
                {team.workers.map((worker) => worker.role).join(" / ")} · {team.runtime.label}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function TeamCard(props: { team: TeamView; note: string | null; source: "preset" | "live" }) {
  const save = rejectCustomTeamSave();
  return (
    <section style={cardStyle}>
      <h1 style={titleStyle}>{props.team.name}</h1>
      <div style={{ marginBottom: "var(--wf-space-md, 12px)" }}>
        <span style={badgeStyle("muted")}>只读</span>
      </div>
      <p style={mutedStyle}>
        版本 {props.team.version} · 运行时 {props.team.runtime.label} · 来源{" "}
        {props.source === "live" ? "GET /teams" : "预设副本"}
      </p>
      {props.note ? <p style={mutedStyle}>{props.note}</p> : null}
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>Workers</h2>
      <ul style={listStyle}>
        {props.team.workers.map((worker) => (
          <li key={worker.id} style={{ ...listItemStyle, cursor: "default" }}>
            <strong>{worker.title}</strong>
            <div style={mutedStyle}>
              角色 {worker.role} · Runtime {worker.runtime}
            </div>
          </li>
        ))}
      </ul>
      <p style={mutedStyle}>{save.reason}</p>
    </section>
  );
}
