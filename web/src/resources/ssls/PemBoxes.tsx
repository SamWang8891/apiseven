// The SSL editor's two kinds of PEM box, on PemInput. Neither lets a private key rest on the page,
// and a refused file leaves the box and what the field holds as they were, with a word on why:
// - CertBox (a certificate, a CA): text that also holds a private key (a combined file) is refused as
//   typed; when the box is left it gives way to `standing`, what the field holds (the draft's
//   certificate), and says why; such a file is never put in the box.
// - KeyBox (a private key). The rule for when a key counts as taken: only when it is whole, PEM with
//   its BEGIN and END lines or a $secret:// / $env:// reference (wholeKey), whether it was typed,
//   pasted, uploaded or dropped. Until then nothing new is taken: what stands is the key entered before
//   the box was opened, or none, and the open box says which. A whole PEM key leaves the box at once;
//   one line then reads "Private key entered, not shown", with Replace key and Remove. A half key left
//   in the box is held as unfinished input (Save and the dialog's primary action refuse); refused text
//   that holds a whole key (an encrypted one) is cleared when the box is left.
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { holdsPrivateKey } from '../../schema/secrets';
import { Button, Field, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { certProblem, keyBoxProblem, keyProblem, wholeKey } from './pem';
import { PemInput } from './PemInput';
import { isSecretRef } from './validate';

interface BoxProps {
  label: string;
  help?: ReactNode;
  error?: string;
}

/**
 * A certificate box over `value` (the text shown); `onChange` gets every text it shows. `standing` is
 * what the field holds now (the draft's certificate, none in a dialog): refused text that held a key
 * gives way to it when the box is left.
 */
export function CertBox({ label, help, error, value, onChange, standing }: BoxProps & { value: string; onChange: (text: string) => void; standing?: string }) {
  // Editing state: why the last text or file was not taken.
  const [notice, setNotice] = useEditingState<string | undefined>(undefined);
  return (
    <PemInput
      label={label}
      help={help}
      value={value}
      problem={certProblem(value)}
      error={notice ?? error}
      onChange={(text) => {
        setNotice(undefined);
        onChange(text);
      }}
      onFile={(text) => {
        if (holdsPrivateKey(text)) setNotice(t('ssl.pem.fileHasKey'));
        else {
          setNotice(undefined);
          onChange(text);
        }
      }}
      onBlur={() => {
        if (!holdsPrivateKey(value)) return;
        setNotice(t('ssl.pem.keyCleared'));
        onChange(standing !== undefined && !holdsPrivateKey(standing) ? standing : '');
      }}
    />
  );
}

/**
 * A private-key box over `value`, the key taken (never shown): `onChange` gets each key that is taken,
 * the one that stood before when the box no longer holds a whole key, or undefined on Remove.
 */
export function KeyBox({ label, help, error, value, onChange }: BoxProps & { value: string | undefined; onChange: (key: string | undefined) => void }) {
  const locked = useLocked();
  // Editing state: the text in the box (never filled from `value`); whether the box is open over a
  // key already taken; the key that stood when typing began (`{}` until it does); why the last text
  // or file was not taken.
  const [text, setText] = useEditingState('');
  const [open, setOpen] = useEditingState(false);
  const [before, setBefore] = useEditingState<{ key?: string } | undefined>(undefined);
  const [notice, setNotice] = useEditingState<string | undefined>(undefined);
  const entered = value !== undefined;
  const close = () => {
    setText('');
    setOpen(false);
    setBefore(undefined);
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
      <Field label={label} error={notice ?? error}>
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
  const standing = before ?? { key: value };
  return (
    <div className="ssl-main">
      <PemInput
        label={label}
        help={help}
        value={text}
        problem={keyBoxProblem(text)}
        error={notice ?? error}
        autoFocus={open}
        onChange={(next) => {
          setText(next);
          setNotice(undefined);
          if (!before) setBefore(standing);
          if (wholeKey(next)) {
            onChange(next);
            // A whole PEM key leaves the page at once; a reference may still be being typed.
            if (!isSecretRef(next.trim())) close();
          } else if (value !== standing.key) onChange(standing.key);
        }}
        onFile={(next) => {
          if (wholeKey(next)) {
            setNotice(undefined);
            onChange(next);
            close();
          } else setNotice(t('ssl.pem.fileRefused', { problem: keyBoxProblem(next) ?? t('ssl.pem.noKeyLabel') }));
        }}
        onBlur={() => {
          if (text.trim() === '' || wholeKey(text)) close();
          else if (holdsPrivateKey(text) && keyProblem(text) !== undefined) {
            // A whole key that is refused (encrypted): it doesn't rest in the box.
            setNotice(t('ssl.pem.keyRefusedCleared', { problem: keyProblem(text) ?? '' }));
            close();
          }
        }}
      />
      {entered && !wholeKey(text) && <span className="ssl-muted">{t('ssl.key.stays')}</span>}
    </div>
  );
}
