// Field components the upstream sections share: a select with a "Default (x)" choice that clears
// the key, lists edited as lines or as status codes, a titled group of fields, PEM text with
// upload, and the line that shows a problem not tied to one input. Plain helpers are in values.ts.
import { CircleAlert, Upload } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';
import { Button, Field, Input, NumberInput, Select, Switch, TagInput, Textarea, useEditingState, useLocked, type InputProps, type NumberInputProps } from '../ui';
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

/** A button that reads a text file (a PEM) and hands over its content. */
function UploadButton({ label, onText }: { label: string; onText: (text: string) => void }) {
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
          if (file) void file.text().then(onText);
        }}
      />
      <Button size="sm" variant="ghost" icon={<Upload size={13} />} aria-label={t('up.tls.uploadLabel', { label })} onClick={() => fileRef.current?.click()}>
        {t('up.tls.upload')}
      </Button>
    </>
  );
}

/**
 * PEM text: pasted, or read from a file. Locked, a certificate that parses reads as its subject and
 * expiry. A `secret` (a private key) is never shown once set: it reads "set, not shown" with a
 * Replace (APISIX hands back only its encrypted form anyway); an empty replacement keeps it.
 */
export function PemField({
  label,
  value,
  onChange,
  secret,
  error,
  help,
  extra,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  secret?: boolean;
  error?: string;
  help?: ReactNode;
  /** More controls beside Upload (e.g. Remove). */
  extra?: ReactNode;
}) {
  const locked = useLocked();
  /**
   * While replacing a stored secret: the value it had, kept until something else is typed. It ends
   * with the editing session (Save, Discard): the next Edit starts from the stored-key view again.
   */
  const [replacing, setReplacing] = useEditingState<string | undefined>(undefined);
  const parsed = secret ? undefined : certLine(value);
  const upload = <UploadButton label={label} onText={(text) => onChange(text.trim() === '' ? undefined : text)} />;

  if (locked) {
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

  if (secret && value && replacing === undefined) {
    return (
      <Field label={label} help={help} error={error}>
        <span className="up-pem__stored">
          <span>{t('up.tls.keyStored')}</span>
          <Button size="sm" onClick={() => setReplacing(value)}>
            {t('up.tls.replaceKey')}
          </Button>
          {upload}
          {extra}
        </span>
      </Field>
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
        value={value === undefined || value === replacing ? '' : value}
        placeholder="-----BEGIN …-----"
        onChange={(text) => onChange(text === '' ? replacing : text)}
      />
      <span className="up-pem__bar">
        {upload}
        {extra}
        {replacing !== undefined && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange(replacing);
              setReplacing(undefined);
            }}
          >
            {t('up.tls.keepKey')}
          </Button>
        )}
      </span>
    </div>
  );
}
