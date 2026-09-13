import type {
  ForkWorkerVersionAcceptedDto,
  WorkerDraftDto,
  WorkerDto,
  WorkerVersionDto,
  WorkerVersionReferencesDto,
} from "@workforce/desktop-client";
import { useEffect, useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  Card,
  Cluster,
  ErrorText,
  Field,
  List,
  ListRow,
  LoadingText,
  Muted,
  Notice,
  Stack,
  StatusText,
  Textarea,
} from "../../components/ui.js";
import {
  canArchiveVersion,
  canForkVersion,
  canPatchCardDraft,
  canPublishDraft,
  CARD_DRAFT_HINT,
  CARD_EMPTY,
  CARD_FIELDS,
  CARD_READ_ONLY,
  CARD_UNPUBLISHED_NO_DRAFT,
  cardFieldDisplay,
  cardFieldText,
  cardFormDirty,
  cardSourceOf,
  emptyCardForm,
  isCardFieldEmpty,
  isPublishedCardLocked,
  isUnpublishedWorker,
  PUBLISH_NOT_DRAFT,
  referenceMeta,
  UNPUBLISHED_NOT_EMPLOYEE,
  versionBadge,
  workerBadge,
  type CardForm,
} from "./model.js";

export function WorkerDetail(props: {
  worker: WorkerDto | null;
  version: WorkerVersionDto | null;
  draft: WorkerDraftDto | null;
  references: WorkerVersionReferencesDto | null;
  loading: boolean;
  error: string | null;
  actionError: string | null;
  busy: "archive" | "fork" | "save" | "publish" | "create" | null;
  forkNotice: ForkWorkerVersionAcceptedDto | null;
  onArchive: () => void;
  onFork: () => void;
  onPublish: () => void;
  onSaveCard: (form: CardForm) => void;
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
  const canPublish = canPublishDraft(worker, props.draft);
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
        {unpublished ? (
          <>
            <ErrorText>{props.actionError}</ErrorText>
            <Button
              variant="primary"
              testId="role-library-publish"
              disabled={!canPublish || props.busy !== null}
              onClick={props.onPublish}
            >
              {props.busy === "publish" ? "发布中…" : "发布草稿"}
            </Button>
            {!canPublish ? <Muted>{PUBLISH_NOT_DRAFT}</Muted> : null}
          </>
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
      <RoleCard
        draft={props.draft}
        version={props.version}
        actionError={props.draft !== null || props.version === null ? props.actionError : null}
        busy={props.busy === "save"}
        onSave={props.onSaveCard}
      />
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
  busy: "archive" | "fork" | "save" | "publish" | "create" | null;
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
          ? ` · runtime ${props.version.runtimeProfileId}（执行绑定，不是卡片必填）`
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

function RoleCard(props: {
  draft: WorkerDraftDto | null;
  version: WorkerVersionDto | null;
  actionError: string | null;
  busy: boolean;
  onSave: (form: CardForm) => void;
}): ReactNode {
  const editable = canPatchCardDraft(props.draft);
  const locked = isPublishedCardLocked(props.version) && !editable;
  const source = cardSourceOf(props.draft, props.version);
  return (
    <Card title="角色卡片" testId="role-library-card">
      {editable && props.draft !== null ? (
        <RoleCardEditor
          draft={props.draft}
          busy={props.busy}
          error={props.actionError}
          onSave={props.onSave}
        />
      ) : (
        <RoleCardReadout source={source} locked={locked} missingDraft={props.draft === null} />
      )}
    </Card>
  );
}

function RoleCardReadout(props: {
  source: ReturnType<typeof cardSourceOf>;
  locked: boolean;
  missingDraft: boolean;
}): ReactNode {
  return (
    <>
      {props.locked ? (
        <Notice tone="info" title="已发布只读">
          {CARD_READ_ONLY}
        </Notice>
      ) : null}
      {!props.locked && props.missingDraft ? <Muted>{CARD_UNPUBLISHED_NO_DRAFT}</Muted> : null}
      <dl className="wf-detail-grid" data-testid="role-library-card-fields">
        {CARD_FIELDS.map((field) => {
          const value = cardFieldText(props.source, field.id);
          const empty = isCardFieldEmpty(value);
          return (
            <RoleCardField key={field.id} fieldId={field.id} label={field.label} empty={empty}>
              {empty ? <Muted>{cardFieldDisplay(value)}</Muted> : cardFieldDisplay(value)}
            </RoleCardField>
          );
        })}
      </dl>
    </>
  );
}

function RoleCardField(props: {
  fieldId: string;
  label: string;
  empty: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <dt>{props.label}</dt>
      <dd
        data-testid={`role-library-card-${props.fieldId}`}
        data-empty={props.empty ? "true" : "false"}
      >
        {props.children}
      </dd>
    </>
  );
}

function RoleCardEditor(props: {
  draft: WorkerDraftDto;
  busy: boolean;
  error: string | null;
  onSave: (form: CardForm) => void;
}): ReactNode {
  const [form, setForm] = useState(() => emptyCardForm(props.draft));
  useEffect(() => {
    setForm(emptyCardForm(props.draft));
  }, [props.draft.id, props.draft.revision, props.draft.who, props.draft.how, props.draft.skills]);
  const dirty = cardFormDirty(form, props.draft);
  return (
    <>
      <Muted>{CARD_DRAFT_HINT}</Muted>
      {CARD_FIELDS.map((field) => (
        <Field
          key={field.id}
          htmlFor={`role-library-card-${field.id}`}
          label={field.label}
          hint={field.hint}
        >
          <Textarea
            id={`role-library-card-${field.id}`}
            name={field.id}
            rows={3}
            value={form[field.id]}
            testId={`role-library-card-${field.id}-input`}
            placeholder={CARD_EMPTY}
            disabled={props.busy}
            onChange={(event) => {
              const next = event.target.value;
              setForm((current) => ({ ...current, [field.id]: next }));
            }}
          />
        </Field>
      ))}
      <ErrorText>{props.error}</ErrorText>
      <Button
        variant="primary"
        testId="role-library-card-save"
        disabled={props.busy || !dirty}
        onClick={() => {
          props.onSave(form);
        }}
      >
        {props.busy ? "保存中…" : "保存卡片"}
      </Button>
    </>
  );
}
