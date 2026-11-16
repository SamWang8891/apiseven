// Field components the upstream sections share: a select with a "Default (x)" choice that clears
// the key, lists edited as lines or as status codes, a titled group of fields, PEM text with
// upload, and the line that shows a problem not tied to one input. Plain helpers are in values.ts.
import { CircleAlert, Upload } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { shown } from '../resources/ssls/pemBox';
import { holdsPrivateKey, MASK } from '../schema/secrets';
import { Button, Field, Input, NumberInput, Select, Switch, TagInput, Textarea, useEditingState, useLocked, usePending, type InputProps, type NumberInputProps } from '../ui';
import { ReadOnlyValue } from '../ui/ReadOnly';
import { certLine } from './values';

/**
 * A number field whose unset value means APISIX's default: the default is the placeholder while
 * editing, and locked it reads "Default (60)" rather than a dash. Help is for editing only: a
 * locked form shows values.
 */
export function NumberField({ byDefault, help, ...rest }: Omit<NumberInputProps, 'placeholder' | 'help'> & { byDefault?: number | string; help?: string }) {
  const locked = useLocked();
  if (locked && rest.value === undefined && byDefault !== undefined) {
    return (
      <Field label={rest.label} error={rest.error}>
        <ReadOnlyValue>{t('up.default', { value: byDefault })}</ReadOnlyValue>
      </Field>
    );
  }
  return <NumberInput {...rest} placeholder={typeof byDefault === 'number' ? String(byDefault) : undefined} help={locked ? undefined : help} />;
}

/** A text field with the same treatment of its default and help as NumberField. */
export function TextField({ byDefault, help, value, ...rest }: Omit<InputProps, 'placeholder' | 'help' | 'value'> & { value: string; byDefault?: string; help?: string }) {
  const locked = useLocked();
  if (locked && value === '' && byDefault !== undefined) {
    return (
      <Field label={rest.label} error={rest.error}>
        <ReadOnlyValue>{t('up.default', { value: byDefault })}</ReadOnlyValue>
      </Field>
    );
  }
  return <Input {...rest} value={value} placeholder={byDefault} help={locked ? undefined : help} />;
}

export interface Choice {
  value: string;
  label: string;
}

/**
 * A select over `choices` plus a first "Default (x)" choice that removes the key. A stored value
 * that isn't among the choices is offered as it is, so it shows and survives.
 */
export function ChoiceSelect({
  label,
  help,
  error,
  value,
  choices,
  defaultLabel,
  mono,
  onChange,
}: {
  label: string;
  help?: ReactNode;
  error?: string;
  value: string | undefined;
  choices: Choice[];
  /** What APISIX uses when the key is unset, as shown in the first choice. */
  defaultLabel: string;
  mono?: boolean;
  onChange: (v: string | undefined) => void;
}) {
  const locked = useLocked();
  const known = value === undefined || choices.some((c) => c.value === value);
  const options = [{ value: '', label: defaultLabel }, ...choices, ...(known ? [] : [{ value: value ?? '', label: value ?? '' }])];
  return (
    <Select
      label={label}
      help={locked ? undefined : help}
      error={error}
      mono={mono}
      value={value ?? ''}
      options={options}
      onChange={(v) => onChange(v === '' ? undefined : v)}
    />
  );
}

/** Lines of text as a list of strings (request headers): blank lines are dropped, and typing a new line works. */
export function LinesInput({ label, help, error, value, onChange }: { label: string; help?: string; error?: string; value: string[]; onChange: (v: string[] | undefined) => void }) {
  const toLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  const locked = useLocked();
  const [text, setText] = useState(() => value.join('\n'));
  const [synced, setSynced] = useState(value);
  if (!same(value, synced)) {
    setSynced(value);
    if (!same(toLines(text), value)) setText(value.join('\n'));
  }
  return (
    <Textarea
      label={label}
      help={locked ? undefined : help}
      error={error}
      mono
      rows={2}
      value={text}
      onChange={(next) => {
        setText(next);
        const lines = toLines(next);
        setSynced(lines);
        onChange(lines.length > 0 ? lines : undefined);
      }}
    />
  );
}

/**
 * A list of HTTP status codes as tags; anything but 200–599 is refused as it is typed. Unset, it
 * means `byDefault` (APISIX's list): the help says so while editing, and locked it reads as such.
 */
export function StatusesInput({ label, byDefault, error, value, onChange }: { label: string; byDefault: string; error?: string; value: unknown; onChange: (v: number[] | undefined) => void }) {
  const locked = useLocked();
  const list = Array.isArray(value) ? value.map(String) : [];
  if (locked && list.length === 0) {
    return (
      <Field label={label} error={error}>
        <ReadOnlyValue>{t('up.default', { value: byDefault })}</ReadOnlyValue>
      </Field>
    );
  }
  return (
    <TagInput
      label={label}
      help={locked ? undefined : t('up.hc.statusesDefault', { value: byDefault })}
      error={error}
      mono
      value={list}
      validate={(tag) => (/^\d{3}$/.test(tag) && Number(tag) >= 200 && Number(tag) <= 599 ? undefined : t('up.hc.statusInvalid'))}
      // Typed tags are digits (validate); a stored entry that isn't a number is written back as it was.
      onChange={(tags) => onChange(tags.length > 0 ? tags.map((tag) => (/^\d+$/.test(tag) ? Number(tag) : tag) as number) : undefined)}
    />
  );
}

/**
 * A group of fields under a small heading (Probe, Timeouts, …), named after it for assistive tech;
 * `three` lays them out three to a row (connect / send / read).
 */
export function Group({ title, three, children, after }: { title: string; three?: boolean; children: ReactNode; after?: ReactNode }) {
  const id = useId();
  const locked = useLocked();
  return (
    <div className="up-group" role="group" aria-labelledby={id}>
      <h4 className="up-group__title" id={id}>
        {title}
      </h4>
      <div className={three ? 'up-row3' : 'ed-grid'}>{children}</div>
      {!locked && after}
    </div>
  );
}

/** Under a setting a stream upstream has stored but APISIX ignores there: shown locked and editing, blocks nothing. */
export function StreamNote() {
  return <p className="up-warn">{t('up.stream.noEffect')}</p>;
}

/** A titled block with its on/off switch beside the title (active checks, slow start); help is for editing only. */
export function SwitchBlock({ title, checked, disabled, onToggle, help, children }: { title: string; checked: boolean; disabled?: boolean; onToggle: (on: boolean) => void; help: string; children: ReactNode }) {
  const id = useId();
  const locked = useLocked();
  return (
    <section className="up-block" role="group" aria-labelledby={id}>
      <div className="up-block__head">
        <h3 className="up-block__title" id={id}>
          {title}
        </h3>
        <Switch aria-label={title} checked={checked} disabled={disabled} onChange={onToggle} />
      </div>
      {!locked && <p className="up-help">{help}</p>}
      {children}
    </section>
  );
}

/** A problem about a whole part of the form (the node list, a block), not one input. */
export function IssueLine({ message }: { message: string | undefined }) {
  if (message === undefined) return null;
  return (
    <p className="up-issue">
      <CircleAlert aria-hidden="true" size={14} strokeWidth={2.25} />
      <span>{message}</span>
    </p>
  );
}

/** A button that picks a text file (a PEM) and hands it over, to be read by the field. */
function UploadButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".pem,.crt,.cer,.key,text/plain"
        className="up-file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button size="sm" variant="ghost" icon={<Upload size={13} />} aria-label={t('up.tls.uploadLabel', { label })} onClick={() => fileRef.current?.click()}>
        {t('up.tls.upload')}
      </Button>
    </>
  );
}

/**
 * Why a certificate field doesn't take `text`: it holds private-key material, or the marker left where
 * some was masked (the SSL editor's CA box, pemBox.ts heldWhy, detects both the same way).
 */
function keyWhy(text: string): string | undefined {
  if (holdsPrivateKey(text)) return t('ssl.pem.hasKey');
  return text.includes(MASK.slice(0, 1)) ? t('ssl.pem.markerCert') : undefined;
}

/**
 * PEM text: pasted, or read from a file. Locked, a certificate that parses reads as its subject and
 * expiry. A certificate field never shows private-key material: a value holding some reads "holds a
 * private key, not shown" (an empty box stands over it and keeps it), and text or a file holding
 * some is refused there. A `secret` (a private key) is never shown once set: it reads "set, not shown" (the stored
 * key) or "a new key was entered, not shown", with Replace (APISIX hands back only its encrypted form
 * anyway). `stored` is the key as the editor last loaded it (from the frame, never what the field saw
 * when it mounted, so a tab switch changes nothing): an empty replacement keeps it, and "Keep the
 * stored key" puts it back; with no stored key neither exists, and an empty box means no key.
 */
export function PemField({
  label,
  value,
  onChange,
  secret,
  error,
  help,
  extra,
  stored,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  secret?: boolean;
  error?: string;
  help?: ReactNode;
  /** More controls beside Upload (e.g. Remove). */
  extra?: ReactNode;
  /** For a `secret`: its value as stored (the frame's); undefined when none is stored. */
  stored?: string;
}) {
  const locked = useLocked();
  /** Session flag: the box was opened with Replace (it ends with the editing session, and on a remount). */
  const [replacing, setReplacing] = useEditingState(false);
  // A file is read asynchronously (final wave F1, as the SSL boxes do, PemInput.tsx): what it finds
  // goes through the handler as it is when the read finishes, so it lands on the draft as it is then,
  // and a read is stale (ignored) once anything later happened to the field: it was typed in, given
  // another file or changed from outside, it locked (a save in flight included) or unlocked, the
  // editing session ended, or it went away.
  const now = useRef({ onChange, value });
  useLayoutEffect(() => {
    now.current = { onChange, value };
  });
  const gestures = useRef(0);
  const [session] = useEditingState(() => ({}));
  useEffect(
    () => () => {
      gestures.current++;
    },
    [session, locked],
  );
  // A certificate field (not `secret`) never shows private-key material (final wave F3, as the SSL
  // editor's CA box): a value holding some (APISIX checks only the length of `ca_certs` entries) is
  // `hidden`, the box empty over it and keeping it; text holding some, or the marker left where some
  // was masked, is not taken: the box holds it (Save refused, naming the field) while the value stays
  // as it was, and its key blocks are masked when the box is left; a file holding some changes nothing,
  // and says why until the box next changes. Editing state: they end with the editing session.
  const hidden = !secret && holdsPrivateKey(value);
  const [held, setHeld] = useEditingState<string | undefined>(undefined);
  const [fileWhy, setFileWhy] = useEditingState<string | undefined>(undefined);
  const heldWhy = held === undefined ? undefined : keyWhy(held);
  usePending(locked || heldWhy === undefined ? undefined : t('ui.pending.problem', { field: label, problem: heldWhy }));
  const read = (file: File) => {
    if (locked) return;
    const mine = ++gestures.current;
    const at = now.current.value;
    void file.text().then((text) => {
      if (gestures.current !== mine || now.current.value !== at) return;
      if (!secret && holdsPrivateKey(text)) {
        setFileWhy(t('ssl.pem.fileHasKey'));
        return;
      }
      setHeld(undefined);
      setFileWhy(undefined);
      now.current.onChange(text.trim() === '' ? undefined : text);
    });
  };
  const type = (v: string | undefined) => {
    gestures.current++;
    onChange(v);
  };
  const typeCert = (text: string) => {
    gestures.current++;
    setFileWhy(undefined);
    if (keyWhy(text) !== undefined) {
      setHeld(text);
      return;
    }
    setHeld(undefined);
    // An empty box over a value it can't show keeps that value.
    if (!(text === '' && hidden)) onChange(text === '' ? undefined : text);
  };
  // Keep the stored key: wherever a new key stands, or a replacement box is open over the stored one.
  const keep = secret && stored !== undefined && (value !== stored || replacing) && (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        gestures.current++;
        onChange(stored);
        setReplacing(false);
      }}
    >
      {t('up.tls.keepKey')}
    </Button>
  );
  // Key material is detected before any parsing.
  const parsed = secret || hidden ? undefined : certLine(value);
  const upload = <UploadButton label={label} onFile={read} />;

  if (locked) {
    if (hidden) {
      return (
        <Field label={label} error={error}>
          <ReadOnlyValue>{t('up.tls.keyInCert')}</ReadOnlyValue>
        </Field>
      );
    }
    return (
      <Field label={label} error={error}>
        {secret || parsed !== undefined || !value ? (
          <ReadOnlyValue>{value ? (secret ? t('up.tls.keyStored') : parsed) : undefined}</ReadOnlyValue>
        ) : (
          <ReadOnlyValue mono className="ro-value--block">
            {value}
          </ReadOnlyValue>
        )}
      </Field>
    );
  }

  if (secret && value && !replacing) {
    return (
      <Field label={label} help={help} error={error}>
        <span className="up-pem__stored">
          <span>{value === stored ? t('up.tls.keyStored') : t('up.tls.keyEntered')}</span>
          <Button
            size="sm"
            onClick={() => {
              gestures.current++;
              setReplacing(true);
              // An empty replacement means the stored key (or none): rule 3 of a secret field.
              if (value !== stored) onChange(stored);
            }}
          >
            {t('up.tls.replaceKey')}
          </Button>
          {upload}
          {extra}
          {keep}
        </span>
      </Field>
    );
  }

  if (!secret) {
    const problems = [fileWhy, heldWhy ?? error].filter((m): m is string => m !== undefined && m !== '');
    return (
      <div className="up-pem">
        <Textarea
          label={label}
          help={hidden && held === undefined ? t('up.tls.keyInCertKept') : (parsed ?? help)}
          error={problems.length > 0 ? problems.join(' ') : undefined}
          mono
          rows={4}
          value={held ?? (hidden || value === undefined ? '' : value)}
          placeholder="-----BEGIN …-----"
          onChange={typeCert}
          // Leaving masks the key blocks of text that was not taken; it stays held.
          onBlur={() => held !== undefined && setHeld(shown('cert', held, false))}
        />
        <span className="up-pem__bar">
          {upload}
          {extra}
        </span>
      </div>
    );
  }

  return (
    <div className="up-pem">
      <Textarea
        label={label}
        help={parsed ?? help}
        error={error}
        mono
        rows={4}
        value={value === undefined || (replacing && value === stored) ? '' : value}
        placeholder="-----BEGIN …-----"
        onChange={(text) => type(text === '' ? (replacing ? stored : undefined) : text)}
      />
      {secret && replacing && <p className="up-help">{stored !== undefined ? t('up.tls.emptyStored') : t('up.tls.emptyNone')}</p>}
      <span className="up-pem__bar">
        {upload}
        {extra}
        {replacing && keep}
      </span>
    </div>
  );
}
