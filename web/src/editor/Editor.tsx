// The editor itself, for a loaded object or a new one (EditorFrame.tsx picks which). A stored object
// opens LOCKED: its values read as full-contrast text and nothing changes until Edit (or `e`); Save
// and Discard lock it again. A new object (or a copy) starts unlocked.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { queryKeys, scopedKey, useAllPlugins, useClient, useInvalidate } from '../api/hooks';
import { stripTimestamps } from '../api/sanitize';
import type { Item, Kind, Obj, Parent } from '../api/types';
import type { ApiError } from '../api/errors';
import { useMarkReadOnly, useReadOnlyKey, useWrite, writeRefused } from '../api/write';
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
import { useRequiredValues } from './untouched';
import { useEdit } from './useEdit';
import { returnFocus, type Place } from './focusBack';

/** Where focus goes back after a refused save (final wave I1): what the save left, what was pressed. */
interface Refocus {
  left?: HTMLElement;
  /** Where `left` was, to find it again after a remount (F3). */
  place?: Place;
  pressed?: HTMLElement;
  anyway: boolean;
  /** A local refusal that showed another tab: its first flagged control comes first (F1). */
  toProblem?: boolean;
}

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
  /** A read found the stored object deleted (by another client): a draft being edited stays (the caller's `notice` says so). */
  removed?: boolean;
  /** Called while `removed` once the page is locked and not saving: the page gives way (Not found, or the create form). */
  onRemoved?: () => void;
}

export function Editor({ kind, id, parent, item, start, copyOf, notice, onStored, removed = false, onRemoved }: EditorProps) {
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
  const write = useWrite();

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
  // `from`: where the save came from, for focus when the dialog closes without overwriting (F2).
  const [conflict, setConflict] = useState<{ item: Item; anyway: boolean; from: Refocus }>();
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
  const saveRef = useRef<HTMLButtonElement>(null);
  const anywayRef = useRef<HTMLButtonElement>(null);
  /**
   * After a refused save (final wave I1), where focus goes back: set with the refusal, used once the
   * page shows it (a tab switched to, the fields shown again after the saving state), so what it
   * focuses is what stays.
   */
  const refocusNext = useRef<Refocus | undefined>(undefined);
  /** A refocus waiting for a tab to show (F1): cleared when the page goes. */
  const refocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(refocusTimer.current), []);
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
  // A new object's required values wait for a refused Save or the user's touch (untouched.ts): such a
  // problem is neither shown nor counted on a badge until then, though Save is refused for it.
  const required = useRequiredValues({ isNew, attempted, draft, issues, createId, idWithSlash: def.idWithSlash });
  const { shown: shownIssues, noteEdit } = required;
  // Judged at the time of the call (useEdit.ts): no stale closure writes during a save or a lock.
  const { edit, stop: stopEdits } = useEdit(editable, (next) => {
    noteEdit(next);
    setDraft(next);
  });

  const shownTabs = useShownTabs(def.tabs);
  const tabFields = useMemo(() => shownTabs.map((tab) => ({ id: tab.id, fields: tab.fields, rest: tab.restFields })), [shownTabs]);
  const tabIds = [...shownTabs.map((tab) => tab.id), JSON_TAB];
  const byTab = useMemo(() => issuesByTab(shownIssues, tabFields, JSON_TAB), [shownIssues, tabFields]);
  // A refused Save goes to the first tab with a problem, shown or not yet (it shows them all).
  const byTabAll = useMemo(() => issuesByTab(issues, tabFields, JSON_TAB), [issues, tabFields]);
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
    stopEdits();
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

  // The object was deleted elsewhere: a locked page has nothing to show (a draft being edited stays until it locks).
  useEffect(() => {
    if (removed && locked && !saving) onRemoved?.();
  }, [removed, locked, saving, onRemoved]);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = undefined;
    if (target === 'edit') editRef.current?.focus();
    else if (target === 'field') bodyRef.current?.querySelector<HTMLElement>('input, textarea, select, button[role="switch"], .cm-content')?.focus();
  }, [locked]);

  // After a create moved the page here (F6): focus goes where a navigation puts it, the main region, as
  // the command palette's navigation does; never body. Unless the user is on something already.
  const location = useLocation();
  useEffect(() => {
    if ((location.state as { focusMain?: boolean } | null)?.focusMain !== true) return;
    const at = document.activeElement;
    if (at && at !== document.body && at.isConnected) return;
    document.querySelector<HTMLElement>('main')?.focus({ preventScroll: true });
  }, [location.key, location.state]);

  useEffect(() => {
    const next = refocusNext.current;
    if (!next) return;
    refocusNext.current = undefined;
    clearTimeout(refocusTimer.current);
    // Only focus the save lost is given back: if the user has gone on meanwhile (another control, a
    // field), it stays where they went.
    const lost = () => {
      const at = document.activeElement;
      return !at || at === document.body || at === next.pressed;
    };
    const back = () => returnFocus(next.left, next.place, next.pressed, next.anyway ? anywayRef.current : undefined, saveRef.current);
    if (!lost()) return;
    if (!next.toProblem) {
      back();
      return;
    }
    // A local refusal showed the tab with the first problem (F1): its first flagged control takes focus
    // once it is there. The tab may still be loading (LazyPanel's busy status), and a card may open for
    // the refusal a render later; while that lasts it is waited for, then where the user was.
    let tries = 0;
    const attempt = () => {
      if (!lost()) return;
      const panel = bodyRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
      const flagged = panel?.querySelector<HTMLElement>('[aria-invalid="true"]');
      flagged?.focus();
      if (flagged && document.activeElement === flagged) return;
      const loading = !panel || panel.querySelector('[role="status"][aria-busy="true"]') !== null;
      if (tries++ < (loading ? 60 : 5)) {
        refocusTimer.current = setTimeout(attempt, 50);
        return;
      }
      back();
    };
    attempt();
  });

  // --- Save --------------------------------------------------------------------------------------
  // Save anyway's grounds: only the kind's own checks (which can be stricter than APISIX) refuse the
  // draft: nothing held, no problem with the id. useSaveAnyway remembers a refusal on them.
  const onlyLocal = pending.length === 0 && frameIssues.length === 0 && !idMissing && !idRefused;
  // With a key found read-only nothing is sent (useWrite), so nothing is newly offered or advertised;
  // an offer made before stays where the user may be on it, unavailable like Save (EditorHeader).
  const anywayGrounds = onlyLocal && checked.length > 0;
  const anywayOffer = anywayGrounds && !readOnly;

  // Save from the button, Cmd/Ctrl-S, Save anyway or the conflict dialog: after the focused field is left.
  const requestSave = useSaveRequest(bodyRef, save, !saving && !locked);
  const saveAnyway = useSaveAnyway({ session, grounds: !locked && anywayGrounds, checked, shown: shownTabs, tabFields, send: () => requestSave(false, true) });

  /** `anyway`: Save anyway, which sends the draft past the kind's own checks (only those). */
  async function save(force = false, left?: HTMLElement, anyway = false, pressed?: HTMLElement, place?: Place) {
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
      toast.error(named ? t('editor.fixHeld', { fix, message: named }) : anywayOffer ? t('editor.fixAnyway', { fix }) : fix, { pageBound: true });
      saveAnyway.refused(anywayOffer);
      // Input this tab holds comes first: stay here, on the field that holds it (the one the toast names).
      const holding = pending.length > 0 ? heldField(pending[0], bodyRef.current?.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])')) : undefined;
      const first = pending.length > 0 ? active : tabIds.find((tab) => byTabAll.has(tab));
      if (first !== undefined && first !== active) {
        goTab(first);
        // Once that tab shows, its first flagged control takes focus; else where the user was (F1).
        refocusNext.current = { left, place, pressed, anyway, toProblem: true };
      } else if (holding) holding.focus();
      else if (first === undefined && (idMissing || idRefused)) idRef.current?.focus();
      else returnFocus(left, place, pressed, anyway ? anywayRef.current : undefined, saveRef.current);
      return;
    }
    if (!isNew && !dirty && !force) {
      lock(false);
      toast.info(t('editor.nothingToSave'));
      return;
    }
    // A key known to be read-only: refused here, before the saving state (which would remount every
    // field for a save that sends nothing); the field left for it gets its focus back.
    if (writeRefused(client.conn.id)) {
      refuseReadOnly({ left, place, pressed, anyway });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    stopEdits();
    setFailure(undefined);
    // Through the write path, which sends nothing once the key is known read-only (api/write.ts);
    // saveResource never throws, so that refusal is the only failure the wrapper reports.
    const sent = await write((c) => saveResource(c, { kind, id: isNew ? createId : id, isNew, draft, original, parent, force }), { silent: true });
    inFlight.current = false;
    setSaving(false);
    if (!sent.ok) {
      // The key turned read-only meanwhile (another save of this connection was refused): the same refusal.
      refuseReadOnly({ left, place, pressed, anyway });
      return;
    }
    const result = sent.value;

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
          // The page moves to the stored object: focus goes where a navigation puts it (F6).
          void navigate(pathFor(kind, saved.id, parent), { replace: true, state: { focusMain: true } });
        }
      } else {
        toast.success(t('editor.saved', { name: savedName }));
        setOriginal(saved);
        reset(valueOf(saved));
        lock(false);
      }
    } else if ('conflict' in result) {
      // The frame's own outcomes (here and below) are not the local checks' refusal: the offer's
      // memory of it goes, so nothing says "nothing else stops the save"; the session's yes stays
      // (Task 16b, item 151). Overwrite goes on anyway through `conflict.anyway`.
      saveAnyway.refused(false);
      setConflict({ item: result.conflict, anyway, from: { left, place, pressed, anyway } });
    } else if ('exists' in result || 'unchecked' in result) {
      saveAnyway.refused(false);
      refocusNext.current = { left, place, pressed, anyway };
      // A create never overwrites: the id is taken, or could not be checked (saveResource).
      // On a page fixed to that id (a plugin's metadata), the stored object is shown on request instead of linked.
      const refusal = 'exists' in result ? takenFailure(kind, result.exists, parent, fixedId !== undefined) : uncheckedFailure(createId ?? '', result.unchecked);
      setFailure(refusal);
      toast.error(refusal.message, refusal.link && { label: refusal.link.label, href: `#${refusal.link.to}` });
      if (refusal.path !== undefined) goTab(tabOfIssue({ path: refusal.path, message: '' }, tabFields, JSON_TAB));
      if ('unchecked' in result && result.unchecked.kind === 'auth') toConnect(result.unchecked);
    } else {
      // Refused by APISIX: focus goes back where the user was once the page shows why.
      refocusNext.current = { left, place, pressed, anyway };
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

  /** Not sent (the key is read-only): the draft stays, to be copied out (the JSON tab), the banner says why, and focus goes back where the user was. */
  function refuseReadOnly(from: Refocus) {
    refocusNext.current = from;
    setFailure({ title: t('editor.notSent'), message: t('editor.readOnlySave') });
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
        saveRef={saveRef}
        anywayRef={anywayRef}
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
        {saveAnyway.offered && !readOnly && <SaveAnywayNotice count={checked.length} />}
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
            missing={!required.idWaits && idMissing}
            refused={required.idWaits && required.idPartMissing ? undefined : idRefused}
            onTyped={required.idTyped}
            // What a kind's own control would discard by starting the draft over (final wave N2): the form tab's held input, not the JSON tab's, which keeps its text.
            held={active === JSON_TAB ? [] : pending}
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
        onCancelConflict={() => {
          // Closed without overwriting (Cancel, Escape, Close): focus goes back where the save came from,
          // before the dialog's own return of focus, which leaves focus that is not on body alone.
          refocusNext.current = conflict?.from;
          setConflict(undefined);
        }}
        onDeleted={() => {
          guard.leaveFreely();
          void navigate(listPath);
        }}
      />
    </div>
  );
}
