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
//   open until a whole key is taken or Keep the entered key closes it.
import { useRef, type ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Field, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { CertDetails } from './CertDetails';
import { fileRefusal, heldWhy, isReference, kept, shown, takes, valueAfter, type BoxKind } from './pemBox';
import { PemInput } from './PemInput';

interface BoxProps {
  label: string;
  help?: ReactNode;
  /** An issue with the field's value (sslIssues), shown when the text has no problem of its own. */
  error?: string;
}

/**
 * A box's text (editing state), set in one place (rule 1): `show` sets what arrives (typed, pasted,
 * dropped, an accepted file, the initial text), as given while the textarea has focus and with its
 * key blocks masked at once otherwise; `leave` masks them when the textarea loses focus. Both go
 * through `shown`; nothing else sets the text.
 */
function useBoxText(kind: BoxKind, initial: () => string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useEditingState(() => shown(kind, initial(), false));
  const show = (next: string): string => {
    const out = shown(kind, next, ref.current !== null && ref.current === document.activeElement);
    setText(out);
    return out;
  };
  const leave = () => setText((current) => shown(kind, current, false));
  return { ref, text, show, leave };
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
export function CertBox({ label, help, error, value, onValue, hidden, details, keep }: CertBoxProps) {
  // It starts as the value, or empty over one it cannot show.
  const box = useBoxText('cert', () => (hidden !== undefined ? '' : (value ?? '')));
  const set = (next: string) => {
    const v = valueAfter('cert', box.show(next), { held: value, stood: undefined, hidden });
    if (v !== value) onValue(v);
  };
  const note = kept('cert', box.text, { value, hidden });
  return (
    <>
      <PemInput
        label={label}
        help={help}
        value={box.text}
        inputRef={box.ref}
        problem={heldWhy('cert', box.text)}
        error={error}
        onChange={set}
        onFile={(fileText) => {
          const why = fileRefusal('cert', fileText);
          if (why === undefined) set(fileText);
          return why;
        }}
        onBlur={box.leave}
      />
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
export function KeyBox({ label, help, error, value, onValue }: BoxProps & { value: string | undefined; onValue: (key: string | undefined) => void }) {
  const locked = useLocked();
  // Editing state: the text in the box (never filled from `value`); whether the box was opened over
  // a key already taken (Replace key); the key that stood when this editing began (undefined until it begins).
  const box = useBoxText('key', () => '');
  const [open, setOpen] = useEditingState(false);
  const [stood, setStood] = useEditingState<{ key: string | undefined } | undefined>(undefined);
  const standing = stood ?? { key: value };
  const close = () => {
    box.show('');
    setOpen(false);
    setStood(undefined);
  };
  const set = (next: string) => {
    // A whole key is taken and leaves the page at once; a reference stays, as it may still be typed.
    if (takes('key', next) && !isReference(next)) {
      if (next !== value) onValue(next);
      close();
      return;
    }
    if (!stood) setStood(standing);
    const v = valueAfter('key', box.show(next), { held: standing.key, stood: standing.key, hidden: undefined });
    if (v !== value) onValue(v);
  };
  // Keep the entered key (rule 9): the box closes over the key that stood, whatever it held.
  const keep = () => {
    if (standing.key !== value) onValue(standing.key);
    close();
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
          <Button size="sm" onClick={() => setOpen(true)}>
            {t('ssl.key.replaceKey')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onValue(undefined)}>
            {t('ssl.key.remove')}
          </Button>
        </span>
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
        problem={heldWhy('key', box.text)}
        error={error}
        autoFocus={open}
        onChange={set}
        onFile={(fileText) => {
          const why = fileRefusal('key', fileText);
          if (why === undefined) set(fileText);
          return why;
        }}
        onBlur={box.leave}
      />
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
