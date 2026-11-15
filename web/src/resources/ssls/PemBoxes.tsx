// The SSL editor's two kinds of PEM box, on PemInput. Neither lets a private key rest on the page:
// - CertBox (a certificate, a CA): text that also holds a private key (a combined file) is refused as
//   typed, and cleared, with a word on why, when the box is left or when it arrives from a file.
// - KeyBox (a private key): a key is taken as soon as it can be, and leaves the box when it arrived
//   whole (with its END line: pasted, uploaded or dropped) or when the box is left; from then on one
//   line reads "Private key entered, not shown", with Replace key and Remove. Refused text that holds
//   a key (an encrypted one) is cleared the same way.
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { holdsPrivateKey } from '../../schema/secrets';
import { Button, Field, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { certProblem, completeKey, keyProblem } from './pem';
import { PemInput } from './PemInput';

interface BoxProps {
  label: string;
  help?: ReactNode;
  error?: string;
}

/** A certificate box over `value` (the text shown); `onChange` gets every text it shows, '' when it is cleared. */
export function CertBox({ label, help, error, value, onChange }: BoxProps & { value: string; onChange: (text: string) => void }) {
  // Editing state: the box was just cleared because its text held a private key.
  const [cleared, setCleared] = useEditingState(false);
  const clear = () => {
    setCleared(true);
    onChange('');
  };
  return (
    <PemInput
      label={label}
      help={help}
      value={value}
      problem={certProblem(value)}
      error={cleared ? t('ssl.pem.keyCleared') : error}
      onChange={(text) => {
        setCleared(false);
        onChange(text);
      }}
      onFile={(text) => {
        if (holdsPrivateKey(text)) clear();
        else {
          setCleared(false);
          onChange(text);
        }
      }}
      onBlur={() => {
        if (holdsPrivateKey(value)) clear();
      }}
    />
  );
}

/**
 * A private-key box over `value`, the key taken (never shown): `onChange` gets each key that can be
 * taken, or undefined on Remove. What is typed is the box's own until then.
 */
export function KeyBox({ label, help, error, value, onChange }: BoxProps & { value: string | undefined; onChange: (key: string | undefined) => void }) {
  const locked = useLocked();
  // Editing state: the text in the box (never filled from `value`); whether the box is open over a
  // key already taken; why refused text that held a key was cleared.
  const [text, setText] = useEditingState('');
  const [open, setOpen] = useEditingState(false);
  const [cleared, setCleared] = useEditingState<string | undefined>(undefined);
  const entered = value !== undefined;
  const close = () => {
    setText('');
    setOpen(false);
  };
  const refuse = (problem: string) => {
    setText('');
    setCleared(t('ssl.pem.keyRefusedCleared', { problem }));
  };

  if (locked) {
    return (
      <Field label={label}>
        <ReadOnlyValue>{entered ? t('ssl.key.entered') : undefined}</ReadOnlyValue>
      </Field>
    );
  }
  if (entered && !open && text === '') {
    return (
      <Field label={label} error={cleared ?? error}>
        <span className="ssl-keyline">
          <span>{t('ssl.key.entered')}</span>
          <Button size="sm" onClick={() => setOpen(true)}>
            {t('ssl.key.replaceKey')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
            {t('ssl.key.remove')}
          </Button>
        </span>
      </Field>
    );
  }
  return (
    <div className="ssl-main">
      <PemInput
        label={label}
        help={help}
        value={text}
        problem={keyProblem(text)}
        error={cleared ?? error}
        autoFocus={open}
        onChange={(next) => {
          setText(next);
          setCleared(undefined);
          if (next.trim() === '' || keyProblem(next) !== undefined) return;
          onChange(next);
          if (completeKey(next)) close();
        }}
        onFile={(next) => {
          const problem = keyProblem(next);
          setCleared(undefined);
          if (problem === undefined) {
            onChange(next);
            close();
          } else if (holdsPrivateKey(next)) refuse(problem);
          else setText(next);
        }}
        onBlur={() => {
          const problem = keyProblem(text);
          if (text.trim() === '' || problem === undefined) close();
          else if (holdsPrivateKey(text)) refuse(problem);
        }}
      />
      {entered && text === '' && <span className="ssl-muted">{t('ssl.key.entered')}</span>}
    </div>
  );
}
