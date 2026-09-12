import { useEffect, useMemo, useState } from "react";
import type { DesktopClient } from "@workforce/desktop-client";

import type { FeaturePageProps } from "../contract.js";
import { asCatalogClient, hasCatalogMethod, useWorkforceClient } from "../hooks.js";
import { errorMessage, isRevisionConflict } from "../projects/command.js";
import {
  badgeStyle,
  buttonStyle,
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  listItemStyle,
  listStyle,
  mutedStyle,
  pageStyle,
  titleStyle,
  warningStyle,
} from "../projects/ui.js";
import {
  addDraftMember,
  bindableTeams,
  canBindTeamVersion,
  createTeamButton,
  draftFormFromTeam,
  draftMembersValid,
  emptyTeamDraftForm,
  loadTeamCatalog,
  loadTeamDetail,
  persistTeamDraft,
  PRESET_TEAM,
  PRESET_RUNTIME_ID,
  publishPersistedTeamVersion,
  publishTeamButton,
  reduceTeamDraftForm,
  rejectCustomTeamPublish,
  rejectCustomTeamSave,
  removeDraftMember,
  TEAM_ROLES,
  TEAM_WRITE_API_MISSING,
  teamPageModel,
  teamWriteMethodsPresent,
  probeTeamWriteSupport,
  updateDraftMember,
  writeOptions,
  type TeamDraftForm,
  type TeamMemberView,
  type TeamView,
  type TeamWriteSupport,
} from "./model.js";

export function TeamsPage(props: FeaturePageProps) {
  const client = useWorkforceClient();
  const initial = teamPageModel();
  const [teams, setTeams] = useState<TeamView[]>(initial.teams);
  const [note, setNote] = useState<string | null>(initial.note);
  const [source, setSource] = useState<"preset" | "live">(initial.source);
  const [writeSupport, setWriteSupport] = useState<TeamWriteSupport>(initial.writeSupport);
  const [listError, setListError] = useState<string | null>(null);
  const [runtimes, setRuntimes] = useState<string[]>([PRESET_RUNTIME_ID]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const catalog = asCatalogClient(client);
      const support = await probeTeamWriteSupport(client);
      if (!cancelled) {
        setWriteSupport(support);
      }
      if (hasCatalogMethod(catalog, "listRuntimes")) {
        try {
          const page = await catalog.listRuntimes();
          const ids = page.items
            .map((item) =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as { id?: unknown }).id === "string"
                ? (item as { id: string }).id
                : null,
            )
            .filter((item): item is string => item !== null);
          if (!cancelled && ids.length > 0) {
            setRuntimes(Array.from(new Set([PRESET_RUNTIME_ID, ...ids])));
          }
        } catch {
          if (!cancelled) {
            setRuntimes([PRESET_RUNTIME_ID]);
          }
        }
      }
      if (!hasCatalogMethod(catalog, "listTeams")) {
        if (!cancelled) {
          const model = teamPageModel({ writeSupport: support });
          setTeams(model.teams);
          setNote(model.note);
          setSource(model.source);
        }
        return;
      }
      try {
        const parsed = await loadTeamCatalog(client);
        if (!cancelled) {
          const model = teamPageModel({
            liveTeams: parsed.length > 0 ? parsed : null,
            writeSupport: support,
          });
          setTeams(model.teams);
          setNote(model.note);
          setSource(model.source);
          setListError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          const model = teamPageModel({ writeSupport: support });
          setTeams(model.teams);
          setNote(model.note);
          setSource(model.source);
          setListError(errorMessage(caught));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const teamId = props.params.teamId;
  const creating = teamId === "new";

  function upsertTeam(team: TeamView) {
    setTeams((current) => {
      const without = current.filter((item) => item.id !== team.id);
      return teamPageModel({
        liveTeams: [team, ...without],
        writeSupport,
      }).teams;
    });
  }

  async function refreshCatalogFromGetTeams(): Promise<TeamView[] | null> {
    try {
      const parsed = await loadTeamCatalog(client);
      const model = teamPageModel({
        liveTeams: parsed.length > 0 ? parsed : null,
        writeSupport,
      });
      setTeams(model.teams);
      setSource(model.source);
      setNote(model.note);
      setListError(null);
      return model.teams;
    } catch (caught) {
      setListError(errorMessage(caught));
      return null;
    }
  }

  function openTeam(team: TeamView) {
    upsertTeam(team);
    props.navigate(`/teams/${team.id}`);
  }

  async function openPublishedTeam(team: TeamView) {
    const catalog = await refreshCatalogFromGetTeams();
    const visible =
      catalog?.find(
        (item) =>
          item.id === team.id &&
          item.status === "published" &&
          item.versionId === team.versionId,
      ) ?? (team.status === "published" ? team : null);
    if (!visible) {
      return;
    }
    if (!catalog) {
      upsertTeam(visible);
    }
    props.navigate(`/teams/${visible.id}`);
  }

  if (creating) {
    return (
      <main style={pageStyle}>
        <BackButton onClick={() => props.navigate("/teams")} />
        <TeamEditor
          client={client}
          writeSupport={writeSupport}
          runtimes={runtimes}
          onPersisted={openTeam}
          onPublished={(team) => void openPublishedTeam(team)}
        />
      </main>
    );
  }

  if (teamId) {
    return (
      <main style={pageStyle}>
        <BackButton onClick={() => props.navigate("/teams")} />
        <TeamDetailRoute
          teamId={teamId}
          catalog={teams}
          note={note}
          source={source}
          writeSupport={writeSupport}
          runtimes={runtimes}
          client={client}
          onPersisted={openTeam}
          onPublished={(team) => void openPublishedTeam(team)}
        />
      </main>
    );
  }

  const create = createTeamButton(writeSupport);
  return (
    <main style={pageStyle}>
      <h1 style={titleStyle}>AI 团队</h1>
      {note ? <p style={mutedStyle}>{note}</p> : null}
      <p style={mutedStyle}>
        围着项目编排数字员工。预设 Software Development Team
        只读保留；自定义团队必须发布后才能绑定。
      </p>
      {listError ? (
        <p style={errorStyle} data-testid="team-list-error">
          {listError}
        </p>
      ) : null}
      <div style={{ marginBottom: "var(--wf-space-md, 12px)" }}>
        <button
          type="button"
          data-testid={create.testId}
          disabled={!create.enabled}
          style={buttonStyle("primary", !create.enabled)}
          onClick={() => {
            if (!create.enabled) {
              return;
            }
            props.navigate("/teams/new");
          }}
        >
          {create.label}
        </button>
      </div>
      {create.reason ? (
        <p style={mutedStyle} data-testid="team-write-api-missing">
          {create.reason}
        </p>
      ) : null}
      <section style={cardStyle}>
        <ul style={listStyle}>
          {teams.map((team) => (
            <li
              key={team.id}
              style={listItemStyle}
              data-testid={`team-row-${team.id}`}
              onClick={() => props.navigate(`/teams/${team.id}`)}
            >
              <strong>{team.name}</strong>
              <div style={mutedStyle}>
                {team.kind === "preset" ? "预设" : "自定义"} ·{" "}
                {team.status === "published" ? "已发布" : "草稿"} ·{" "}
                {team.members.map((member) => `${member.role}×${member.quantity}`).join(" / ")} ·{" "}
                {team.runtime.label}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function BackButton(props: { onClick: () => void }) {
  return (
    <p>
      <button type="button" style={buttonStyle("secondary")} onClick={props.onClick}>
        返回 AI 团队
      </button>
    </p>
  );
}

function TeamDetailRoute(props: {
  teamId: string;
  catalog: TeamView[];
  note: string | null;
  source: "preset" | "live";
  writeSupport: TeamWriteSupport;
  runtimes: string[];
  client: DesktopClient;
  onPersisted: (team: TeamView) => void;
  onPublished: (team: TeamView) => void;
}) {
  const [team, setTeam] = useState<TeamView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadTeamDetail(props.client, props.teamId, props.catalog);
      if (cancelled) {
        return;
      }
      setTeam(loaded);
      setLoading(false);
      setLoadError(loaded ? null : "未找到该团队。");
    })();
    return () => {
      cancelled = true;
    };
  }, [props.client, props.teamId, props.catalog]);

  if (loading && !team) {
    return <p style={mutedStyle}>加载团队…</p>;
  }
  if (!team) {
    return <p data-testid="team-not-found">{loadError ?? "未找到该团队。"}</p>;
  }
  return (
    <TeamDetail
      team={team}
      note={props.note}
      source={props.source}
      writeSupport={props.writeSupport}
      runtimes={props.runtimes}
      client={props.client}
      onPersisted={props.onPersisted}
      onPublished={props.onPublished}
    />
  );
}

function TeamDetail(props: {
  team: TeamView;
  note: string | null;
  source: "preset" | "live";
  writeSupport: TeamWriteSupport;
  runtimes: string[];
  client: DesktopClient;
  onPersisted: (team: TeamView) => void;
  onPublished: (team: TeamView) => void;
}) {
  const { writeSupport } = props;
  const team = props.team;
  const preset = team.kind === "preset";
  const editingDraft = !preset && team.status === "draft" && writeSupport.create;
  if (editingDraft) {
    return (
      <TeamEditor
        client={props.client}
        writeSupport={writeSupport}
        runtimes={props.runtimes}
        initial={draftFormFromTeam(team)}
        onPersisted={props.onPersisted}
        onPublished={props.onPublished}
      />
    );
  }
  return (
    <TeamCard
      team={team}
      note={props.note}
      source={props.source}
      writeSupport={writeSupport}
      onForked={writeSupport.create ? props.onPersisted : undefined}
      client={props.client}
    />
  );
}

function TeamCard(props: {
  team: TeamView;
  note: string | null;
  source: "preset" | "live";
  writeSupport: TeamWriteSupport;
  onForked?: ((team: TeamView) => void) | undefined;
  client: DesktopClient;
}) {
  const [forkError, setForkError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const save = rejectCustomTeamSave(props.writeSupport);
  const publish = publishTeamButton(props.writeSupport);
  const bindable = canBindTeamVersion(props.team);

  async function forkDraft() {
    if (!props.writeSupport.create || !teamWriteMethodsPresent(props.client)) {
      setForkError(TEAM_WRITE_API_MISSING);
      return;
    }
    setForking(true);
    setForkError(null);
    try {
      const persisted = await persistTeamDraft(
        props.client,
        {
          name: `${props.team.name} 草稿`,
          members: props.team.members,
          teamId: null,
          versionId: null,
        },
        writeOptions,
      );
      if (persisted.team.status === "published") {
        setForkError("已发布版本不能原地改写；新建草稿响应仍是 published，未当作可编辑草稿。");
        return;
      }
      props.onForked?.(persisted.team);
    } catch (caught) {
      setForkError(errorMessage(caught));
    } finally {
      setForking(false);
    }
  }

  return (
    <section
      style={cardStyle}
      data-testid={props.team.kind === "preset" ? "team-preset-card" : "team-card"}
    >
      <h1 style={titleStyle}>{props.team.name}</h1>
      <div style={{ marginBottom: "var(--wf-space-md, 12px)" }}>
        <span style={badgeStyle(props.team.status === "published" ? "health" : "muted")}>
          {props.team.kind === "preset"
            ? "预设只读"
            : props.team.status === "published"
              ? "已发布"
              : "草稿"}
        </span>
      </div>
      <p style={mutedStyle}>
        版本 {props.team.version} · 运行时 {props.team.runtime.label} · 来源{" "}
        {props.source === "live" ? "GET /teams" : "预设副本"}
      </p>
      {props.note ? <p style={mutedStyle}>{props.note}</p> : null}
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>Workers</h2>
      <MemberList members={props.team.members} />
      {props.team.kind === "preset" ? <p style={mutedStyle}>{save.reason}</p> : null}
      {!bindable ? (
        <p style={mutedStyle} data-testid="team-unpublished-bind">
          未发布草稿不能绑定到项目，也不能启用开始规划。
        </p>
      ) : null}
      {props.team.kind === "custom" && props.team.status === "published" ? (
        <p style={mutedStyle} data-testid="team-published-version">
          已发布精确 TeamVersion {props.team.versionId}。可在项目 Settings 绑定该版本后开始规划。
        </p>
      ) : null}
      {props.team.kind === "custom" && props.team.status === "published" ? (
        <p>
          <button
            type="button"
            data-testid="team-new-draft"
            disabled={!props.writeSupport.create || forking}
            style={buttonStyle("secondary", !props.writeSupport.create || forking)}
            onClick={() => void forkDraft()}
          >
            基于此版本新建草稿
          </button>
        </p>
      ) : null}
      {!props.writeSupport.publish ? (
        <p style={mutedStyle} data-testid="team-publish-disabled">
          {publish.reason}
        </p>
      ) : null}
      {forkError ? <p style={errorStyle}>{forkError}</p> : null}
    </section>
  );
}

function TeamEditor(props: {
  client: DesktopClient;
  writeSupport: TeamWriteSupport;
  runtimes: string[];
  initial?: TeamDraftForm;
  onPersisted: (team: TeamView) => void;
  onPublished: (team: TeamView) => void;
}) {
  const [form, setForm] = useState<TeamDraftForm>(props.initial ?? emptyTeamDraftForm());
  const create = createTeamButton(props.writeSupport);
  const publish = publishTeamButton(props.writeSupport);
  const valid = form.name.trim().length > 0 && draftMembersValid(form.members);
  const canSave = props.writeSupport.create && valid && !form.submitting;
  const canPublish =
    props.writeSupport.publish && valid && draftMembersValid(form.members) && !form.submitting;

  async function run(action: "save" | "publish") {
    if (action === "save" && !props.writeSupport.create) {
      setForm((current) => ({
        ...current,
        error: rejectCustomTeamSave(props.writeSupport).reason,
      }));
      return;
    }
    if (action === "publish" && !props.writeSupport.publish) {
      setForm((current) => ({
        ...current,
        error: rejectCustomTeamPublish(props.writeSupport).reason,
      }));
      return;
    }
    if (!teamWriteMethodsPresent(props.client)) {
      setForm((current) => ({ ...current, error: TEAM_WRITE_API_MISSING, published: false }));
      return;
    }
    setForm((current) => reduceTeamDraftForm(current, { type: "submit", action }));
    try {
      const persisted = await persistTeamDraft(
        props.client,
        {
          name: form.name,
          members: form.members,
          teamId: form.teamId,
          versionId: form.versionId,
          teamStatus: form.teamStatus,
          ...(form.teamStateRevision !== undefined
            ? { teamStateRevision: form.teamStateRevision }
            : {}),
          ...(form.versionStateRevision !== undefined
            ? { versionStateRevision: form.versionStateRevision }
            : {}),
        },
        writeOptions,
      );
      if (action === "save") {
        setForm((current) =>
          reduceTeamDraftForm(current, {
            type: "saved",
            teamId: persisted.teamId,
            versionId: persisted.versionId,
            ...(persisted.teamStateRevision !== undefined
              ? { teamStateRevision: persisted.teamStateRevision }
              : {}),
            ...(persisted.versionStateRevision !== undefined
              ? { versionStateRevision: persisted.versionStateRevision }
              : {}),
          }),
        );
        props.onPersisted(persisted.team);
        return;
      }
      const interpreted = await publishPersistedTeamVersion(
        props.client,
        {
          teamId: persisted.teamId,
          versionId: persisted.versionId,
          ...(persisted.versionStateRevision !== undefined
            ? { versionStateRevision: persisted.versionStateRevision }
            : {}),
        },
        writeOptions,
      );
      if (!interpreted.ok) {
        setForm((current) =>
          reduceTeamDraftForm(current, {
            type: "failure",
            error: new Error(interpreted.reason),
          }),
        );
        props.onPersisted(persisted.team);
        return;
      }
      setForm((current) =>
        reduceTeamDraftForm(current, {
          type: "published",
          teamId: persisted.teamId,
          versionId: interpreted.versionId,
        }),
      );
      props.onPublished(interpreted.team);
    } catch (caught) {
      setForm((current) => reduceTeamDraftForm(current, { type: "failure", error: caught }));
      if (isRevisionConflict(caught)) {
        return;
      }
    }
  }

  return (
    <section style={cardStyle} data-testid="team-editor">
      <h1 style={titleStyle}>{form.teamId ? "编辑团队草稿" : "新建团队草稿"}</h1>
      <p style={mutedStyle}>
        成员包含 role、RuntimeProfile 与 quantity。发布后不可变，编辑必须新建版本。
      </p>
      {!props.writeSupport.create ? (
        <p style={warningStyle} data-testid="team-write-api-missing">
          {create.reason}
        </p>
      ) : null}
      <label style={labelStyle} htmlFor="wf-team-name">
        名称
      </label>
      <input
        id="wf-team-name"
        data-testid="team-name-input"
        style={inputStyle}
        value={form.name}
        onChange={(event) =>
          setForm((current) =>
            reduceTeamDraftForm(current, { type: "changeName", value: event.target.value }),
          )
        }
      />
      <MemberEditor
        members={form.members}
        runtimes={props.runtimes}
        disabled={!props.writeSupport.create}
        onChange={(members) =>
          setForm((current) => reduceTeamDraftForm(current, { type: "setMembers", members }))
        }
      />
      <p>
        <button
          type="button"
          data-testid="team-save-draft"
          disabled={!canSave}
          style={buttonStyle("secondary", !canSave)}
          onClick={() => void run("save")}
        >
          保存草稿
        </button>{" "}
        <button
          type="button"
          data-testid={publish.testId}
          disabled={!canPublish}
          style={buttonStyle("primary", !canPublish)}
          onClick={() => void run("publish")}
        >
          {publish.label}
        </button>
      </p>
      {form.published ? (
        <p style={mutedStyle} data-testid="team-published">
          已发布不可变 TeamVersion {form.versionId}，且已出现在 GET /teams。
        </p>
      ) : null}
      {form.error ? (
        <p style={form.needsRefresh ? warningStyle : errorStyle} data-testid="team-editor-error">
          {form.error}
        </p>
      ) : null}
      {form.needsRefresh ? (
        <p style={mutedStyle}>已保留输入。刷新后再提交，不会假装已保存。</p>
      ) : null}
    </section>
  );
}

function MemberList(props: { members: TeamMemberView[] }) {
  return (
    <ul style={listStyle}>
      {props.members.map((member) => (
        <li
          key={member.id}
          style={{ ...listItemStyle, cursor: "default" }}
          data-testid={`team-member-${member.id}`}
        >
          <strong>{member.title}</strong>
          <div style={mutedStyle}>
            角色 {member.role} · RuntimeProfile {member.runtimeProfile} · 数量 {member.quantity}
          </div>
        </li>
      ))}
    </ul>
  );
}

function MemberEditor(props: {
  members: TeamMemberView[];
  runtimes: string[];
  disabled: boolean;
  onChange: (members: TeamMemberView[]) => void;
}) {
  const runtimeOptions = useMemo(
    () => Array.from(new Set([PRESET_RUNTIME_ID, ...props.runtimes])),
    [props.runtimes],
  );
  return (
    <div data-testid="team-member-editor">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>成员</h2>
      {props.members.map((member, index) => (
        <div
          key={`${member.id}-${index}`}
          data-testid="team-member-row"
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 2fr 1fr auto",
            gap: "var(--wf-space-sm, 8px)",
            marginBottom: "var(--wf-space-md, 12px)",
            alignItems: "end",
          }}
        >
          <label style={labelStyle}>
            角色
            <select
              style={inputStyle}
              disabled={props.disabled}
              value={member.role}
              onChange={(event) =>
                props.onChange(
                  updateDraftMember(props.members, index, { role: event.target.value }),
                )
              }
            >
              {TEAM_ROLES.includes(member.role as (typeof TEAM_ROLES)[number]) ? null : (
                <option value={member.role}>{member.role}</option>
              )}
              {TEAM_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            RuntimeProfile
            <select
              style={inputStyle}
              disabled={props.disabled}
              value={member.runtimeProfile}
              onChange={(event) =>
                props.onChange(
                  updateDraftMember(props.members, index, { runtimeProfile: event.target.value }),
                )
              }
            >
              {runtimeOptions.includes(member.runtimeProfile) ? null : (
                <option value={member.runtimeProfile}>{member.runtimeProfile}</option>
              )}
              {runtimeOptions.map((runtime) => (
                <option key={runtime} value={runtime}>
                  {runtime}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            数量
            <input
              type="number"
              min={1}
              step={1}
              style={inputStyle}
              disabled={props.disabled}
              value={member.quantity}
              onChange={(event) =>
                props.onChange(
                  updateDraftMember(props.members, index, {
                    quantity: Number.parseInt(event.target.value, 10) || 0,
                  }),
                )
              }
            />
          </label>
          <button
            type="button"
            style={buttonStyle("secondary", props.disabled || props.members.length <= 1)}
            disabled={props.disabled || props.members.length <= 1}
            onClick={() => props.onChange(removeDraftMember(props.members, index))}
          >
            移除
          </button>
        </div>
      ))}
      <button
        type="button"
        data-testid="team-add-member"
        style={buttonStyle("secondary", props.disabled)}
        disabled={props.disabled}
        onClick={() => props.onChange(addDraftMember(props.members))}
      >
        添加成员
      </button>
    </div>
  );
}

export function ProjectTeamBindingField(props: {
  teams: TeamView[];
  writeSupport: TeamWriteSupport;
  selection: { teamId: string; versionId: string };
  projectTeamVersionId: string | null;
  disabled: boolean;
  busy: boolean;
  error: string | null;
  onSelect: (team: TeamView) => void;
  onBind: () => void;
}) {
  const published = bindableTeams(props.teams);
  const drafts = props.teams.filter((team) => team.status === "draft");
  const selected =
    published.find((team) => team.versionId === props.selection.versionId) ??
    published.find((team) => team.id === props.selection.teamId) ??
    PRESET_TEAM;
  const customSelected = selected.kind === "custom";
  const exactVersion = canBindTeamVersion(selected);
  const canBind =
    props.writeSupport.bind &&
    customSelected &&
    exactVersion &&
    !props.disabled &&
    !props.busy;
  return (
    <div data-testid="project-team-binding">
      <label style={labelStyle} htmlFor="wf-project-team">
        团队（已发布 TeamVersion）
      </label>
      <select
        id="wf-project-team"
        data-testid="project-team-select"
        style={inputStyle}
        disabled={props.disabled}
        value={selected.versionId || selected.id}
        onChange={(event) => {
          const next = published.find(
            (team) =>
              team.versionId === event.target.value ||
              (team.versionId.length === 0 && team.id === event.target.value),
          );
          if (next && canBindTeamVersion(next)) {
            props.onSelect(next);
          }
        }}
      >
        {published.map((team) => (
          <option key={`${team.id}:${team.versionId}`} value={team.versionId || team.id}>
            {team.name}
            {team.kind === "preset" ? "（预设）" : ""} · {team.versionId || team.version}
          </option>
        ))}
      </select>
      {customSelected && exactVersion ? (
        <p style={mutedStyle} data-testid="project-team-version">
          绑定精确 TeamVersion {selected.versionId}。未发布草稿不可 :start-planning。
        </p>
      ) : null}
      {drafts.length > 0 ? (
        <p style={mutedStyle} data-testid="project-team-unpublished">
          {drafts.length} 个未发布草稿不可绑定，也不会启用开始规划。
        </p>
      ) : null}
      {customSelected ? (
        <p>
          <button
            type="button"
            data-testid="project-bind-team"
            disabled={!canBind}
            style={buttonStyle("secondary", !canBind)}
            onClick={() => {
              if (!canBind) {
                return;
              }
              props.onBind();
            }}
          >
            绑定已发布自定义 TeamVersion
          </button>
        </p>
      ) : (
        <p style={mutedStyle}>预设 Software Development Team 可直接用于开始规划（M3 主路径）。</p>
      )}
      {!props.writeSupport.bind && customSelected ? (
        <p style={mutedStyle} data-testid="project-bind-team-disabled">
          {TEAM_WRITE_API_MISSING}
        </p>
      ) : null}
      {customSelected && props.projectTeamVersionId !== selected.versionId ? (
        <p style={mutedStyle} data-testid="project-team-unconfirmed">
          自定义绑定尚未被服务端回传 teamVersionId，开始规划保持禁用。
        </p>
      ) : null}
      {props.error ? (
        <p style={errorStyle} data-testid="project-team-bind-error">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
