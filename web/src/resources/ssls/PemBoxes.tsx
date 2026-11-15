// The SSL editor's two kinds of PEM box, on PemInput, both following the one rule in pemBox.ts (its
// head comment states it): only the user changes the text; text that was not taken is held, and
// leaving the box only turns its key blocks into markers; while held the value stays what it was and
// the box says so; an empty box means no value (a certificate), the key that stood (a key), or a value
// the box cannot show, which stays; a refused file changes nothing and says why.
// - CertBox: a certificate or a CA. It owns its text; `value` and `onValue` are the field's.
// - KeyBox: a private key. A whole key is taken at once and leaves the page: one line then reads
//   "Private key entered, not shown", with Replace key and Remove.
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Field, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { CertDetails } from './CertDetails';
import { afterLeaving, fileRefusal, heldWhy, kept, takes, valueAfter } from './pemBox';
import { PemInput } from './PemInput';
import { isSecretRef } from './validate';

interface BoxProps {
  label: string;
  help?: ReactNode;
  /** An issue with the field's value (sslIssues), shown when the text has no problem of its own. */
  error?: string;
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
  // Editing state: the text the box shows; it starts as the value, or empty over one it cannot show.
  const [text, setText] = useEditingState(hidden !== undefined ? '' : (value ?? ''));
  const set = (next: string) => {
    setText(next);
    const v = valueAfter('cert', next, { held: value, stood: undefined, hidden });
    if (v !== value) onValue(v);
  };
  const note = kept('cert', text, { value, hidden });
  return (
    <>
      <PemInput
        label={label}
        help={help}
        value={text}
        problem={heldWhy('cert', text)}
        error={error}
        onChange={set}
        onFile={(fileText) => {
          const why = fileRefusal('cert', fileText);
          if (why === undefined) set(fileText);
          return why;
        }}
        onBlur={() => setText(afterLeaving('cert', text))}
      />
      {note && (
        <p className="ssl-keyline">
          <span className="ssl-muted">{note}</span>
          {keep && hidden !== undefined && value === hidden && text.trim() === '' && (
            <Button size="sm" variant="ghost" onClick={keep.onKeep}>
              {keep.label}
            </Button>
          )}
        </p>
      )}
      {details && takes('cert', text) && <CertDetails pem={text} />}
    </>
  );
}

/** A private-key box over `value`, the key taken (never shown). */
export function KeyBox({ label, help, error, value, onValue }: BoxProps & { value: string | undefined; onValue: (key: string | undefined) => void }) {
  const locked = useLocked();
  // Editing state: the text in the box (never filled from `value`); whether the box is open over a
  // key already taken; the key that stood when this editing began (undefined until it begins).
  const [text, setText] = useEditingState('');
  const [open, setOpen] = useEditingState(false);
  const [stood, setStood] = useEditingState<{ key: string | undefined } | undefined>(undefined);
  const standing = stood ?? { key: value };
  const close = () => {
    setText('');
    setOpen(false);
    setStood(undefined);
  };
  const set = (next: string) => {
    if (!stood) setStood(standing);
    setText(next);
    const v = valueAfter('key', next, { held: standing.key, stood: standing.key, hidden: undefined });
    if (v !== value) onValue(v);
    // A whole key leaves the page at once; a reference may still be being typed.
    if (takes('key', next) && !isSecretRef(next.trim())) close();
  };

  if (locked) {
    return (
      <Field label={label}>
        <ReadOnlyValue>{value !== undefined ? t('ssl.key.entered') : undefined}</ReadOnlyValue>
      </Field>
    );
  }
  if (value !== undefined && !open && text === '') {
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
  const note = kept('key', text, { value, hidden: undefined });
  return (
    <div className="ssl-main">
      <PemInput
        label={label}
        help={help}
        value={text}
        problem={heldWhy('key', text)}
        error={error}
        autoFocus={open}
        onChange={set}
        onFile={(fileText) => {
          const why = fileRefusal('key', fileText);
          if (why === undefined) {
            onValue(fileText);
            close();
          }
          return why;
        }}
        onBlur={() => {
          if (text.trim() === '' || takes('key', text)) close();
          else setText(afterLeaving('key', text));
        }}
      />
      {note && <span className="ssl-muted">{note}</span>}
    </div>
  );
}
