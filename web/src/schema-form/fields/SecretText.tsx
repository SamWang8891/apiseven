// A multi-line secret while editing (a PEM private key, a service account key: StringField). A value
// that was set when editing began is not put on the page: the field says it is set, and offers Show
// (a box with the value, hidden again by Hide or any lock change: useReveal) and Replace (an empty box;
// what is typed is the value, and while it is empty the value is what it replaced, which Keep goes
// back to). An untouched save sends the value back as it was. A value that was empty when editing
// began is the user's own text: its box stays (it never turns into the masked view while typing).
// Every keystroke is the value; nothing is held, and leaving a box changes nothing (addendum 20).
import { Eye, EyeOff, Replace } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Field, Textarea, useEditingState, useReveal } from '../../ui';

export interface SecretTextProps {
  /** The field's common props, as StringField builds them. */
  common: { id: string; label?: ReactNode; help?: ReactNode; error?: string; required?: boolean; placeholder?: string; 'aria-label'?: string };
  /** The property's name, for the buttons' accessible names. */
  name: string;
  value: string;
  mono: boolean;
  rows: number;
  /** The next text ('' clears the field). */
  onText: (text: string) => void;
}

export function SecretText({ common, name, value, mono, rows, onText }: SecretTextProps) {
  /** Reveal: hidden again on every lock change (Save included). */
  const [revealed, setRevealed] = useReveal();
  /** Editing state: the value was empty when editing began, so the box is the user's own text. */
  const [open] = useEditingState(() => value === '');
  /** Editing state: a replacement in progress: the value it replaces, and the text typed so far. */
  const [replacing, setReplacing] = useEditingState<{ before: string; text: string } | undefined>(undefined);

  if (replacing) {
    return (
      <div className="sf-secret">
        <div className="sf-secret__box">
          <Textarea
            {...common}
            mono={mono}
            rows={rows}
            value={replacing.text}
            help={replacing.text === '' ? t('sf.secret.kept') : common.help}
            onChange={(text) => {
              setReplacing({ ...replacing, text });
              onText(text === '' ? replacing.before : text);
            }}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setReplacing(undefined);
            onText(replacing.before);
          }}
        >
          {t('sf.secret.keep')}
        </Button>
      </div>
    );
  }

  if (open || revealed || value === '') {
    return (
      <div className="sf-secret">
        <div className="sf-secret__box">
          <Textarea {...common} mono={mono} rows={rows} value={value} onChange={onText} />
        </div>
        {!open && value !== '' && (
          <Button size="sm" variant="ghost" icon={<EyeOff size={13} />} aria-label={t('sf.secret.hide', { name })} onClick={() => setRevealed(false)}>
            {t('sf.secret.hideShort')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <Field label={common.label} help={common.help} error={common.error} required={common.required}>
      <div className="sf-secret__set">
        <span className="sf-secret__stored">{t('sf.secret.stored')}</span>
        <Button size="sm" variant="ghost" icon={<Eye size={13} />} aria-label={t('sf.secret.show', { name })} onClick={() => setRevealed(true)}>
          {t('sf.secret.showShort')}
        </Button>
        <Button size="sm" variant="ghost" icon={<Replace size={13} />} aria-label={t('sf.secret.replace', { name })} onClick={() => setReplacing({ before: value, text: '' })}>
          {t('sf.secret.replaceShort')}
        </Button>
      </div>
    </Field>
  );
}
