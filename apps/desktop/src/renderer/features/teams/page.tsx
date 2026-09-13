import { useEffect, useState } from "react";
import type { DesktopClient } from "@workforce/desktop-client";

import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  List,
  ListRow,
  Muted,
  Notice,
  Page,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { asCatalogClient, hasCatalogMethod, useWorkforceClient } from "../hooks.js";
import { errorMessage, isRevisionConflict } from "../projects/command.js";
import {
  addDraftMember,
  bindableTeams,
  canBindTeamVersion,
  createTeamButton,
  draftFormFromTeam,
  draftMembersValid,
  emptyTeamDraftForm,
  FORK_DRAFT_NOT_SELECTABLE,
  forkPublishedWorkerVersion,
  loadSelectableWorkerVersions,
  loadTeamCatalog,
  loadTeamDetail,
  memberHasWorkerVersionRef,
  MISSING_WORKER_VERSION_REASON,
  persistTeamDraft,
  PRESET_TEAM,
  printableWorkerCardField,
  publishPersistedTeamVersion,
  publishTeamButton,
  reduceTeamDraftForm,
  rejectCustomTeamPublish,
  rejectCustomTeamSave,
  removeDraftMember,
  replaceDraftMember,
  resolveMemberCard,
  TEAM_WRITE_API_MISSING,
  teamPageModel,
  teamWriteMethodsPresent,
  probeTeamWriteSupport,
  updateDraftMember,
  workerLibraryMethodsPresent,
  WORKER_CARD_FIELD_LABELS,
  workerCardFieldNames,
  WORKER_LIBRARY_API_MISSING,
  writeOptions,
  type SelectableWorkerVersionView,
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const catalog = asCatalogClient(client);
      const support = await probeTeamWriteSupport(client);
      if (!cancelled) {
        setWriteSupport(support);
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
          item.id === team.id && item.status === "published" && item.versionId === team.versionId,
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
      <TeamEditor
        client={client}
        writeSupport={writeSupport}
        onBack={() => props.navigate("/teams")}
        onOpenLibrary={() => props.navigate("/role-library")}
        onPersisted={openTeam}
        onPublished={(team) => void openPublishedTeam(team)}
      />
    );
  }

  if (teamId) {
    return (
      <TeamDetailRoute
        teamId={teamId}
        catalog={teams}
        note={note}
        source={source}
        writeSupport={writeSupport}
        client={client}
        onBack={() => props.navigate("/teams")}
        onOpenLibrary={() => props.navigate("/role-library")}
        onPersisted={openTeam}
        onPublished={(team) => void openPublishedTeam(team)}
      />
    );
  }

  const create = createTeamButton(writeSupport);
  return (
    <Page
      title="AI 团队"
      subtitle="围着项目编排数字员工。预设 Software Development Team 只读保留；自定义团队必须发布后才能绑定。"
      actions={
        <Button
          variant="primary"
          testId={create.testId}
          disabled={!create.enabled}
          onClick={() => {
            if (!create.enabled) {
              return;
            }
            props.navigate("/teams/new");
          }}
        >
          {create.label}
        </Button>
      }
    >
      {note ? <Muted>{note}</Muted> : null}
      {listError ? (
        <div data-testid="team-list-error">
          <ErrorText>{listError}</ErrorText>
        </div>
      ) : null}
      {create.reason ? (
        <Muted>
          <span data-testid="team-write-api-missing">{create.reason}</span>
        </Muted>
      ) : null}
      <Card>
        <List>
          {teams.map((team) => (
            <ListRow
              key={team.id}
              testId={`team-row-${team.id}`}
              title={team.name}
              meta={`${team.kind === "preset" ? "预设" : "自定义"} · ${
                team.status === "published" ? "已发布" : "草稿"
              } · ${team.members
                .map(
                  (member) =>
                    `${member.role}${
                      member.workerVersionId ? `@${member.workerVersionId}` : ""
                    }×${member.quantity}`,
                )
                .join(" / ")}`}
              onClick={() => props.navigate(`/teams/${team.id}`)}
            />
          ))}
        </List>
      </Card>
    </Page>
  );
}

function TeamDetailRoute(props: {
  teamId: string;
  catalog: TeamView[];
  note: string | null;
  source: "preset" | "live";
  writeSupport: TeamWriteSupport;
  client: DesktopClient;
  onBack: () => void;
  onOpenLibrary: () => void;
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
    return (
      <Page title="AI 团队" actions={<Button onClick={props.onBack}>返回 AI 团队</Button>}>
        <Skeleton lines={4} />
      </Page>
    );
  }
  if (!team) {
    return (
      <Page title="AI 团队" actions={<Button onClick={props.onBack}>返回 AI 团队</Button>}>
        <p data-testid="team-not-found">{loadError ?? "未找到该团队。"}</p>
      </Page>
    );
  }
  return (
    <TeamDetail
      team={team}
      note={props.note}
      source={props.source}
      writeSupport={props.writeSupport}
      client={props.client}
      onBack={props.onBack}
      onOpenLibrary={props.onOpenLibrary}
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
  client: DesktopClient;
  onBack: () => void;
  onOpenLibrary: () => void;
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
        initial={draftFormFromTeam(team)}
        onBack={props.onBack}
        onOpenLibrary={props.onOpenLibrary}
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
      onBack={props.onBack}
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
  onBack: () => void;
}) {
  const [forkError, setForkError] = useState<string | null>(null);
  const [forking, setForking] = useState(false);
  const save = rejectCustomTeamSave(props.writeSupport);
  const publish = publishTeamButton(props.writeSupport);
  const bindable = canBindTeamVersion(props.team);
  const badgeTone = props.team.status === "published" ? "success" : "muted";
  const badgeLabel =
    props.team.kind === "preset"
      ? "预设只读"
      : props.team.status === "published"
        ? "已发布"
        : "草稿";

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
    <Page title={props.team.name} actions={<Button onClick={props.onBack}>返回 AI 团队</Button>}>
      <Card testId={props.team.kind === "preset" ? "team-preset-card" : "team-card"}>
        <Badge tone={badgeTone}>{badgeLabel}</Badge>
        <Muted>
          版本 {props.team.version} · 运行时 {props.team.runtime.label} · 来源{" "}
          {props.source === "live" ? "GET /teams" : "预设副本"}
        </Muted>
        {props.note ? <Muted>{props.note}</Muted> : null}
        <h2 className="wf-section-title">Workers</h2>
        <MemberList client={props.client} members={props.team.members} />
        {props.team.kind === "preset" ? <Muted>{save.reason}</Muted> : null}
        {!bindable ? (
          <Muted>
            <span data-testid="team-unpublished-bind">
              未发布草稿不能绑定到项目，也不能启用开始规划。
            </span>
          </Muted>
        ) : null}
        {props.team.kind === "custom" && props.team.status === "published" ? (
          <Muted>
            <span data-testid="team-published-version">
              已发布精确 TeamVersion {props.team.versionId}。可在项目 Settings
              绑定该版本后开始规划。
            </span>
          </Muted>
        ) : null}
        {props.team.kind === "custom" && props.team.status === "published" ? (
          <Button
            testId="team-new-draft"
            disabled={!props.writeSupport.create || forking}
            onClick={() => void forkDraft()}
          >
            基于此版本新建草稿
          </Button>
        ) : null}
        {!props.writeSupport.publish ? (
          <Muted>
            <span data-testid="team-publish-disabled">{publish.reason}</span>
          </Muted>
        ) : null}
        <ErrorText>{forkError}</ErrorText>
      </Card>
    </Page>
  );
}

function TeamEditor(props: {
  client: DesktopClient;
  writeSupport: TeamWriteSupport;
  initial?: TeamDraftForm;
  onBack: () => void;
  onOpenLibrary: () => void;
  onPersisted: (team: TeamView) => void;
  onPublished: (team: TeamView) => void;
}) {
  const [form, setForm] = useState<TeamDraftForm>(props.initial ?? emptyTeamDraftForm());
  const create = createTeamButton(props.writeSupport);
  const publish = publishTeamButton(props.writeSupport);
  const valid = form.name.trim().length > 0 && draftMembersValid(form.members);
  const canSave = props.writeSupport.create && valid && !form.submitting;
  const canPublish = props.writeSupport.publish && valid && !form.submitting;
  const missingRefs = !draftMembersValid(form.members);

  async function run(action: "save" | "publish") {
    if (action === "save" && !props.writeSupport.create) {
      setForm((current) => ({
        ...current,
        error: rejectCustomTeamSave(props.writeSupport).reason,
        published: false,
      }));
      return;
    }
    if (action === "publish" && !props.writeSupport.publish) {
      setForm((current) => ({
        ...current,
        error: rejectCustomTeamPublish(props.writeSupport).reason,
        published: false,
      }));
      return;
    }
    if (!draftMembersValid(form.members)) {
      setForm((current) => ({
        ...current,
        error: MISSING_WORKER_VERSION_REASON,
        published: false,
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
    <Page
      title={form.teamId ? "编辑团队草稿" : "新建团队草稿"}
      actions={<Button onClick={props.onBack}>返回 AI 团队</Button>}
    >
      <Card testId="team-editor">
        <Muted>
          成员必须引用已发布且未归档的 WorkerVersion。选用时能看见该版本卡片（他是谁 / 怎么干活 /
          会哪些技能）。Runtime 请来时再选，不是卡片必印。发布后不可变。
        </Muted>
        {!props.writeSupport.create ? (
          <Notice tone="warning">
            <span data-testid="team-write-api-missing">{create.reason}</span>
          </Notice>
        ) : null}
        <Field label="名称" htmlFor="wf-team-name">
          <Input
            id="wf-team-name"
            testId="team-name-input"
            value={form.name}
            onChange={(event) =>
              setForm((current) =>
                reduceTeamDraftForm(current, { type: "changeName", value: event.target.value }),
              )
            }
          />
        </Field>
        <MemberEditor
          client={props.client}
          members={form.members}
          disabled={!props.writeSupport.create}
          onOpenLibrary={props.onOpenLibrary}
          onChange={(members) =>
            setForm((current) => reduceTeamDraftForm(current, { type: "setMembers", members }))
          }
        />
        {missingRefs ? (
          <Muted>
            <span data-testid="team-missing-worker-version">{MISSING_WORKER_VERSION_REASON}</span>
          </Muted>
        ) : null}
        <div className="wf-cluster">
          <Button
            testId="team-save-draft"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) {
                return;
              }
              void run("save");
            }}
          >
            保存草稿
          </Button>
          <Button
            variant="primary"
            testId={publish.testId}
            disabled={!canPublish}
            onClick={() => {
              if (!canPublish) {
                return;
              }
              void run("publish");
            }}
          >
            {publish.label}
          </Button>
        </div>
        {form.published ? (
          <Muted>
            <span data-testid="team-published">
              已发布不可变 TeamVersion {form.versionId}，且已出现在 GET /teams。
            </span>
          </Muted>
        ) : null}
        {form.error ? (
          form.needsRefresh ? (
            <Notice tone="warning">
              <span data-testid="team-editor-error">{form.error}</span>
            </Notice>
          ) : (
            <div data-testid="team-editor-error">
              <ErrorText>{form.error}</ErrorText>
            </div>
          )
        ) : null}
        {form.needsRefresh ? <Muted>已保留输入。刷新后再提交，不会假装已保存。</Muted> : null}
      </Card>
    </Page>
  );
}

function usePublishedWorkerCards(client: DesktopClient): SelectableWorkerVersionView[] {
  const [versions, setVersions] = useState<SelectableWorkerVersionView[]>([]);
  useEffect(() => {
    if (!workerLibraryMethodsPresent(client)) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadSelectableWorkerVersions(client);
        if (!cancelled) {
          setVersions(loaded);
        }
      } catch {
        if (!cancelled) {
          setVersions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);
  return versions;
}

function WorkerCardPreview(props: {
  card: {
    who?: string | undefined;
    how?: string | undefined;
    skills?: string | undefined;
  };
}) {
  return (
    <div className="wf-stack" data-testid="team-worker-card">
      {workerCardFieldNames.map((key) => (
        <Muted key={key}>
          {WORKER_CARD_FIELD_LABELS[key]}：
          <span data-testid={`team-worker-card-${key}`}>
            {printableWorkerCardField(props.card[key])}
          </span>
        </Muted>
      ))}
    </div>
  );
}

function MemberList(props: { client: DesktopClient; members: TeamMemberView[] }) {
  const versions = usePublishedWorkerCards(props.client);
  return (
    <Table>
      <THead>
        <TR>
          <TH>角色版本</TH>
          <TH>职责</TH>
          <TH>卡片</TH>
          <TH>WorkerVersion</TH>
          <TH>数量</TH>
        </TR>
      </THead>
      <TBody>
        {props.members.map((member) => (
          <TR key={member.id} testId={`team-member-${member.id}`}>
            <TD>{member.title}</TD>
            <TD>{member.role}</TD>
            <TD>
              <WorkerCardPreview card={resolveMemberCard(member, versions)} />
            </TD>
            <TD>{member.workerVersionId ?? "未引用"}</TD>
            <TD>{member.quantity}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

function MemberEditor(props: {
  client: DesktopClient;
  members: TeamMemberView[];
  disabled: boolean;
  onOpenLibrary: () => void;
  onChange: (members: TeamMemberView[]) => void;
}) {
  const [picker, setPicker] = useState<"add" | number | null>(null);
  const versions = usePublishedWorkerCards(props.client);
  return (
    <div data-testid="team-member-editor">
      <h2 className="wf-section-title">成员</h2>
      <Table>
        <THead>
          <TR>
            <TH>角色版本</TH>
            <TH>职责</TH>
            <TH>卡片</TH>
            <TH>数量</TH>
            <TH>Runtime（可选）</TH>
            <TH>
              <span className="wf-sr-only">操作</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {props.members.map((member, index) => (
            <TR key={`${member.id}-${index}`} testId="team-member-row">
              <TD>
                {memberHasWorkerVersionRef(member) ? (
                  <span data-testid="team-member-worker-version">
                    {member.title} · {member.workerVersionId}
                  </span>
                ) : (
                  <span data-testid="team-member-unreferenced">未选择 WorkerVersion</span>
                )}
              </TD>
              <TD>{member.role}</TD>
              <TD>
                <WorkerCardPreview card={resolveMemberCard(member, versions)} />
              </TD>
              <TD>
                <Input
                  type="number"
                  min={1}
                  step={1}
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
              </TD>
              <TD>
                <Input
                  testId="team-member-runtime"
                  disabled={props.disabled}
                  value={member.runtimeProfile}
                  placeholder="请来时再选"
                  aria-label="Runtime 请来时再选，不是卡片必填"
                  onChange={(event) =>
                    props.onChange(
                      updateDraftMember(props.members, index, {
                        runtimeProfile: event.target.value,
                      }),
                    )
                  }
                />
              </TD>
              <TD>
                <div className="wf-cluster">
                  <Button
                    variant="outline"
                    size="sm"
                    testId="team-replace-member"
                    disabled={props.disabled}
                    onClick={() => setPicker(index)}
                  >
                    更换
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={props.disabled || props.members.length <= 1}
                    onClick={() => props.onChange(removeDraftMember(props.members, index))}
                  >
                    移除
                  </Button>
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Button testId="team-add-member" disabled={props.disabled} onClick={() => setPicker("add")}>
        添加成员
      </Button>
      {picker !== null ? (
        <WorkerVersionPicker
          client={props.client}
          disabled={props.disabled}
          onOpenLibrary={props.onOpenLibrary}
          onCancel={() => setPicker(null)}
          onSelect={(selected) => {
            if (picker === "add") {
              props.onChange(addDraftMember(props.members, selected));
            } else {
              props.onChange(replaceDraftMember(props.members, picker, selected));
            }
            setPicker(null);
          }}
        />
      ) : null}
    </div>
  );
}

function WorkerVersionPicker(props: {
  client: DesktopClient;
  disabled: boolean;
  onOpenLibrary: () => void;
  onCancel: () => void;
  onSelect: (selected: SelectableWorkerVersionView) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<SelectableWorkerVersionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forkNote, setForkNote] = useState<string | null>(null);
  const [forkingId, setForkingId] = useState<string | null>(null);
  const libraryReady = workerLibraryMethodsPresent(props.client);

  useEffect(() => {
    if (!libraryReady) {
      setLoading(false);
      setOptions([]);
      setError(WORKER_LIBRARY_API_MISSING);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const loaded = await loadSelectableWorkerVersions(props.client, { q: query });
        if (!cancelled) {
          setOptions(loaded);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setOptions([]);
          setError(errorMessage(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryReady, props.client, query]);

  async function fork(option: SelectableWorkerVersionView) {
    if (props.disabled) {
      return;
    }
    setForkingId(option.workerVersionId);
    setForkNote(null);
    try {
      const forked = await forkPublishedWorkerVersion(props.client, {
        workerId: option.workerId,
        workerVersionId: option.workerVersionId,
      });
      setForkNote(
        `${FORK_DRAFT_NOT_SELECTABLE} 新草稿 ${forked.workerDraftId}（Worker ${forked.workerId}）。`,
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setForkingId(null);
    }
  }

  return (
    <div data-testid="team-worker-version-picker">
      <h3 className="wf-section-title">从角色版本库选用</h3>
      <Muted>
        只列出已发布且未归档的 WorkerVersion。选用时能看见卡片三字段；空格显式为「空」，不拿 Runtime
        或 Policy 顶替。Runtime 请来时再选。草稿和归档不能点成成功。
      </Muted>
      <Field label="搜索库" htmlFor="wf-team-worker-search">
        <Input
          id="wf-team-worker-search"
          testId="team-worker-search"
          value={query}
          disabled={props.disabled || !libraryReady}
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      {loading ? <Skeleton lines={3} /> : null}
      {error ? (
        <div data-testid="team-worker-picker-error">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
      {forkNote ? (
        <Notice tone="warning">
          <span data-testid="team-worker-fork-draft">{forkNote}</span>
        </Notice>
      ) : null}
      {!loading && options.length === 0 && error === null ? (
        <Muted>库里没有可选用的已发布 WorkerVersion。</Muted>
      ) : null}
      {options.length > 0 ? (
        <Table>
          <THead>
            <TR>
              <TH>版本</TH>
              <TH>职责</TH>
              <TH>卡片</TH>
              <TH>
                <span className="wf-sr-only">操作</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {options.map((option) => (
              <TR key={option.workerVersionId} testId="team-worker-option">
                <TD>
                  {option.name} · {option.workerVersionId}
                </TD>
                <TD>{option.role}</TD>
                <TD>
                  <WorkerCardPreview card={option} />
                </TD>
                <TD>
                  <div className="wf-cluster">
                    <Button
                      variant="primary"
                      size="sm"
                      testId="team-select-worker-version"
                      disabled={props.disabled}
                      onClick={() => props.onSelect(option)}
                    >
                      选用
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      testId="team-fork-worker-version"
                      disabled={props.disabled || forkingId === option.workerVersionId}
                      onClick={() => void fork(option)}
                    >
                      Fork
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}
      <div className="wf-cluster">
        <Button variant="outline" testId="team-worker-picker-cancel" onClick={props.onCancel}>
          取消
        </Button>
        <Button variant="ghost" testId="team-open-role-library" onClick={props.onOpenLibrary}>
          打开角色版本库
        </Button>
      </div>
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
    props.writeSupport.bind && customSelected && exactVersion && !props.disabled && !props.busy;
  return (
    <div data-testid="project-team-binding">
      <Field label="团队（已发布 TeamVersion）" htmlFor="wf-project-team">
        <Select
          id="wf-project-team"
          testId="project-team-select"
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
        </Select>
      </Field>
      {customSelected && exactVersion ? (
        <Muted>
          <span data-testid="project-team-version">
            绑定精确 TeamVersion {selected.versionId}。未发布草稿不可 :start-planning。
          </span>
        </Muted>
      ) : null}
      {drafts.length > 0 ? (
        <Muted>
          <span data-testid="project-team-unpublished">
            {drafts.length} 个未发布草稿不可绑定，也不会启用开始规划。
          </span>
        </Muted>
      ) : null}
      {customSelected ? (
        <Button
          testId="project-bind-team"
          disabled={!canBind}
          onClick={() => {
            if (!canBind) {
              return;
            }
            props.onBind();
          }}
        >
          绑定已发布自定义 TeamVersion
        </Button>
      ) : (
        <Muted>预设 Software Development Team 可直接用于开始规划（M3 主路径）。</Muted>
      )}
      {!props.writeSupport.bind && customSelected ? (
        <Muted>
          <span data-testid="project-bind-team-disabled">{TEAM_WRITE_API_MISSING}</span>
        </Muted>
      ) : null}
      {customSelected && props.projectTeamVersionId !== selected.versionId ? (
        <Muted>
          <span data-testid="project-team-unconfirmed">
            自定义绑定尚未被服务端回传 teamVersionId，开始规划保持禁用。
          </span>
        </Muted>
      ) : null}
      {props.error ? (
        <div data-testid="project-team-bind-error">
          <ErrorText>{props.error}</ErrorText>
        </div>
      ) : null}
    </div>
  );
}
