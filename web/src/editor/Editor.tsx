// The editor itself, for a loaded object or a new one (EditorFrame.tsx picks which). A stored object
// opens LOCKED: its values read as full-contrast text and nothing changes until Edit (or `e`); Save
// and Discard lock it again. A new object (or a copy) starts unlocked.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { queryKeys, scopedKey, useAllPlugins, useClient, useInvalidate } from '../api/hooks';
import { stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, Parent } from '../api/types';
import { useMarkReadOnly, useReadOnlyKey } from '../api/write';
import { t } from '../i18n';
import type { RemovedSecret } from '../plugins/auth';
import { scopeOfKind } from '../plugins/scope';
import { registry, useCtx, type TabProps } from '../resources/registry';
import { findInCtx, isEnabled } from '../resources/resolve';
import { newPathFor, pathFor } from '../router/paths';
import { LockProvider, PendingProvider, Tabs, toast } from '../ui';
import { backOf, ownerPath } from './back';
import { EditorDialogs } from './EditorDialogs';
import { deepEqual, setPath, useDraft } from './draft';
import { EditorHeader } from './EditorHeader';
import { takenFailure, uncheckedFailure, type Failure } from './failure';
import { FailureBanner } from './FailureBanner';
import { idIssues, issuesByTab, pathOfError, tabOfIssue, type Issue } from './issues';
import { JSON_TAB } from './json';
import { JsonTab } from './JsonTab';
import { NewIdField } from './NewIdField';
import { saveResource } from './save';
import { useEditorKeys } from './useEditorKeys';
import { useActiveTab } from './useActiveTab';
import { useLeaveGuard } from './useLeaveGuard';
import { useSaveRequest } from './useSaveRequest';
import { useShownTabs } from './useShownTabs';

/** What the draft is made of: the stored value without the timestamps APISIX refuses on save. */
const valueOf = (item: Item): Obj => stripTimestamps(item.value);

export interface EditorProps {
  kind: Kind;
  id?: string;
  parent?: Parent;
  /** The stored object as the query has it now (it may refresh in the background); undefined when creating. */
  item?: Item;
  start?: { baseline: Obj; draft: Obj; removed?: RemovedSecret[] };
  copyOf?: Item;
}


export function Editor({ kind, id, parent, item, start, copyOf }: EditorProps) {
  const def = registry[kind];
  const isNew = item === undefined;
  const copyRemoved = start?.removed;
  const client = useClient();
  const ctx = useCtx();
  const plugins = useAllPlugins().data;
  // The stream set only for kinds whose plugins run in the stream subsystem; for the others this
  // asks for the http set again, which the query cache answers.
  const streamKind = scopeOfKind[kind] === 'stream_route';
  const streamSet = useAllPlugins(streamKind ? 'stream' : undefined).data;
  const streamPlugins = streamKind ? streamSet : undefined;
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const readOnly = useReadOnlyKey();
  const markReadOnly = useMarkReadOnly();

  const [original, setOriginal] = useState(item);
  const { draft, setDraft, dirty, reset, baseline } = useDraft(item ? valueOf(item) : (start?.baseline ?? {}), item ? undefined : start?.draft);
  const [locked, setLocked] = useState(!isNew);
  const [newId, setNewId] = useState('');
  /** Saves blocked by problems since the last lock. */
  const [saveAttempts, setSaveAttempts] = useState(0);
  const attempted = saveAttempts > 0;
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [conflict, setConflict] = useState<Item>();
  const [dialog, setDialog] = useState<'json' | 'delete' | 'discard'>();
  /**
   * Bumped by Discard (and reloading theirs): remounts the tab area, so nothing a field held without
   * putting it in the draft (text that never parsed, a flagged node address) outlives it. A save
   * happens only when nothing is held, so it locks without a remount: the tab, the open cards and
   * the scroll position stay as they were.
   */
  const [epoch, setEpoch] = useState(0);
  /**
   * Bumped on every lock: the end of an editing session, after which what fields keep for one
   * (useEditingState: a key being replaced, rows being typed) starts over. A save in flight locks
   * the fields too, but is not the end of one.
   */
  const [session, setSession] = useState(0);
  const editRef = useRef<HTMLButtonElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** Where focus goes after the next lock change made by the user. */
  const focusNext = useRef<'edit' | 'field' | undefined>(undefined);
  /** False once the page is gone: a create answered after that must not navigate back to it. */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The draft changes only while editing and not saving (what is typed during a save would be
  // replaced by the saved object). The tab area is locked meanwhile as well; this is the backstop.
  const editable = !locked && !saving;
  const edit = useCallback(
    (next: Obj) => {
      if (editable) setDraft(next);
    },
    [editable, setDraft],
  );

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

  // --- Issues ------------------------------------------------------------------------------------
  const env = useMemo(() => ({ isNew, ctx, plugins, streamPlugins }), [isNew, ctx, plugins, streamPlugins]);
  const checked = useMemo(() => def.validate?.(draft, env) ?? [], [def, draft, env]);
  const typedId = typeof draft.id === 'string' || typeof draft.id === 'number' ? String(draft.id) : undefined;
  const frameIssues = useMemo(() => idIssues(def, draft, { id, isNew, newId, typedId }), [def, draft, id, isNew, newId, typedId]);
  const issues = useMemo(() => [...checked, ...frameIssues], [checked, frameIssues]);
  // A new object's id: the body field for kinds that have one (a consumer's username); else the ID
  // field, else an id typed into the JSON (POST refuses an id in the body).
  const createId = def.idFromDraft ? def.idFromDraft(draft) : newId.trim() || typedId;
  const idMissing = isNew && !def.idFromDraft && def.idMode !== 'optional' && createId === undefined;

  const shownTabs = useShownTabs(def.tabs);
  const tabFields = useMemo(() => shownTabs.map((tab) => ({ id: tab.id, fields: tab.fields })), [shownTabs]);
  const tabIds = [...shownTabs.map((tab) => tab.id), JSON_TAB];
  const byTab = useMemo(() => issuesByTab(issues, tabFields, JSON_TAB), [issues, tabFields]);
  // A taken id is an issue only while the draft still holds that id (a consumer's username is a field).
  const failureIssue = useMemo<Issue | undefined>(
    () => (failure?.path !== undefined && (failure.taken === undefined || failure.taken === createId) ? { path: failure.path, message: failure.message } : undefined),
    [failure, createId],
  );
  const failureTab = failureIssue && tabOfIssue(failureIssue, tabFields, JSON_TAB);

  // --- Tabs --------------------------------------------------------------------------------------
  const tabState = useActiveTab(tabIds, bodyRef);
  const { active, pending, goTab } = tabState;
  const problems = issues.length + (idMissing ? 1 : 0) + pending.length;
  // A typed ID and input a field holds (JSON text that doesn't parse, …) are work to lose as well,
  // though not in the draft.
  const unsaved = dirty || (isNew && newId !== '') || pending.length > 0;
  // Leaving the page asks while there is unsaved work; a tab change through the URL (Back, a link
  // to ?tab=) asks, as a chosen tab does, while the active tab holds input. Either is judged once
  // the field being typed in is left.
  const guard = useLeaveGuard(unsaved, { settle: tabState.leaveField, holdsTab: tabState.holdsTab });

  // --- Lock and focus ------------------------------------------------------------------------------
  /** Locks the page; `remount` (Discard) throws away what the fields hold, by remounting them. */
  function lock(remount: boolean) {
    focusNext.current = 'edit';
    setLocked(true);
    setSession((n) => n + 1);
    if (remount) {
      setEpoch((n) => n + 1);
      tabState.dropPending();
    }
    setSaveAttempts(0);
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
  async function save(force = false, left?: HTMLElement) {
    if (saving || locked) return;
    if (problems > 0) {
      setSaveAttempts((n) => n + 1);
      const fix = problems === 1 ? t('editor.fixOne') : t('editor.fixMany', { count: problems });
      // Input a field holds comes first: the toast names it, as its own error may not ("Not valid JSON").
      toast.error(pending[0] ? t('editor.fixHeld', { fix, message: pending[0].message }) : fix);
      // Input this tab holds comes first: stay here, on the field that holds it.
      const holding = pending.length > 0 ? bodyRef.current?.querySelector<HTMLElement>('[role="tabpanel"] [aria-invalid="true"]') : undefined;
      const first = pending.length > 0 ? active : tabIds.find((tab) => byTab.has(tab));
      if (first !== undefined && first !== active) goTab(first);
      else if (holding) holding.focus();
      else if (first === undefined && idMissing) idRef.current?.focus();
      else if (left?.isConnected) left.focus();
      return;
    }
    if (!isNew && !dirty && !force) {
      lock(false);
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
        if (mounted.current) {
          guard.leaveFreely();
          void navigate(pathFor(kind, saved.id, parent), { replace: true });
        }
      } else {
        toast.success(t('editor.saved', { name: savedName }));
        setOriginal(saved);
        reset(valueOf(saved));
        lock(false);
      }
    } else if ('conflict' in result) {
      setConflict(result.conflict);
    } else if ('exists' in result || 'unchecked' in result) {
      // A create never overwrites: the id is taken, or could not be checked (saveResource).
      const refusal = 'exists' in result ? takenFailure(kind, result.exists, parent) : uncheckedFailure(createId ?? '', result.unchecked);
      setFailure(refusal);
      toast.error(refusal.message, refusal.link && { label: refusal.link.label, href: `#${refusal.link.to}` });
      if (refusal.path !== undefined) goTab(tabOfIssue({ path: refusal.path, message: '' }, tabFields, JSON_TAB));
    } else {
      const { error } = result;
      if (error.kind === 'auth') markReadOnly();
      const path = pathOfError(error.errorMsg);
      setFailure({ message: error.errorMsg ?? error.message, path });
      if (path !== undefined) goTab(tabOfIssue({ path, message: '' }, tabFields, JSON_TAB));
    }
  }

  // Save from the button, Cmd/Ctrl-S or the conflict dialog: after the focused field is left.
  const requestSave = useSaveRequest(bodyRef, save, !saving && !locked);

  function discard() {
    if (isNew) {
      // The leave guard asks when there is something to lose.
      void navigate(listPath);
      return;
    }
    if (unsaved) setDialog('discard');
    else lock(true);
  }

  function reloadTheirs(theirs: Item) {
    setConflict(undefined);
    queryClient.setQueryData(scopedKey(client.conn.id, queryKeys.item(kind, theirs.id, parent)), theirs);
    setOriginal(theirs);
    reset(valueOf(theirs));
    lock(true);
    toast.info(t('editor.conflict.reloaded', { name: def.nameOf(theirs) }));
  }

  useEditorKeys({ locked, canEdit: !readOnly, onEdit: unlock, onSave: () => requestSave() });

  // --- Tabs' content -----------------------------------------------------------------------------
  // Only the active panel is mounted, so only its content is built; memoised, so a change of what
  // fields hold (usePending, on a keystroke) re-renders the badges and not the panel.
  const activeIssues = useMemo(
    () => [...(byTab.get(active) ?? []), ...(failureIssue && failureTab === active && active !== JSON_TAB ? [failureIssue] : [])],
    [byTab, active, failureIssue, failureTab],
  );
  const content = useMemo(() => {
    const props: TabProps = { draft, setDraft: edit, kind, isNew, ctx, parent, original, saveAttempts, issues: activeIssues, copyRemoved };
    const tab = shownTabs.find((candidate) => candidate.id === active);
    return tab ? tab.render(props) : <JsonTab {...props} />;
  }, [shownTabs, active, draft, edit, kind, isNew, ctx, parent, original, saveAttempts, activeIssues, copyRemoved]);
  const changedHere = (fields: string[]) => fields.some((field) => !deepEqual(draft[field], baseline[field]));
  const label = (text: string, changed: boolean) => (
    <>
      {text}
      {changed && <span className="ed-dot" aria-hidden="true" />}
    </>
  );
  const badge = (tab: string) => (byTab.get(tab)?.length ?? 0) + (failureTab === tab ? 1 : 0) + (tab === active ? pending.length : 0);
  const tabs = [
    ...shownTabs.map((tab) => ({ id: tab.id, label: label(tab.label, changedHere(tab.fields)), badge: badge(tab.id), content: tab.id === active ? content : null })),
    { id: JSON_TAB, label: label(t('editor.json.tab'), dirty), badge: badge(JSON_TAB), content: active === JSON_TAB ? content : null },
  ];

  // The status is part of the JSON tab's text: while that text holds Save, the switch would change a
  // draft the text no longer follows, and fixing the text would undo it. It waits instead.
  const status = def.hasStatus
    ? {
        enabled: isEnabled(draft),
        name,
        onChange: (on: boolean) => {
          const first = pending[0];
          if (active === JSON_TAB && first) {
            toast.error(t('ui.pending.refused', { message: first.message }));
            bodyRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden]) [aria-invalid="true"]')?.focus();
            return;
          }
          edit(setPath(draft, ['status'], on ? 1 : 0));
        },
      }
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
        owner={kind === 'credentials' && parent ? { kind: registry.consumers.singular, name: parent.consumer, to: ownerPath(parent) } : undefined}
        status={status}
        readOnly={readOnly}
        saving={saving}
        saveBlocked={active === JSON_TAB && pending.length > 0}
        editRef={editRef}
        onEdit={unlock}
        onSave={() => requestSave()}
        onDiscard={discard}
        onDuplicate={() => id !== undefined && void navigate(`${newPathFor(kind, parent)}?from=${encodeURIComponent(id)}`)}
        onViewJson={() => setDialog('json')}
        onDelete={() => setDialog('delete')}
      />
      <div className="ed-body" ref={bodyRef}>
        {failure && <FailureBanner failure={failure} />}
        {isNew && !def.idFromDraft && (
          <NewIdField
            kind={kind}
            parent={parent}
            value={newId}
            onChange={setNewId}
            inputRef={idRef}
            missing={attempted && idMissing}
            // A refused create's id while the field still holds it, else an object of a loaded list that has it (the GET decides).
            taken={createId !== undefined && failure?.taken === createId ? createId : createId !== undefined ? findInCtx(kind, createId, ctx)?.id : undefined}
          />
        )}
        <LockProvider locked={!editable} session={session}>
          <PendingProvider key={epoch} onChange={tabState.onPending}>
            <Tabs tabs={tabs} active={active} onChange={tabState.chooseTab} />
          </PendingProvider>
        </LockProvider>
      </div>

      <EditorDialogs
        kind={kind}
        parent={parent}
        ctx={ctx}
        name={name}
        original={original}
        plugins={streamKind ? streamSet : plugins}
        guard={guard}
        tabState={tabState}
        pending={pending}
        dialog={dialog}
        closeDialog={() => setDialog(undefined)}
        onDiscard={() => {
          setDialog(undefined);
          reset();
          lock(true);
        }}
        conflict={conflict}
        onOverwrite={() => {
          setConflict(undefined);
          requestSave(true);
        }}
        onReload={reloadTheirs}
        onCancelConflict={() => setConflict(undefined)}
        onDeleted={() => {
          guard.leaveFreely();
          void navigate(listPath);
        }}
      />
    </div>
  );
}
