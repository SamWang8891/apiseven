// The SSL editor's two kinds of PEM box, on PemInput, both following the one rule in pemBox.ts (its
// head comment states it): only the user changes the text, and every change goes through one setter
// (useBoxText) that shows private-key blocks only while the box has focus; text that was not taken is
// held, and leaving the box only turns its key blocks into markers; while held the value stays what
// it was and the box says so; an empty box means no value (a certificate), the key that stood (a
// key), or a value the box cannot show, which stays; a refused file changes nothing and says why; a
// box never opens or closes because focus moved.
// - CertBox: a certificate or a CA. It owns its text; `value` and `onValue` are the field's.
// - KeyBox: a private key. A whole key is taken at once and leaves the page: one line then reads
//   "Private key entered, not shown", with Replace key and Remove. A box opened over a key stays
//   open until a whole key is taken or Keep the entered key closes it; Keep is offered while that key
//   is the value (over a reference taken in the box, emptying it brings Keep back: the final wave's
//   fix round 1, F1). What the box says stays, and what its split action replaces, are the value
//   now (while held, the last value taken). A key is taken from its first
//   -----BEGIN line, and a line says when what came before it was left out. A key taken is handed to
//   keyMatch.learnKey, which keeps only its public part, for the pair's check.
// - The two boxes of a pair (`pair`: a new SSL, the pair dialog) offer to split a combined text or
//   file (rule 10, pairLink.ts): the action gives each part to its box's own `set`.
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Field, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { CertDetails } from './CertDetails';
import { learnKey } from './keyMatch';
import { fileRefusal, heldWhy, isReference, kept, leftOutBefore, shown, splitOf, takenValue, takes, valueAfter, type BoxKind, type FileReason, type SplitParts } from './pemBox';
import type { PairLink, PairSide } from './pairLink';
import { PemInput } from './PemInput';

interface BoxProps {
  label: string;
  help?: ReactNode;
  /** An issue with the field's value (sslIssues), shown when the text has no problem of its own. */
  error?: string;
  /** The pair this box is one of (rule 10): it offers the split of a combined text. Not for the CA box. */
  pair?: PairLink;
}

/**
 * A box's split offer (rule 10): `consider` looks at every text or file that reaches the box, a file
 * that could not be read included (it offers nothing). While an offer stands its parts, key included,
 * are kept in memory only (a ref: not state, not the page); they go when the box's text next changes,
 * when another file that offers them reaches it, when the action is used, when the offer ends with
 * the editing session, and with the box. A file that offers nothing ends only an offer a file made:
 * the box's own text, unchanged, still offers its own (Task 16b, item 144). `from` (editing state) is
 * what offered it: the box's text or a file the box refused. While it stands, whatever offered it,
 * the box's messages point at the action (rule 8; fix round 1, R7; fix round 2, R7), never at doing
 * by hand what the action does; the pair is told, for the lines beside the boxes. While the other box
 * of the pair offers, this box's messages point at that action, which replaces its text (item 145).
 */
function useSplitOffer(pair: PairLink | undefined, own: BoxKind) {
  const [from, setFrom] = useEditingState<'text' | 'file' | undefined>(undefined);
  const parts = useRef<SplitParts | undefined>(undefined);
  useEffect(() => {
    if (from === undefined) parts.current = undefined;
  }, [from]);
  const consider = (text: string, source: 'text' | 'file') => {
    const found = pair ? splitOf(text) : undefined;
    if (found === undefined && source === 'file' && from === 'text') return;
    parts.current = found;
    setFrom(found === undefined ? undefined : source);
  };
  const apply = () => {
    const found = parts.current;
    parts.current = undefined;
    setFrom(undefined);
    if (pair && found) pair.split(found);
  };
  const offered = pair !== undefined && from !== undefined;
  const report = pair?.reportOffer;
  useLayoutEffect(() => {
    report?.(own, offered);
    return () => report?.(own, false);
  }, [report, own, offered]);
  // The other box of the pair offers its split: that action gives this box its part.
  const byOther = !offered && pair !== undefined && pair.offers[own === 'cert' ? 'key' : 'cert'];
  /**
   * The box's own problem while an offer stands: its text is the combined one (`from` text), or text
   * the file's part replaces (`from` file); or, while the other box offers, text that action replaces.
   * Either way the action is what resolves it.
   */
  const problem = (why: string | undefined) => {
    if (why === undefined) return why;
    if (offered) return t(from === 'text' ? 'ssl.split.held' : own === 'cert' ? 'ssl.split.overCert' : 'ssl.split.overKey');
    return byOther ? t(own === 'cert' ? 'ssl.split.byKeyBox' : 'ssl.split.byCertBox') : why;
  };
  /**
   * How the last refused file's reason reads while an offer stands: the file's own offer (`from`
   * file); beside the text's offer or the other box's action, its bare reason (what was wrong, no
   * instruction: fix round 1, R3.1) and what the action does; with no offer, in full.
   */
  const fileReason = (reason: FileReason) => {
    if (offered) return from === 'file' ? t('ssl.split.file') : t('ssl.split.fileOverText', { reason: reason.bare });
    return byOther ? t(own === 'cert' ? 'ssl.split.fileByKeyBox' : 'ssl.split.fileByCertBox', { reason: reason.bare }) : reason.full;
  };
  /**
   * The box's input went while the box stays (a key box's locked view, a save in flight): a refused
   * file's reason went with it, so an offer that file made ends too; the text's own offer stays (fix
   * round 2, R1.2).
   */
  const inputGone = () => setFrom((now) => (now === 'file' ? undefined : now));
  return { offered, consider, apply, problem, fileReason, inputGone };
}

const NOTHING: PairSide = { value: false, held: false };

/**
 * The split action's name: it says what it replaces (fix round 1, R8): a value entered, and text a box
 * holds without having taken it, told apart (Task 16b, item 143). The own box's text is the action's
 * subject, so only its value is named.
 */
function splitLabel(own: 'cert' | 'key', replaces: { cert: PairSide; key: PairSide }): string {
  const { cert, key } = replaces;
  const parts =
    cert.value && key.value && !cert.held && !key.held
      ? [t('ssl.split.what.both')]
      : [
          ...(cert.value ? [t('ssl.split.what.cert')] : []),
          ...(cert.held ? [t('ssl.split.what.certText')] : []),
          ...(key.value ? [t('ssl.split.what.key')] : []),
          ...(key.held ? [t('ssl.split.what.keyText')] : []),
        ];
  const action = own === 'cert' ? 'ssl.split.toKeyBox' : 'ssl.split.toCertBox';
  if (parts.length === 0) return t(action);
  const what = parts.length === 1 ? (parts[0] as string) : t('ssl.split.what.list', { first: parts.slice(0, -1).join(', '), last: parts.at(-1) as string });
  return t(`${action}Replacing`, { what });
}

/** The split action, under the box the combined text reached. */
function SplitAction({ label, onUse }: { label: string; onUse: () => void }) {
  return (
    <p className="ssl-keyline">
      <Button size="sm" onClick={onUse}>
        {label}
      </Button>
    </p>
  );
}

/**
 * A box's text (editing state), set in one place (rule 1): `show` sets what arrives (typed, pasted,
 * dropped, an accepted file, a split's part, the initial text), as given while the textarea has
 * focus and with its key blocks masked at once otherwise; `leave` masks them when the textarea loses
 * focus. Both go through `shown`; nothing else sets the text. `changes` counts what `show` set (the
 * user's changes), not the masking on leaving: a refused file's reason lasts until the next one (rule
 * 5, PemInput), and no copy of the text is kept for it.
 */
function useBoxText(kind: BoxKind, initial: () => string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useEditingState(() => shown(kind, initial(), false));
  const [changes, setChanges] = useEditingState(0);
  const show = (next: string): string => {
    const out = shown(kind, next, ref.current !== null && ref.current === document.activeElement);
    setText(out);
    setChanges((n) => n + 1);
    return out;
  };
  const leave = () => setText((current) => shown(kind, current, false));
  return { ref, text, changes, show, leave };
}

export interface CertBoxProps extends BoxProps {
  /** The field's value. */
  value: string | undefined;
  onValue: (value: string | undefined) => void;
  /** A value the box stands over and cannot show (it holds a private key): an empty box keeps it. */
  hidden?: string;
  /** Show the details of a certificate the box has taken. */
  details?: boolean;
  /** A way to close the box while it keeps `hidden` (Keep the stored CA). */
  keep?: { label: string; onKeep: () => void };
}

/** A certificate box: the text is its own (editing state); the field's value follows the rule (valueAfter). */
export function CertBox({ label, help, error, value, onValue, hidden, details, keep, pair }: CertBoxProps) {
  // It starts as the value whenever that can be shown: empty only while the value is the one it
  // cannot show (after a remount too: a certificate taken over it is shown).
  const locked = useLocked();
  const box = useBoxText('cert', () => (value === undefined || value === hidden ? '' : value));
  const split = useSplitOffer(pair, 'cert');
  const set = (next: string) => {
    split.consider(next, 'text');
    const v = valueAfter('cert', box.show(next), { held: value, stood: undefined, hidden });
    if (v !== value) onValue(v);
  };
  useImperativeHandle(pair?.certRef, () => ({ take: set }));
  // The pair's key box names text here that was not taken as what its action replaces (item 143).
  const report = pair?.reportCertHeld;
  const holds = heldWhy('cert', box.text) !== undefined;
  useLayoutEffect(() => report?.(holds), [report, holds]);
  const note = kept('cert', box.text, { value, hidden });
  return (
    <>
      <PemInput
        label={label}
        help={help}
        value={box.text}
        inputRef={box.ref}
        changes={box.changes}
        problem={split.problem(heldWhy('cert', box.text))}
        error={error}
        onChange={set}
        onFile={(fileText) => {
          const why = fileRefusal('cert', fileText);
          if (why === undefined) set(fileText);
          else split.consider(fileText, 'file');
          return why;
        }}
        onUnreadable={() => split.consider('', 'file')}
        fileReason={split.fileReason}
        onGone={split.inputGone}
        onBlur={box.leave}
      />
      {split.offered && !locked && <SplitAction label={splitLabel('cert', { cert: { value: value !== undefined, held: false }, key: pair?.key ?? NOTHING })} onUse={split.apply} />}
      {note && (
        <p className="ssl-keyline">
          <span className="ssl-muted">{note}</span>
          {keep && hidden !== undefined && value === hidden && box.text.trim() === '' && (
            <Button size="sm" variant="ghost" onClick={keep.onKeep}>
              {keep.label}
            </Button>
          )}
        </p>
      )}
      {details && takes('cert', box.text) && <CertDetails pem={box.text} />}
    </>
  );
}

/** A private-key box over `value`, the key taken (never shown). */
export function KeyBox({ label, help, error, value, onValue, pair }: BoxProps & { value: string | undefined; onValue: (key: string | undefined) => void }) {
  const locked = useLocked();
  // Editing state: the text in the box (never filled from `value`); whether the box was opened over
  // a key already taken (Replace key); the key that stood when this editing began (undefined until it
  // begins); whether the key just taken had lines before its BEGIN line that were left out.
  const box = useBoxText('key', () => '');
  const [open, setOpen] = useEditingState(false);
  const [stood, setStood] = useEditingState<{ key: string | undefined } | undefined>(undefined);
  const [leftOut, setLeftOut] = useEditingState(false);
  const split = useSplitOffer(pair, 'key');
  const standing = stood ?? { key: value };
  // The pair's certificate box names text here that was not taken as what its action replaces (fix round 2, R8; item 143).
  const report = pair?.reportKeyHeld;
  const holds = heldWhy('key', box.text) !== undefined;
  useLayoutEffect(() => report?.(holds), [report, holds]);
  const close = () => {
    box.show('');
    split.consider('', 'text');
    setOpen(false);
    setStood(undefined);
  };
  const set = (next: string) => {
    // A whole key is taken (from its first BEGIN line) and leaves the page at once; a reference
    // stays, as it may still be typed. Its public part is derived meanwhile, for the pair's check
    // (keyMatch.ts); taking never waits.
    if (takes('key', next) && !isReference(next)) {
      const key = takenValue('key', next);
      void learnKey(key);
      if (key !== value) onValue(key);
      close();
      setLeftOut(leftOutBefore(next));
      return;
    }
    split.consider(next, 'text');
    setLeftOut(false);
    if (!stood) setStood(standing);
    // While held, the value stays the last one taken (rule 3): a reference taken here a moment ago, not
    // the key that stood, which an empty box and Keep go back to (rule 4; final wave M4).
    const v = valueAfter('key', box.show(next), { held: value, stood: standing.key, hidden: undefined });
    if (v !== value) onValue(v);
  };
  useImperativeHandle(pair?.keyRef, () => ({ take: set }));
  // Keep the entered key (rule 9): the box closes over the key that stood, whatever text it held (offered only while that key is the value).
  const keep = () => {
    if (standing.key !== value) onValue(standing.key);
    close();
    setLeftOut(false);
  };

  if (locked) {
    return (
      <Field label={label}>
        <ReadOnlyValue>{value !== undefined ? t('ssl.key.entered') : undefined}</ReadOnlyValue>
      </Field>
    );
  }
  if (value !== undefined && !open && box.text === '') {
    return (
      <Field label={label} error={error}>
        <span className="ssl-keyline">
          <span>{t('ssl.key.entered')}</span>
          <Button
            size="sm"
            onClick={() => {
              setOpen(true);
              setLeftOut(false);
            }}
          >
            {t('ssl.key.replaceKey')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLeftOut(false);
              onValue(undefined);
            }}
          >
            {t('ssl.key.remove')}
          </Button>
        </span>
        {leftOut && <span className="ssl-muted">{t('ssl.key.leftOut')}</span>}
      </Field>
    );
  }
  const note = kept('key', box.text, { value, hidden: undefined, stood: standing.key });
  // Keep goes back to the key that stood: offered only while that key is the value, never over a reference taken here since (F1).
  const keeps = standing.key !== undefined && value === standing.key;
  return (
    <div className="ssl-main">
      <PemInput
        label={label}
        help={help}
        value={box.text}
        inputRef={box.ref}
        changes={box.changes}
        problem={split.problem(heldWhy('key', box.text))}
        error={error}
        autoFocus={open}
        onChange={set}
        onFile={(fileText) => {
          const why = fileRefusal('key', fileText);
          if (why === undefined) set(fileText);
          else split.consider(fileText, 'file');
          return why;
        }}
        onUnreadable={() => split.consider('', 'file')}
        fileReason={split.fileReason}
        onGone={split.inputGone}
        onBlur={box.leave}
      />
      {/* The action replaces the key the field holds now (while held, the last one taken), so its name says so (F1). */}
      {split.offered && <SplitAction label={splitLabel('key', { cert: pair?.cert ?? NOTHING, key: { value: value !== undefined, held: false } })} onUse={split.apply} />}
      {(note || keeps) && (
        <p className="ssl-keyline">
          {note && <span className="ssl-muted">{note}</span>}
          {keeps && (
            <Button size="sm" variant="ghost" onClick={keep}>
              {t('ssl.key.keep')}
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
