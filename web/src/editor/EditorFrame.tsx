// The page every resource is viewed and edited in. A stored object opens LOCKED: its values read as
// full-contrast text and nothing changes until Edit (or `e`); Save and Discard lock it again. A new
// object (or a copy) starts unlocked. Tabs come from the registry, plus the frame's own JSON tab.
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router';
import { queryKeys, scopedKey, useAllPlugins, useClient, useInvalidate, useItem } from '../api/hooks';
import { stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { useMarkReadOnly, useReadOnlyKey } from '../api/write';
import { t } from '../i18n';
import { DeleteResourceDialog, ViewJsonDialog } from '../pages/RowActions';
import { registry, useCtx, type TabProps } from '../resources/registry';
import { isEnabled } from '../resources/resolve';
import { newPathFor, pathFor } from '../router/paths';
import { Input, LockProvider, Tabs, toast } from '../ui';
import { ConflictDialog } from './ConflictDialog';
import { DiscardDialog } from './DiscardDialog';
import { deepEqual, setPath, useDraft } from './draft';
import { EditorHeader } from './EditorHeader';
import { issuesByTab, propertyOfError, tabOfIssue, type Issue } from './issues';
import { JsonErrorContext } from './json';
import { JsonTab } from './JsonTab';
import { saveResource } from './save';
import { backOf } from './back';
import { EditorSkeleton, LoadErrorState, NotFoundState } from './states';
import { useEditorKeys } from './useEditorKeys';
import { useLeaveGuard } from './useLeaveGuard';
import { useTabParam } from './useTabParam';
import './editor.css';

/** The frame's own tab, after the kind's tabs. Registry tabs must not use this id. */
export const JSON_TAB = 'json';

export interface EditorFrameProps {
  kind: Kind;
  /** A stored object to load; undefined to create one. */
  id?: string;
  parent?: Parent;
  /** Create a copy of this item: its value without the id, timestamps and (consumers) username, " copy" added to the name. */
  duplicateFrom?: Item;
  /** For a new object: merged over registry[kind].blank(). */
  initial?: Obj;
}

/** What the draft is made of: the stored value without the timestamps APISIX refuses on save. */
const valueOf = (item: Item): Obj => stripTimestamps(item.value);

/** A new object's baseline (what "unchanged" means) and its starting draft. */
function startOf(kind: Kind, duplicateFrom?: Item, initial?: Obj): { baseline: Obj; draft: Obj } {
  if (!duplicateFrom) {
    const blank = { ...registry[kind].blank(), ...initial };
    return { baseline: blank, draft: blank };
  }
  const source = valueOf(duplicateFrom);
  const copy: Obj = { ...source };
  delete copy.id;
  if (kind === 'consumers') delete copy.username;
  if (typeof copy.name === 'string' && copy.name !== '') copy.name = t('editor.copyName', { name: copy.name });
  return { baseline: source, draft: copy };
}

export const EditorFrame: FC<EditorFrameProps> = ({ kind, id, parent, duplicateFrom, initial }) =>
  id === undefined ? (
    <Editor kind={kind} parent={parent} start={startOf(kind, duplicateFrom, initial)} copyOf={duplicateFrom} />
  ) : (
    <StoredEditor kind={kind} id={id} parent={parent} />
  );

/** Loads the object, then edits it; the loading, not-found and failed states in between. */
function StoredEditor({ kind, id, parent }: { kind: Kind; id: string; parent?: Parent }) {
  const query = useItem(kind, id, parent);
  if (query.data) return <Editor kind={kind} id={id} parent={parent} item={query.data} />;
  if (query.error?.status === 404) return <NotFoundState kind={kind} id={id} parent={parent} />;
  if (query.error) return <LoadErrorState kind={kind} id={id} error={query.error} retrying={query.isFetching} onRetry={() => void query.refetch()} />;
  return <EditorSkeleton kind={kind} />;
}

interface EditorProps {
  kind: Kind;
  id?: string;
  parent?: Parent;
  /** The stored object as the query has it now (it may refresh in the background); undefined when creating. */
  item?: Item;
  start?: { baseline: Obj; draft: Obj };
  copyOf?: Item;
}

/** APISIX's refusal of the last save: its message, and the top-level property it names. */
interface Failure {
  message: string;
  property?: string;
}

function Editor({ kind, id, parent, item, start, copyOf }: EditorProps) {
  const def = registry[kind];
  const isNew = item === undefined;
  const client = useClient();
  const ctx = useCtx();
  const plugins = useAllPlugins().data;
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const readOnly = useReadOnlyKey();
  const markReadOnly = useMarkReadOnly();

  const [original, setOriginal] = useState(item);
  const { draft, setDraft, dirty, reset, baseline } = useDraft(item ? valueOf(item) : (start?.baseline ?? {}), item ? undefined : start?.draft);
  const [locked, setLocked] = useState(!isNew);
  const [newId, setNewId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [conflict, setConflict] = useState<Item>();
  const [jsonError, setJsonError] = useState<string>();
  const [dialog, setDialog] = useState<'json' | 'delete' | 'discard'>();
  const editRef = useRef<HTMLButtonElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Where focus goes after the next lock change made by the user. */
  const focusNext = useRef<'edit' | 'field' | undefined>(undefined);

  // A background refresh shows on a locked, unchanged page; while editing, the save's conflict check handles it.
  const [seen, setSeen] = useState(item);
  if (item !== seen) {
    setSeen(item);
    if (item && locked && !dirty && item.modifiedIndex !== original?.modifiedIndex) {
      setOriginal(item);
      reset(valueOf(item));
    }
  }

  const name = isNew ? t('page.new', { kind: def.singular }) : def.nameOf({ id: id ?? '', value: draft });
  const back = backOf(kind, parent);
  const listPath = back.to;
  // A typed ID is work to lose as well, though it is not part of the draft.
  const unsaved = dirty || (isNew && newId !== '');
  const guard = useLeaveGuard(unsaved);

  // --- Issues ------------------------------------------------------------------------------------
  const env = useMemo(() => ({ isNew, ctx, plugins }), [isNew, ctx, plugins]);
  const checked = useMemo(() => def.validate?.(draft, env) ?? [], [def, draft, env]);
  const typedId = typeof draft.id === 'string' || typeof draft.id === 'number' ? String(draft.id) : undefined;
  const frameIssues = useMemo(() => {
    const list: Issue[] = [];
    if (!isNew && id !== undefined) {
      const own = def.idFromDraft ? def.idFromDraft(draft) : typedId;
      if (own !== undefined && own !== id) list.push({ path: def.idFromDraft ? '' : 'id', message: t('editor.id.changed', { id, kind: def.singular }) });
    }
    if (isNew && !def.idFromDraft && newId.trim() !== '' && typedId !== undefined && typedId !== newId.trim()) {
      list.push({ path: 'id', message: t('editor.id.mismatch', { json: typedId, id: newId.trim() }) });
    }
    return list;
  }, [def, draft, id, isNew, newId, typedId]);
  const issues = useMemo(() => [...checked, ...frameIssues], [checked, frameIssues]);
  // A new object's id: the ID field, else an id typed into the JSON (POST refuses an id in the body).
  const createId = newId.trim() || typedId;
  const idMissing = isNew && !def.idFromDraft && def.idMode !== 'optional' && createId === undefined;

  const tabFields = useMemo(() => def.tabs.map((tab) => ({ id: tab.id, fields: tab.fields })), [def]);
  const tabIds = [...def.tabs.map((tab) => tab.id), JSON_TAB];
  const byTab = useMemo(() => issuesByTab(issues, tabFields, JSON_TAB), [issues, tabFields]);
  const failureIssue: Issue | undefined = failure?.property !== undefined ? { path: failure.property, message: failure.message } : undefined;
  const failureTab = failureIssue && tabOfIssue(failureIssue, tabFields, JSON_TAB);
  const problems = issues.length + (idMissing ? 1 : 0) + (jsonError !== undefined ? 1 : 0);

  // --- Tabs --------------------------------------------------------------------------------------
  const [requested, setTab] = useTabParam();
  const active = requested !== null && tabIds.includes(requested) ? requested : (tabIds[0] ?? JSON_TAB);

  // --- Lock and focus ------------------------------------------------------------------------------
  function lock() {
    focusNext.current = 'edit';
    setLocked(true);
    setAttempted(false);
    setFailure(undefined);
  }

  function unlock() {
    if (readOnly) return;
    focusNext.current = 'field';
    setLocked(false);
  }

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = undefined;
    if (target === 'edit') editRef.current?.focus();
    else if (target === 'field') bodyRef.current?.querySelector<HTMLElement>('input, textarea, select, button[role="switch"], .cm-content')?.focus();
  }, [locked]);

  // --- Save --------------------------------------------------------------------------------------
  async function save(force = false) {
    if (saving || locked) return;
    if (problems > 0) {
      setAttempted(true);
      toast.error(problems === 1 ? t('editor.fixOne') : t('editor.fixMany', { count: problems }));
      const first = jsonError !== undefined ? JSON_TAB : tabIds.find((tab) => byTab.has(tab));
      if (first) setTab(first);
      else if (idMissing) idRef.current?.focus();
      return;
    }
    if (!isNew && !dirty && !force) {
      lock();
      toast.info(t('editor.nothingToSave'));
      return;
    }
    setSaving(true);
    setFailure(undefined);
    const result = await saveResource(client, { kind, id: isNew ? createId : id, isNew, draft, original, parent, force });
    setSaving(false);

    if (result.ok) {
      const saved = result.item;
      queryClient.setQueryData(scopedKey(client.conn.id, queryKeys.item(kind, saved.id, parent)), saved);
      void invalidate(kind, parent);
      if (kind === 'consumers') void invalidate('credentials');
      const savedName = def.nameOf(saved);
      if (isNew) {
        toast.success(t('editor.created', { name: savedName }));
        guard.leaveFreely();
        void navigate(pathFor(kind, saved.id, parent), { replace: true });
      } else {
        toast.success(t('editor.saved', { name: savedName }));
        setOriginal(saved);
        reset(valueOf(saved));
        lock();
      }
    } else if ('conflict' in result) {
      setConflict(result.conflict);
    } else {
      const { error } = result;
      if (error.kind === 'auth') markReadOnly();
      const property = propertyOfError(error.errorMsg);
      setFailure({ message: error.errorMsg ?? error.message, property });
      if (property !== undefined) setTab(tabOfIssue({ path: property, message: '' }, tabFields, JSON_TAB));
    }
  }

  function discard() {
    if (isNew) {
      // The leave guard asks when there is something to lose.
      void navigate(listPath);
      return;
    }
    if (dirty) setDialog('discard');
    else lock();
  }

  function reloadTheirs(theirs: Item) {
    setConflict(undefined);
    queryClient.setQueryData(scopedKey(client.conn.id, queryKeys.item(kind, theirs.id, parent)), theirs);
    setOriginal(theirs);
    reset(valueOf(theirs));
    lock();
    toast.info(t('editor.conflict.reloaded', { name: def.nameOf(theirs) }));
  }

  useEditorKeys({ locked, canEdit: !readOnly, onEdit: unlock, onSave: () => void save() });

  // --- Tabs' content -----------------------------------------------------------------------------
  const tabProps = (tab: string): TabProps => ({
    draft,
    setDraft,
    kind,
    isNew,
    ctx,
    parent,
    original,
    issues: [...(byTab.get(tab) ?? []), ...(failureIssue && failureTab === tab && tab !== JSON_TAB ? [failureIssue] : [])],
  });
  const changedHere = (fields: string[]) => fields.some((field) => !deepEqual(draft[field], baseline[field]));
  const label = (text: string, changed: boolean) => (
    <>
      {text}
      {changed && <span className="ed-dot" aria-hidden="true" />}
    </>
  );
  const badge = (tab: string) =>
    (byTab.get(tab)?.length ?? 0) + (failureTab === tab ? 1 : 0) + (tab === JSON_TAB && jsonError !== undefined ? 1 : 0);
  // Only the active panel is mounted, so only its content is built.
  const tabs = [
    ...def.tabs.map((tab) => ({
      id: tab.id,
      label: label(tab.label, changedHere(tab.fields)),
      badge: badge(tab.id),
      content: tab.id === active ? tab.render(tabProps(tab.id)) : null,
    })),
    { id: JSON_TAB, label: label(t('editor.json.tab'), dirty), badge: badge(JSON_TAB), content: active === JSON_TAB ? <JsonTab {...tabProps(JSON_TAB)} /> : null },
  ];

  const status = def.hasStatus
    ? { enabled: isEnabled(draft), name, onChange: (on: boolean) => setDraft(setPath(draft, ['status'], on ? 1 : 0)) }
    : undefined;

  return (
    <div className="ed">
      <EditorHeader
        title={name}
        id={isNew ? undefined : id}
        back={back}
        locked={locked}
        isNew={isNew}
        dirty={unsaved}
        original={original}
        note={copyOf ? t('editor.copyOf', { kind: def.singular, name: def.nameOf(copyOf) }) : undefined}
        status={status}
        readOnly={readOnly}
        saving={saving}
        saveBlocked={jsonError !== undefined}
        editRef={editRef}
        onEdit={unlock}
        onSave={() => void save()}
        onDiscard={discard}
        onDuplicate={() => id !== undefined && void navigate(`${newPathFor(kind, parent)}?from=${encodeURIComponent(id)}`)}
        onViewJson={() => setDialog('json')}
        onDelete={() => setDialog('delete')}
      />
      <div className="ed-body" ref={bodyRef}>
        {failure && (
          <div className="ed-banner" role="alert">
            <CircleAlert size={16} aria-hidden="true" />
            <div className="ed-banner__text">
              <p className="ed-banner__title">{t('editor.rejected')}</p>
              <p className="ed-banner__message mono">{failure.message}</p>
            </div>
          </div>
        )}
        {isNew && !def.idFromDraft && (
          <div className="ed-newid">
            <Input
              ref={idRef}
              label={t('editor.id.label')}
              mono
              required={def.idMode !== 'optional'}
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              help={def.idMode === 'optional' ? t('editor.id.optional') : t('editor.id.requiredHelp')}
              error={attempted && idMissing ? t('editor.id.required') : undefined}
            />
          </div>
        )}
        <LockProvider locked={locked}>
          <JsonErrorContext value={setJsonError}>
            <Tabs tabs={tabs} active={active} onChange={setTab} />
          </JsonErrorContext>
        </LockProvider>
      </div>

      <DiscardDialog open={guard.blocked} name={name} onConfirm={guard.leave} onCancel={guard.stay} />
      <DiscardDialog
        open={dialog === 'discard'}
        name={name}
        onConfirm={() => {
          setDialog(undefined);
          reset();
          lock();
        }}
        onCancel={() => setDialog(undefined)}
      />
      {conflict && original && (
        <ConflictDialog
          kind={def.singular}
          name={name}
          loaded={original.value}
          theirs={conflict.value}
          onOverwrite={() => {
            setConflict(undefined);
            void save(true);
          }}
          onReload={() => reloadTheirs(conflict)}
          onCancel={() => setConflict(undefined)}
        />
      )}
      {original && dialog === 'json' && (
        <ViewJsonDialog open onClose={() => setDialog(undefined)} title={t('json.title', { kind: def.singular, name })} value={original.value} />
      )}
      {original && dialog === 'delete' && (
        <DeleteResourceDialog
          open
          kind={kind}
          item={original}
          parent={parent}
          ctx={ctx}
          onClose={() => setDialog(undefined)}
          onDeleted={() => {
            guard.leaveFreely();
            void navigate(listPath);
          }}
        />
      )}
    </div>
  );
}
