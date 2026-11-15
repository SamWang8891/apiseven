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
//   open until a whole key is taken or Keep the entered key closes it. A key is taken from its first
//   -----BEGIN line, and a line says when what came before it was left out. A key taken is handed to
//   keyMatch.learnKey, which keeps only its public part, for the pair's check.
// - The two boxes of a pair (`pair`: a new SSL, the pair dialog) offer to split a combined text or
//   file (rule 10, pairLink.ts): the action gives each part to its box's own `set`.
import { useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Field, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { CertDetails } from './CertDetails';
import { learnKey } from './keyMatch';
import { fileRefusal, heldWhy, isReference, kept, leftOutBefore, shown, splitOf, takenValue, takes, valueAfter, type BoxKind, type SplitParts } from './pemBox';
import type { PairLink } from './pairLink';
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
 * A box's split offer (rule 10): `consider` looks at every text or file that reaches the box. While
 * an offer stands its parts, key included, are kept in memory only (a ref: not state, not the page);
 * they go when the box's text next changes, when the action is used, when the offer ends with the
 * editing session, and with the box. `offered` is editing state.
 */
function useSplitOffer(pair: PairLink | undefined) {
  const [offered, setOffered] = useEditingState(false);
  const parts = useRef<SplitParts | undefined>(undefined);
  useEffect(() => {
    if (!offered) parts.current = undefined;
  }, [offered]);
  const consider = (text: string) => {
    parts.current = pair ? splitOf(text) : undefined;
    setOffered(parts.current !== undefined);
  };
  const apply = () => {
    const found = parts.current;
    parts.current = undefined;
    setOffered(false);
    if (pair && found) pair.split(found);
  };
  return { offered: pair !== undefined && offered, consider, apply };
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
  const split = useSplitOffer(pair);
  const set = (next: string) => {
    split.consider(next);
    const v = valueAfter('cert', box.show(next), { held: value, stood: undefined, hidden });
    if (v !== value) onValue(v);
  };
  useImperativeHandle(pair?.certRef, () => ({ take: set }));
  const note = kept('cert', box.text, { value, hidden });
  return (
    <>
      <PemInput
        label={label}
        help={help}
        value={box.text}
        inputRef={box.ref}
        changes={box.changes}
        problem={heldWhy('cert', box.text)}
        error={error}
        onChange={set}
        onFile={(fileText) => {
          const why = fileRefusal('cert', fileText);
          if (why === undefined) set(fileText);
          else split.consider(fileText);
          return why;
        }}
        onBlur={box.leave}
      />
      {split.offered && !locked && <SplitAction label={t(pair?.keyEntered ? 'ssl.split.toKeyBoxReplace' : 'ssl.split.toKeyBox')} onUse={split.apply} />}
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
  const split = useSplitOffer(pair);
  const standing = stood ?? { key: value };
  const close = () => {
    box.show('');
    split.consider('');
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
    split.consider(next);
    setLeftOut(false);
    if (!stood) setStood(standing);
    const v = valueAfter('key', box.show(next), { held: standing.key, stood: standing.key, hidden: undefined });
    if (v !== value) onValue(v);
  };
  useImperativeHandle(pair?.keyRef, () => ({ take: set }));
  // Keep the entered key (rule 9): the box closes over the key that stood, whatever it held.
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
  const note = kept('key', box.text, { value, hidden: undefined });
  return (
    <div className="ssl-main">
      <PemInput
        label={label}
        help={help}
        value={box.text}
        inputRef={box.ref}
        changes={box.changes}
        problem={heldWhy('key', box.text)}
        error={error}
        autoFocus={open}
        onChange={set}
        onFile={(fileText) => {
          const why = fileRefusal('key', fileText);
          if (why === undefined) set(fileText);
          else split.consider(fileText);
          return why;
        }}
        onBlur={box.leave}
      />
      {split.offered && <SplitAction label={t(standing.key !== undefined ? 'ssl.split.toCertBoxReplace' : 'ssl.split.toCertBox')} onUse={split.apply} />}
      {(note || standing.key !== undefined) && (
        <p className="ssl-keyline">
          {note && <span className="ssl-muted">{note}</span>}
          {standing.key !== undefined && (
            <Button size="sm" variant="ghost" onClick={keep}>
              {t('ssl.key.keep')}
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
