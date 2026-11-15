// The editor itself, for a loaded object or a new one (EditorFrame.tsx picks which). A stored object
// opens LOCKED: its values read as full-contrast text and nothing changes until Edit (or `e`); Save
// and Discard lock it again. A new object (or a copy) starts unlocked.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { queryKeys, scopedKey, useAllPlugins, useClient, useInvalidate } from '../api/hooks';
import { stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, Parent } from '../api/types';
import type { ApiError } from '../api/errors';
import { useMarkReadOnly, useReadOnlyKey } from '../api/write';
import type { ConnectState } from '../connection/ConnectPage';
import { t } from '../i18n';
import { scopeOfKind } from '../plugins/scope';
import { registry, useCtx, type TabProps } from '../resources/registry';
import { findInCtx } from '../resources/resolve';
import { newPathFor, pathFor } from '../router/paths';
import { heldField, LockProvider, PendingProvider, Tabs, toast, ViewMemory, ViewScope } from '../ui';
import { backOf, ownerPath } from './back';
import { EditorDialogs } from './EditorDialogs';
import { useDraft } from './draft';
import { EditorHeader } from './EditorHeader';
import { saveFailure, takenFailure, uncheckedFailure, type Failure } from './failure';
import { CopyNotice } from './CopyNotice';
import { FailureBanner } from './FailureBanner';
import { useHeaderStatus } from './headerStatus';
import { idIssues, issuesByTab, pathOfError, tabOfIssue, type Issue } from './issues';
import { JSON_TAB } from './json';
import { JsonTab } from './JsonTab';
import { newIdState } from './newId';
import { NewIdField } from './NewIdField';
import { saveResource } from './save';
import { SaveAnywayNotice } from './SaveAnyway';
import { useSaveAnyway } from './useSaveAnyway';
import type { EditorStart } from './start';
import { useEditorKeys } from './useEditorKeys';
import { useActiveTab } from './useActiveTab';
import { useLeaveGuard } from './useLeaveGuard';
import { useMounted } from './useMounted';
import { tabStrip } from './tabStrip';
import { useSaveRequest } from './useSaveRequest';
import { SaveRefusalsContext } from './saveRefusals';
import { objectTitle, pageTitle, useDocumentTitle } from '../shell/documentTitle';
import { useShownTabs } from './useShownTabs';

/** What the draft is made of: the stored value without the timestamps APISIX refuses on save. */
const valueOf = (item: Item): Obj => stripTimestamps(item.value);

export interface EditorProps {
  kind: Kind;
  /** The stored object's id; with no `item`, the id a new object is created under (ResourceDef.createWhenMissing). */
  id?: string;
  parent?: Parent;
  /** The stored object as the query has it now (it may refresh in the background); undefined when creating. */
  item?: Item;
  start?: EditorStart;
  copyOf?: Item;
  /** Above the tabs (a create-when-missing page whose object was stored meanwhile). */
  notice?: ReactNode;
  /** A new object under the page's own id is stored (created, or shown on request): the page shows it. */
  onStored?: (item: Item) => void;
}

export function Editor({ kind, id, parent, item, start, copyOf, notice, onStored }: EditorProps) {
  const def = registry[kind];
  const isNew = item === undefined;
  /** A new object's id, when the page fixes it (a plugin's metadata page, nothing stored yet). */
  const fixedId = isNew ? id : undefined;
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
  const [newId, setNewId] = useState(start?.newId ?? '');
  /** Saves blocked by problems since the last lock. */
  const [saveAttempts, setSaveAttempts] = useState(0);
  const attempted = saveAttempts > 0;
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  /** The server's item when a save found it changed; `anyway`: that save was a Save anyway, and Overwrite goes on as one. */
  const [conflict, setConflict] = useState<{ item: Item; anyway: boolean }>();
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
  const mounted = useMounted();
  /** Set at once by a save that writes: a second request in the same tick (Cmd/Ctrl-S twice) sees it before `saving` renders. */
  const inFlight = useRef(false);
  /** Set by a refused save until the task ends: two presses in one task are one refusal (one count, one toast). */
  const refusedNow = useRef(false);

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

  const name = isNew && fixedId === undefined ? t('page.new', { kind: def.singular }) : def.nameOf({ id: id ?? '', value: draft });
  useDocumentTitle(isNew && fixedId === undefined ? pageTitle(name) : objectTitle(name, def.singular));
  const back = backOf(kind, parent);
  const listPath = back.to;

  // --- Issues ------------------------------------------------------------------------------------
  // A new object's id, and the frame's refusals of it (newId.ts), named in the field and the toast.
  const { typedId, createId, missing: idMissing, refused: idRefused } = newIdState(def, draft, { isNew, fixedId, newId });
  const objectId = isNew ? createId : id;
  const env = useMemo(() => ({ isNew, ctx, plugins, streamPlugins, original, id: objectId }), [isNew, ctx, plugins, streamPlugins, original, objectId]);
  const checked = useMemo(() => def.validate?.(draft, env) ?? [], [def, draft, env]);
  const frameIssues = useMemo(() => idIssues(def, draft, { id, isNew, newId, typedId }), [def, draft, id, isNew, newId, typedId]);
  const issues = useMemo(() => [...checked, ...frameIssues], [checked, frameIssues]);

  const shownTabs = useShownTabs(def.tabs);
  const tabFields = useMemo(() => shownTabs.map((tab) => ({ id: tab.id, fields: tab.fields, rest: tab.restFields })), [shownTabs]);
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
  // An id that is a body field (a username) counts once: as the kind's own issue there, if it has one.
  const idCounted = (idMissing || idRefused !== undefined) && !(def.idField !== undefined && issues.some((issue) => issue.path === def.idField));
  const problems = issues.length + (idCounted ? 1 : 0) + pending.length;
  // A typed ID and input a field holds (JSON text that doesn't parse, …) are unsaved work too.
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
  // Save anyway's grounds: only the kind's own checks (which can be stricter than APISIX) refuse the
  // draft: nothing held, no problem with the id. useSaveAnyway remembers a refusal on them.
  const onlyLocal = pending.length === 0 && frameIssues.length === 0 && !idMissing && !idRefused;
  const anywayGrounds = onlyLocal && checked.length > 0 && !readOnly;

  // Save from the button, Cmd/Ctrl-S, Save anyway or the conflict dialog: after the focused field is left.
  const requestSave = useSaveRequest(bodyRef, save, !saving && !locked);
  const saveAnyway = useSaveAnyway({ session, grounds: !locked && anywayGrounds, checked, shown: shownTabs, tabFields, send: () => requestSave(false, true) });

  /** `anyway`: Save anyway, which sends the draft past the kind's own checks (only those). */
  async function save(force = false, left?: HTMLElement, anyway = false) {
    if (saving || locked || inFlight.current) return;
    if (problems > 0 && !(anyway && onlyLocal)) {
      if (refusedNow.current) return;
      refusedNow.current = true;
      setTimeout(() => {
        refusedNow.current = false;
      });
      setSaveAttempts((n) => n + 1);
      const fix = problems === 1 ? t('editor.fixOne') : t('editor.fixMany', { count: problems });
      // Input a field holds comes first: the toast names it, as its own error may not ("Not valid JSON");
      // a refusal on Save anyway's grounds names that way out.
      const named = pending[0]?.message ?? idRefused;
      // About this page's form: it ends with the page (ui/toast.ts pageBound).
      toast.error(named ? t('editor.fixHeld', { fix, message: named }) : anywayGrounds ? t('editor.fixAnyway', { fix }) : fix, { pageBound: true });
      saveAnyway.refused(anywayGrounds);
      // Input this tab holds comes first: stay here, on the field that holds it (the one the toast names).
      const holding = pending.length > 0 ? heldField(pending[0], bodyRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')) : undefined;
      const first = pending.length > 0 ? active : tabIds.find((tab) => byTab.has(tab));
      if (first !== undefined && first !== active) goTab(first);
      else if (holding) holding.focus();
      else if (first === undefined && (idMissing || idRefused)) idRef.current?.focus();
      else if (left?.isConnected) left.focus();
      return;
    }
    if (!isNew && !dirty && !force) {
      lock(false);
      toast.info(t('editor.nothingToSave'));
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setFailure(undefined);
    const result = await saveResource(client, { kind, id: isNew ? createId : id, isNew, draft, original, parent, force });
    inFlight.current = false;
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
          onStored?.(saved);
          void navigate(pathFor(kind, saved.id, parent), { replace: true });
        }
      } else {
        toast.success(t('editor.saved', { name: savedName }));
        setOriginal(saved);
        reset(valueOf(saved));
        lock(false);
      }
    } else if ('conflict' in result) {
      setConflict({ item: result.conflict, anyway });
    } else if ('exists' in result || 'unchecked' in result) {
      // A create never overwrites: the id is taken, or could not be checked (saveResource).
      // On a page fixed to that id (a plugin's metadata), the stored object is shown on request instead of linked.
      const refusal = 'exists' in result ? takenFailure(kind, result.exists, parent, fixedId !== undefined) : uncheckedFailure(createId ?? '', result.unchecked);
      setFailure(refusal);
      toast.error(refusal.message, refusal.link && { label: refusal.link.label, href: `#${refusal.link.to}` });
      if (refusal.path !== undefined) goTab(tabOfIssue({ path: refusal.path, message: '' }, tabFields, JSON_TAB));
      if ('unchecked' in result && result.unchecked.kind === 'auth') toConnect(result.unchecked);
    } else {
      const { error } = result;
      // Only a refused write says the key may not write; a refused read says the key is wrong.
      if (error.kind === 'auth') {
        if (result.read) toConnect(error);
        else markReadOnly();
      }
      const path = pathOfError(error.errorMsg);
      setFailure(saveFailure(error, path));
      if (path !== undefined) goTab(tabOfIssue({ path, message: '' }, tabFields, JSON_TAB));
    }
  }

  /**
   * A read on the way to a write was refused for the key: as for a query (App.tsx), Connect, with the
   * reason; the leave guard asks first when there is something to lose.
   */
  function toConnect(error: ApiError) {
    const state: ConnectState = { reason: error.errorMsg ?? error.message, connId: client.conn.id };
    if (mounted.current) void navigate('/connect', { replace: true, state });
  }

  function discard() {
    if (isNew) {
      // The leave guard asks when there is something to lose.
      void navigate(listPath);
      return;
    }
    if (unsaved) setDialog('discard');
    else lock(true);
  }

  /** What holds a refused create's id on this very page (Failure.holder), shown on request. */
  function showStored(holder: Item) {
    queryClient.setQueryData(scopedKey(client.conn.id, queryKeys.item(kind, holder.id, parent)), holder);
    onStored?.(holder);
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
    const props: TabProps = { draft, setDraft: edit, kind, isNew, ctx, parent, original, saveAttempts, issues: activeIssues, id: objectId };
    const tab = shownTabs.find((candidate) => candidate.id === active);
    // Each tab's view state is its own (ui/ViewMemory: one title on two tabs is two sections).
    return tab ? <ViewScope name={tab.id}>{tab.render(props)}</ViewScope> : <JsonTab {...props} />;
  }, [shownTabs, active, draft, edit, kind, isNew, ctx, parent, original, saveAttempts, activeIssues, objectId]);
  const tabs = tabStrip({ shown: shownTabs, tabFields, draft, baseline, dirty, active, content, byTab, failureTab, pending });
  const refusals = useMemo(() => ({ session, attempts: saveAttempts }), [session, saveAttempts]);

  const status = useHeaderStatus({ def, draft, name, held: active === JSON_TAB ? pending[0] : undefined, body: bodyRef, edit });

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
        onSaveAnyway={saveAnyway.offered ? saveAnyway.press : undefined}
        editRef={editRef}
        onEdit={unlock}
        onSave={() => requestSave()}
        onDiscard={discard}
        onDuplicate={def.noDuplicate || readOnly ? undefined : () => id !== undefined && void navigate(`${newPathFor(kind, parent)}?from=${encodeURIComponent(id)}`)}
        deleteLabel={def.resets ? t('action.reset') : undefined}
        onViewJson={() => setDialog('json')}
        onDelete={() => setDialog('delete')}
      />
      <div className="ed-body" ref={bodyRef}>
        {failure && <FailureBanner failure={failure} onShow={showStored} />}
        {saveAnyway.offered && <SaveAnywayNotice count={checked.length} />}
        {notice}
        {isNew && start?.copy && <CopyNotice notes={start.copy} />}
        {isNew && !def.idFromDraft && fixedId === undefined && (
          <NewIdField
            kind={kind}
            parent={parent}
            value={newId}
            onChange={setNewId}
            draft={draft}
            setDraft={edit}
            inputRef={idRef}
            missing={attempted && idMissing}
            refused={idRefused}
            // A refused create's id while the field still holds it, else an object of a loaded list that has it (the GET decides).
            taken={createId !== undefined && failure?.taken === createId ? createId : createId !== undefined ? findInCtx(kind, createId, ctx)?.id : undefined}
          />
        )}
        <LockProvider locked={!editable} session={session} busy={saving}>
          {/* The tabs' view state, kept for the page: a tab switch or Discard remounts them. */}
          <ViewMemory>
            <SaveRefusalsContext value={refusals}>
              <PendingProvider key={epoch} onChange={tabState.onPending}>
                <Tabs tabs={tabs} active={active} onChange={tabState.chooseTab} />
              </PendingProvider>
            </SaveRefusalsContext>
          </ViewMemory>
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
        conflict={conflict?.item}
        onOverwrite={() => {
          setConflict(undefined);
          requestSave(true, conflict?.anyway);
        }}
        anyway={saveAnyway}
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
