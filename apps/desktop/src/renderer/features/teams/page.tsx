import { useEffect, useState } from "react";
import type { PageDto } from "@workforce/desktop-client";

import { AgentDot, Badge, Button, Card, List, ListRow, Muted, Page } from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { asCatalogClient, hasCatalogMethod, useWorkforceClient } from "../hooks.js";
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
      <Page
        title={team?.name ?? "AI 团队"}
        subtitle={teamId}
        actions={
          <Button
            onClick={() => {
              props.navigate("/teams");
            }}
          >
            返回 AI 团队
          </Button>
        }
      >
        {team ? (
          <TeamCard team={team} note={note} source={source} />
        ) : (
          <Card>
            <Muted>未找到该团队。</Muted>
          </Card>
        )}
      </Page>
    );
  }

  return (
    <Page title="AI 团队" subtitle="只读预设，不提供创建或保存自定义团队。">
      {note ? <Muted>{note}</Muted> : null}
      <Card>
        <List>
          {teams.map((team) => (
            <ListRow
              key={team.id}
              title={
                <span className="wf-cluster">
                  <AgentDot id={team.runtime.adapterId} />
                  {team.name}
                </span>
              }
              meta={`${team.workers.map((worker) => worker.role).join(" / ")} · ${team.runtime.label}`}
              onClick={() => props.navigate(`/teams/${team.id}`)}
            />
          ))}
        </List>
      </Card>
    </Page>
  );
}

function TeamCard(props: { team: TeamView; note: string | null; source: "preset" | "live" }) {
  const save = rejectCustomTeamSave();
  return (
    <Card>
      <div className="wf-cluster">
        <Badge tone="muted">只读</Badge>
        <Muted>
          版本 {props.team.version} · 运行时 {props.team.runtime.label} · 来源{" "}
          {props.source === "live" ? "GET /teams" : "预设副本"}
        </Muted>
      </div>
      {props.note ? <Muted>{props.note}</Muted> : null}
      <h2 className="wf-section-title">Workers</h2>
      <List>
        {props.team.workers.map((worker) => (
          <ListRow
            key={worker.id}
            title={worker.title}
            meta={
              <>
                角色 {worker.role} · Runtime {worker.runtime}
              </>
            }
          />
        ))}
      </List>
      <Muted>{save.reason}</Muted>
    </Card>
  );
}
