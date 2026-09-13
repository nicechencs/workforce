import type {
  ForkWorkerVersionAcceptedDto,
  WorkerDraftDto,
  WorkerDto,
  WorkerVersionDto,
  WorkerVersionReferencesDto,
} from "@workforce/desktop-client";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { parseHashQuery } from "../../app/hash-router.js";
import {
  Badge,
  Button,
  Card,
  Cluster,
  EmptyState,
  ErrorText,
  Field,
  Input,
  List,
  ListRow,
  LoadingText,
  Muted,
  Notice,
  Page,
  Select,
  SegmentedControl,
  Textarea,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import { WorkerDetail } from "./detail.js";
import {
  activeDraftIdOf,
  activeVersionOf,
  applyArchivedToWorker,
  applyArchivedVersion,
  ARCHIVED_FILTER_ITEMS,
  ARCHIVE_NOT_PUBLISHED,
  canArchiveVersion,
  canForkVersion,
  canPatchCardDraft,
  canPublishDraft,
  CARD_FIELDS,
  cardWriteFromForm,
  confirmArchived,
  confirmCreatedDraft,
  confirmForkedDraft,
  confirmPatchedDraft,
  confirmPublishedVersion,
  CREATE_ROLE_NEEDS_NAME_ROLE,
  createRoleFormValid,
  createWorkerInputFromForm,
  DRAFT_NOT_EDITABLE,
  DRAFT_REVISION_CONFLICT,
  emptyCreateRoleForm,
  emptyLibraryQuery,
  FORK_NOT_PUBLISHED,
  isLibraryRevisionConflict,
  isPublishedCardLocked,
  LIBRARY_API_MISSING,
  libraryCommandOptions,
  libraryErrorMessage,
  loadWorkerCatalog,
  mergeWorkerPage,
  prependWorker,
  PUBLISHED_CARD_NOT_PATCHABLE,
  PUBLISH_NOT_DRAFT,
  replaceWorker,
  selectableVersionOptions,
  STATUS_FILTER_ITEMS,
  CARD_UNPUBLISHED_NO_DRAFT,
  versionOptionLabel,
  workerBadge,
  workerLibraryMethodsPresent,
  workerListMeta,
  type CardForm,
  type CreateRoleForm,
  type LibraryQuery,
} from "./model.js";

interface Selection {
  workerId: string;
  versionId?: string;
  draftId?: string;
}

export function RoleLibraryPage(props: FeaturePageProps): ReactNode {
  void props;
  const client = useWorkforceClient();
  const [query, setQuery] = useState<LibraryQuery>(emptyLibraryQuery);
  const [searchText, setSearchText] = useState("");
  const [workers, setWorkers] = useState<WorkerDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [apiReady, setApiReady] = useState(() => workerLibraryMethodsPresent(client));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailWorker, setDetailWorker] = useState<WorkerDto | null>(null);
  const [detailVersion, setDetailVersion] = useState<WorkerVersionDto | null>(null);
  const [detailDraft, setDetailDraft] = useState<WorkerDraftDto | null>(null);
  const [references, setReferences] = useState<WorkerVersionReferencesDto | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<"archive" | "fork" | "save" | "publish" | "create" | null>(
    null,
  );
  const [forkNotice, setForkNotice] = useState<ForkWorkerVersionAcceptedDto | null>(null);
  const [createForm, setCreateForm] = useState<CreateRoleForm>(emptyCreateRoleForm);
  const [createError, setCreateError] = useState<string | null>(null);
  const [hashOpened, setHashOpened] = useState(false);

  const selectable = useMemo(() => selectableVersionOptions(workers), [workers]);
  const selectedOptionId = selection?.versionId ?? "";

  const reloadList = useCallback(
    async (nextQuery: LibraryQuery) => {
      if (!workerLibraryMethodsPresent(client)) {
        setApiReady(false);
        setLoading(false);
        setWorkers([]);
        setHasMore(false);
        setNextCursor(null);
        setListError(null);
        return;
      }
      setApiReady(true);
      setLoading(true);
      setListError(null);
      try {
        const page = await loadWorkerCatalog(client, nextQuery);
        setWorkers(page.workers);
        setHasMore(page.hasMore);
        setNextCursor(page.nextCursor);
      } catch (caught) {
        setWorkers([]);
        setHasMore(false);
        setNextCursor(null);
        setListError(libraryErrorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    void reloadList(query);
  }, [client, query, reloadList]);

  const openWorker = useCallback((worker: WorkerDto, versionId?: string, draftId?: string) => {
    const version = versionId
      ? (worker.versions ?? []).find((item) => item.id === versionId)
      : activeVersionOf(worker);
    const resolvedDraftId = draftId ?? activeDraftIdOf(worker);
    setSelection({
      workerId: worker.id,
      ...(version?.id !== undefined ? { versionId: version.id } : {}),
      ...(resolvedDraftId !== undefined ? { draftId: resolvedDraftId } : {}),
    });
    setDetailWorker(worker);
    setDetailVersion(version ?? null);
    setActionError(null);
  }, []);

  useEffect(() => {
    if (hashOpened || loading) {
      return;
    }
    const workerId = parseHashQuery(window.location.hash).get("worker");
    if (workerId === null || workerId.length === 0) {
      return;
    }
    const worker = workers.find((item) => item.id === workerId);
    if (worker !== undefined) {
      openWorker(worker);
      setHashOpened(true);
    }
  }, [hashOpened, loading, openWorker, workers]);

  useEffect(() => {
    if (selection === null) {
      setDetailWorker(null);
      setDetailVersion(null);
      setDetailDraft(null);
      setReferences(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    if (!workerLibraryMethodsPresent(client)) {
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void (async () => {
      try {
        const worker = await client.getWorker(selection.workerId);
        if (cancelled) {
          return;
        }
        setDetailWorker(worker);
        setWorkers((current) => replaceWorker(current, worker));
        const versionId = selection.versionId ?? activeVersionOf(worker)?.id;
        let version: WorkerVersionDto | null = null;
        if (versionId !== undefined) {
          version =
            (worker.versions ?? []).find((item) => item.id === versionId) ??
            (await client.getWorkerVersion(worker.id, versionId));
        }
        if (cancelled) {
          return;
        }
        setDetailVersion(version);
        if (version !== null && version.status === "published") {
          const refs = await client.getWorkerVersionReferences(worker.id, version.id);
          if (!cancelled) {
            setReferences(refs);
          }
        } else if (!cancelled) {
          setReferences(null);
        }
        const draftId = selection.draftId ?? activeDraftIdOf(worker);
        if (draftId !== undefined) {
          const draft = await client.getWorkerDraft(selection.workerId, draftId);
          if (!cancelled) {
            setDetailDraft(draft);
          }
        } else if (!cancelled) {
          setDetailDraft(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setDetailError(libraryErrorMessage(caught));
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, selection]);

  function applySearch(event?: FormEvent) {
    event?.preventDefault();
    setQuery((current) => ({ ...current, q: searchText }));
  }

  async function loadMore() {
    if (nextCursor === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await loadWorkerCatalog(client, query, nextCursor);
      setWorkers((current) => mergeWorkerPage(current, page.workers));
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      setListError(libraryErrorMessage(caught));
    } finally {
      setLoadingMore(false);
    }
  }

  async function createRole() {
    if (!createRoleFormValid(createForm)) {
      setCreateError(CREATE_ROLE_NEEDS_NAME_ROLE);
      return;
    }
    setActionBusy("create");
    setCreateError(null);
    setActionError(null);
    try {
      const worker = confirmCreatedDraft(
        await client.createWorker(createWorkerInputFromForm(createForm), libraryCommandOptions()),
      );
      setWorkers((current) => prependWorker(current, worker));
      setCreateForm(emptyCreateRoleForm());
      setForkNotice(null);
      openWorker(worker, undefined, activeDraftIdOf(worker));
    } catch (caught) {
      setCreateError(libraryErrorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function archiveSelected() {
    if (detailWorker === null || detailVersion === null) {
      return;
    }
    if (!canArchiveVersion(detailVersion)) {
      setActionError(ARCHIVE_NOT_PUBLISHED);
      return;
    }
    setActionBusy("archive");
    setActionError(null);
    try {
      const archived = confirmArchived(
        await client.archiveWorkerVersion(
          detailWorker.id,
          detailVersion.id,
          libraryCommandOptions(),
        ),
      );
      setDetailVersion(archived);
      setDetailWorker((current) =>
        current === null ? current : applyArchivedToWorker(current, archived, true),
      );
      setWorkers((current) => applyArchivedVersion(current, archived, query.includeArchived));
      setForkNotice(null);
    } catch (caught) {
      setActionError(libraryErrorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function forkSelected() {
    if (detailWorker === null || detailVersion === null) {
      return;
    }
    if (!canForkVersion(detailVersion)) {
      setActionError(FORK_NOT_PUBLISHED);
      return;
    }
    setActionBusy("fork");
    setActionError(null);
    try {
      const accepted = await client.forkWorkerVersion(
        detailWorker.id,
        detailVersion.id,
        libraryCommandOptions(),
      );
      let worker: WorkerDto | null = null;
      let draft: WorkerDraftDto | null = null;
      try {
        worker = await client.getWorker(accepted.workerId);
      } catch {
        worker = null;
      }
      try {
        draft = await client.getWorkerDraft(accepted.workerId, accepted.workerDraftId);
      } catch {
        draft = null;
      }
      const confirmed = confirmForkedDraft(accepted, worker, draft);
      setForkNotice(confirmed.accepted);
      if (confirmed.worker !== null) {
        const forkedWorker = confirmed.worker;
        setWorkers((current) => prependWorker(current, forkedWorker));
        setSelection({
          workerId: confirmed.accepted.workerId,
          draftId: confirmed.accepted.workerDraftId,
        });
        setDetailWorker(forkedWorker);
        setDetailVersion(null);
        setDetailDraft(confirmed.draft);
        setReferences(null);
      } else {
        setSelection({
          workerId: accepted.workerId,
          draftId: accepted.workerDraftId,
        });
      }
    } catch (caught) {
      setActionError(libraryErrorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function publishSelected() {
    if (detailWorker === null || detailDraft === null) {
      setActionError(PUBLISH_NOT_DRAFT);
      return;
    }
    if (!canPublishDraft(detailWorker, detailDraft)) {
      setActionError(PUBLISH_NOT_DRAFT);
      return;
    }
    setActionBusy("publish");
    setActionError(null);
    try {
      const published = confirmPublishedVersion(
        await client.publishWorkerDraft(
          detailWorker.id,
          detailDraft.id,
          libraryCommandOptions(detailDraft.revision),
        ),
      );
      const worker = await client.getWorker(detailWorker.id);
      setDetailWorker(worker);
      setWorkers((current) => replaceWorker(current, worker));
      setDetailVersion(published);
      setDetailDraft(null);
      setSelection({
        workerId: worker.id,
        versionId: published.id,
      });
      setForkNotice(null);
    } catch (caught) {
      setActionError(libraryErrorMessage(caught));
    } finally {
      setActionBusy(null);
    }
  }

  async function saveCard(form: CardForm) {
    if (detailWorker === null) {
      return;
    }
    if (detailDraft === null) {
      setActionError(
        isPublishedCardLocked(detailVersion)
          ? PUBLISHED_CARD_NOT_PATCHABLE
          : CARD_UNPUBLISHED_NO_DRAFT,
      );
      return;
    }
    if (!canPatchCardDraft(detailDraft)) {
      setActionError(DRAFT_NOT_EDITABLE);
      return;
    }
    setActionBusy("save");
    setActionError(null);
    try {
      const patched = confirmPatchedDraft(
        await client.patchWorkerDraft(
          detailWorker.id,
          detailDraft.id,
          cardWriteFromForm(form),
          libraryCommandOptions(detailDraft.revision),
        ),
      );
      setDetailDraft(patched);
    } catch (caught) {
      setActionError(
        isLibraryRevisionConflict(caught) ? DRAFT_REVISION_CONFLICT : libraryErrorMessage(caught),
      );
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <Page
      title="角色版本库"
      subtitle="我的 WorkerVersion：可在此新建 / 发布，详情必印谁 / 怎么干活 / 技能。草稿可改这三格；已发布只读，改走 fork。未发布不能当已发布员工。不挂项目，也没有商店。"
    >
      {apiReady ? null : (
        <Notice tone="warning" title="尚未接通">
          {LIBRARY_API_MISSING}
        </Notice>
      )}
      <CreateRoleCard
        form={createForm}
        error={createError}
        busy={actionBusy === "create"}
        disabled={!apiReady}
        onChange={setCreateForm}
        onSubmit={() => void createRole()}
      />
      <Card title="查找">
        <form onSubmit={applySearch}>
          <Field
            htmlFor="role-library-q"
            label="搜索"
            hint="按名称、职责或版本关键字搜已发布与草稿。"
          >
            <Input
              id="role-library-q"
              name="q"
              value={searchText}
              testId="role-library-search"
              placeholder="例如 Planner、reviewer"
              onChange={(event) => {
                setSearchText(event.target.value);
              }}
            />
          </Field>
          <Cluster>
            <Button type="submit" testId="role-library-search-submit">
              搜索
            </Button>
            <SegmentedControl
              ariaLabel="状态"
              items={STATUS_FILTER_ITEMS}
              value={query.status}
              onChange={(status) => {
                setQuery((current) => ({ ...current, status }));
              }}
            />
            <SegmentedControl
              ariaLabel="归档"
              items={ARCHIVED_FILTER_ITEMS}
              value={query.includeArchived ? "include" : "hide"}
              onChange={(id) => {
                setQuery((current) => ({ ...current, includeArchived: id === "include" }));
              }}
            />
          </Cluster>
        </form>
      </Card>
      <SelectablePicker
        options={selectable}
        value={selectedOptionId}
        onChange={(option) => {
          const worker = workers.find((item) => item.id === option.workerId);
          if (worker !== undefined) {
            openWorker(worker, option.version.id);
          }
        }}
      />
      <Card title="库">
        <ErrorText>{listError}</ErrorText>
        {loading ? <LoadingText /> : null}
        {!loading && workers.length === 0 && listError === null ? (
          <EmptyState title="没有匹配的角色" testId="role-library-empty">
            可在本页新建，或用 Chat 创建角色草稿。草稿不会出现在 Team 选用选择器里。现在没有商店可装。
          </EmptyState>
        ) : null}
        {workers.length > 0 ? (
          <List testId="role-library-list">
            {workers.map((worker) => {
              const badge = workerBadge(worker);
              return (
                <ListRow
                  key={worker.id}
                  testId={`role-library-row-${worker.id}`}
                  title={
                    <Cluster>
                      <span>{worker.name}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </Cluster>
                  }
                  meta={workerListMeta(worker)}
                  onClick={() => {
                    setForkNotice(null);
                    openWorker(worker);
                  }}
                />
              );
            })}
          </List>
        ) : null}
        {hasMore ? (
          <Button testId="role-library-more" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "加载中…" : "加载更多"}
          </Button>
        ) : null}
      </Card>
      {selection === null ? (
        <Card>
          <Muted>
            从列表或可选用版本打开一个 identity，查看角色卡片、引用关系，并归档、fork 或发布草稿。
          </Muted>
        </Card>
      ) : (
        <WorkerDetail
          worker={detailWorker}
          version={detailVersion}
          draft={detailDraft}
          references={references}
          loading={detailLoading}
          error={detailError}
          actionError={actionError}
          busy={actionBusy}
          forkNotice={forkNotice}
          onArchive={() => void archiveSelected()}
          onFork={() => void forkSelected()}
          onPublish={() => void publishSelected()}
          onSaveCard={(form) => void saveCard(form)}
          onOpenVersion={(version) => {
            if (detailWorker !== null) {
              setForkNotice(null);
              openWorker(detailWorker, version.id);
            }
          }}
        />
      )}
    </Page>
  );
}

function CreateRoleCard(props: {
  form: CreateRoleForm;
  error: string | null;
  busy: boolean;
  disabled: boolean;
  onChange: (form: CreateRoleForm) => void;
  onSubmit: () => void;
}): ReactNode {
  return (
    <Card title="新建角色" testId="role-library-create">
      <Muted>
        写入我的角色版本库，不挂 projectId，也不经 AuthoringSession。Runtime / Policy
        不是卡片必填，请入 Team 时再选。
      </Muted>
      <Field htmlFor="role-library-create-name" label="名称">
        <Input
          id="role-library-create-name"
          name="name"
          value={props.form.name}
          testId="role-library-create-name"
          disabled={props.disabled || props.busy}
          onChange={(event) => {
            props.onChange({ ...props.form, name: event.target.value });
          }}
        />
      </Field>
      <Field htmlFor="role-library-create-role" label="职责" hint="职责标签，不是 Worker 身份。">
        <Input
          id="role-library-create-role"
          name="role"
          value={props.form.role}
          testId="role-library-create-role"
          placeholder="例如 reviewer"
          disabled={props.disabled || props.busy}
          onChange={(event) => {
            props.onChange({ ...props.form, role: event.target.value });
          }}
        />
      </Field>
      {CARD_FIELDS.map((field) => (
        <Field
          key={field.id}
          htmlFor={`role-library-create-${field.id}`}
          label={field.label}
          hint={field.hint}
        >
          <Textarea
            id={`role-library-create-${field.id}`}
            name={field.id}
            rows={2}
            value={props.form[field.id]}
            testId={`role-library-create-${field.id}`}
            disabled={props.disabled || props.busy}
            onChange={(event) => {
              props.onChange({ ...props.form, [field.id]: event.target.value });
            }}
          />
        </Field>
      ))}
      <ErrorText>{props.error}</ErrorText>
      <Button
        variant="primary"
        testId="role-library-create-submit"
        disabled={props.disabled || props.busy || !createRoleFormValid(props.form)}
        onClick={props.onSubmit}
      >
        {props.busy ? "创建中…" : "写入未发布草稿"}
      </Button>
    </Card>
  );
}

function SelectablePicker(props: {
  options: ReturnType<typeof selectableVersionOptions>;
  value: string;
  onChange: (option: ReturnType<typeof selectableVersionOptions>[number]) => void;
}): ReactNode {
  return (
    <Card title="Team 可选用的已发布版本" testId="role-library-selector">
      <Muted>
        只列出已发布且未归档的 WorkerVersion，给项目 Team 选用时对照。这里不会写入 Team。归档后不会再出现；已有
        TeamVersion 引用仍然有效。
      </Muted>
      {props.options.length === 0 ? (
        <EmptyState title="没有可选用版本">未发布草稿和已归档版本都不会进入此选择器。</EmptyState>
      ) : (
        <Field htmlFor="role-library-select" label="可选用 WorkerVersion">
          <Select
            id="role-library-select"
            testId="role-library-select"
            value={props.value}
            onChange={(event) => {
              const next = props.options.find((item) => item.version.id === event.target.value);
              if (next !== undefined) {
                props.onChange(next);
              }
            }}
          >
            <option value="">选择已发布版本</option>
            {props.options.map((option) => (
              <option key={option.version.id} value={option.version.id}>
                {versionOptionLabel(option)}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Card>
  );
}
