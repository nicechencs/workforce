import type {
  ForkWorkerVersionAcceptedDto,
  WorkerDraftDto,
  WorkerDto,
  WorkerVersionDto,
  WorkerVersionReferencesDto,
} from "@workforce/desktop-client";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

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
  Stack,
  StatusText,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import {
  activeVersionOf,
  applyArchivedToWorker,
  applyArchivedVersion,
  ARCHIVED_FILTER_ITEMS,
  ARCHIVE_NOT_PUBLISHED,
  canArchiveVersion,
  canForkVersion,
  confirmArchived,
  confirmForkedDraft,
  emptyLibraryQuery,
  FORK_NOT_PUBLISHED,
  LIBRARY_API_MISSING,
  libraryCommandOptions,
  libraryErrorMessage,
  isUnpublishedWorker,
  loadWorkerCatalog,
  mergeWorkerPage,
  prependWorker,
  referenceMeta,
  replaceWorker,
  selectableVersionOptions,
  STATUS_FILTER_ITEMS,
  UNPUBLISHED_NOT_EMPLOYEE,
  versionBadge,
  versionOptionLabel,
  workerBadge,
  workerLibraryMethodsPresent,
  workerListMeta,
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
  const [actionBusy, setActionBusy] = useState<"archive" | "fork" | null>(null);
  const [forkNotice, setForkNotice] = useState<ForkWorkerVersionAcceptedDto | null>(null);

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
    setSelection({
      workerId: worker.id,
      ...(version?.id !== undefined ? { versionId: version.id } : {}),
      ...(draftId !== undefined ? { draftId } : {}),
    });
    setDetailWorker(worker);
    setDetailVersion(version ?? null);
    setActionError(null);
  }, []);

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
        if (selection.draftId !== undefined) {
          const draft = await client.getWorkerDraft(selection.workerId, selection.draftId);
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

  return (
    <Page
      title="角色版本库"
      subtitle="我的 WorkerVersion：找、搜、看 TeamVersion 引用、归档、选用、fork。未发布不能当已发布员工。"
    >
      {apiReady ? null : (
        <Notice tone="warning" title="尚未接通">
          {LIBRARY_API_MISSING}
        </Notice>
      )}
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
            没有已发布版本或草稿。草稿不会出现在选用选择器里。
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
          <Muted>从列表或选用选择器打开一个版本，查看引用关系并归档或 fork。</Muted>
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

function SelectablePicker(props: {
  options: ReturnType<typeof selectableVersionOptions>;
  value: string;
  onChange: (option: ReturnType<typeof selectableVersionOptions>[number]) => void;
}): ReactNode {
  return (
    <Card title="给 Team 选用" testId="role-library-selector">
      <Muted>
        只列出已发布且未归档的 WorkerVersion。归档后不会再出现在这里；已有 TeamVersion
        引用仍然有效。
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

function WorkerDetail(props: {
  worker: WorkerDto | null;
  version: WorkerVersionDto | null;
  draft: WorkerDraftDto | null;
  references: WorkerVersionReferencesDto | null;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  busy: "archive" | "fork" | null;
  forkNotice: ForkWorkerVersionAcceptedDto | null;
  onArchive: () => void;
  onFork: () => void;
  onOpenVersion: (version: WorkerVersionDto) => void;
}): ReactNode {
  const worker = props.worker;
  if (worker === null) {
    return (
      <Card title="详情">
        {props.loading ? <LoadingText /> : null}
        <ErrorText>{props.error}</ErrorText>
      </Card>
    );
  }
  const unpublished = isUnpublishedWorker(worker);
  const badge = workerBadge(worker);
  return (
    <Stack>
      <Card title={worker.name} testId="role-library-detail">
        {props.loading ? <LoadingText /> : null}
        <ErrorText>{props.error}</ErrorText>
        <Cluster>
          <Badge tone={badge.tone}>{badge.label}</Badge>
          <Muted>{worker.id}</Muted>
        </Cluster>
        {worker.description !== undefined ? <Muted>{worker.description}</Muted> : null}
        {unpublished ? (
          <Notice tone="warning" title="未发布">
            {UNPUBLISHED_NOT_EMPLOYEE}
          </Notice>
        ) : null}
        {props.draft !== null ? (
          <Muted>
            草稿 {props.draft.id} · revision {props.draft.revision} · 职责 {props.draft.role}
          </Muted>
        ) : null}
        {props.forkNotice !== null ? (
          <Notice tone="info" title="已 fork 出新草稿">
            新 identity {props.forkNotice.workerId}，草稿 {props.forkNotice.workerDraftId}
            。源版本 {props.forkNotice.forkedFromWorkerVersionId}{" "}
            未改。新草稿尚未发布，不能当已发布员工。
          </Notice>
        ) : null}
        {(worker.versions ?? []).length > 0 ? (
          <>
            <h2 className="wf-section-title">版本</h2>
            <List testId="role-library-versions">
              {(worker.versions ?? []).map((version) => {
                const status = versionBadge(version);
                return (
                  <ListRow
                    key={version.id}
                    testId={`role-library-version-${version.id}`}
                    title={
                      <Cluster>
                        <span>
                          {version.name} {version.version}
                        </span>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </Cluster>
                    }
                    meta={`${version.role} · ${version.id}`}
                    onClick={() => {
                      props.onOpenVersion(version);
                    }}
                  />
                );
              })}
            </List>
          </>
        ) : (
          <Muted>此 identity 还没有已发布 WorkerVersion。</Muted>
        )}
      </Card>
      {props.version !== null ? (
        <VersionPanel
          version={props.version}
          references={props.references}
          actionError={props.actionError}
          busy={props.busy}
          onArchive={props.onArchive}
          onFork={props.onFork}
        />
      ) : null}
    </Stack>
  );
}

function VersionPanel(props: {
  version: WorkerVersionDto;
  references: WorkerVersionReferencesDto | null;
  actionError: string | null;
  busy: "archive" | "fork" | null;
  onArchive: () => void;
  onFork: () => void;
}): ReactNode {
  const status = versionBadge(props.version);
  const selectable = status.tone === "success";
  const unpublished = !canForkVersion(props.version);
  const refs = props.references?.teamVersions ?? [];
  return (
    <Card title="WorkerVersion" testId="role-library-version">
      <Cluster>
        <Badge tone={status.tone}>{status.label}</Badge>
        <StatusText tone={selectable ? "success" : "warning"}>
          {selectable ? "选择器可提供" : "选择器不提供"}
        </StatusText>
      </Cluster>
      <Muted>
        {props.version.id} · 职责 {props.version.role}
        {props.version.runtimeProfileId !== undefined
          ? ` · runtime ${props.version.runtimeProfileId}`
          : ""}
      </Muted>
      {unpublished ? <Notice tone="warning">{UNPUBLISHED_NOT_EMPLOYEE}</Notice> : null}
      {props.version.archived ? (
        <Notice tone="info" title="已归档">
          选择器不再提供该版本。已经引用它的 TeamVersion 仍然有效。
        </Notice>
      ) : null}
      <h2 className="wf-section-title">被哪些 TeamVersion 引用</h2>
      {refs.length === 0 ? (
        <Muted>没有 TeamVersion 引用此版本。</Muted>
      ) : (
        <List testId="role-library-references">
          {refs.map((item) => (
            <ListRow
              key={`${item.teamId}:${item.teamVersionId}`}
              title={item.teamVersionId}
              meta={referenceMeta(item)}
            />
          ))}
        </List>
      )}
      <ErrorText>{props.actionError}</ErrorText>
      <Cluster>
        <Button
          testId="role-library-archive"
          disabled={!canArchiveVersion(props.version) || props.busy !== null}
          onClick={props.onArchive}
        >
          {props.busy === "archive" ? "归档中…" : "归档"}
        </Button>
        <Button
          testId="role-library-fork"
          disabled={!canForkVersion(props.version) || props.busy !== null}
          onClick={props.onFork}
        >
          {props.busy === "fork" ? "fork 中…" : "fork 新草稿"}
        </Button>
      </Cluster>
      {!canArchiveVersion(props.version) && canForkVersion(props.version) ? (
        <Muted>已归档版本不能再被新 Team 选用，仍可 fork 出新草稿。</Muted>
      ) : null}
    </Card>
  );
}
