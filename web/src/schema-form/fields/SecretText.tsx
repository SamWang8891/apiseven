// A multi-line secret (a PEM private key, a service account key: StringField), locked or not. A value
// the field had when the editing session began is not put on the page: the field says it is set, and
// offers Show (a box with the value) and Replace (an empty box; what is typed is the value, and while
// it is empty the value is the one the field had when editing began, which Keep goes back to). An
// untouched save sends the value back as it was. A field that was empty when editing began is the
// user's own text: its box stays, and emptying it means no value. Every keystroke is the value;
// nothing is held, and leaving a box changes nothing (addendum 20).
// It stays mounted whether locked or not, and its state is the editing session's (useEditingState):
// a save in flight locks the fields but is not the end of a session, so what the field shows then is
// what it showed before Save, read-only; after a refused save it is exactly as it was; after an
// accepted one (a new session) it is "Set, not shown" again. The locked view of a stored value is
// the kit's masked input.
import { Eye, EyeOff, Replace } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Field, Input, Textarea, useEditingState, useLocked } from '../../ui';

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

/** The field's help, then what an empty box saves. */
const helpWith = (help: ReactNode, empty: string): ReactNode => (
  <>
    {help}
    {help !== undefined && ' '}
    <span>{empty}</span>
  </>
);

export function SecretText({ common, name, value, mono, rows, onText }: SecretTextProps) {
  const locked = useLocked();
  /** Editing state: the value when the editing session began (what Keep and an empty Replace box mean). */
  const [initial] = useEditingState(() => value);
  /** The field was empty when editing began: its box is the user's own text, and stays. */
  const open = initial === '';
  /** Editing state: the value is shown (until Hide or the end of the session). */
  const [revealed, setRevealed] = useEditingState(false);
  /** Editing state: a replacement in progress, the text typed so far. */
  const [replacing, setReplacing] = useEditingState<string | undefined>(undefined);
  const box = (text: string, onChange: (text: string) => void, empty: string) => (
    <div className="sf-secret__box">
      <Textarea {...common} mono={mono} rows={rows} value={text} help={locked ? undefined : helpWith(common.help, empty)} onChange={onChange} />
    </div>
  );

  if (replacing !== undefined) {
    return (
      <div className="sf-secret">
        {box(
          replacing,
          (text) => {
            setReplacing(text);
            onText(text === '' ? initial : text);
          },
          t('sf.secret.kept'),
        )}
        {!locked && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setReplacing(undefined);
              onText(initial);
            }}
          >
            {t('sf.secret.keep')}
          </Button>
        )}
      </div>
    );
  }

  // The box, while editing (and, read-only, while a save of it is in flight): the value is revealed,
  // or the field was empty when editing began, or is empty now.
  const showBox = locked ? revealed || (open && value !== '') : revealed || open || value === '';
  if (showBox) {
    return (
      <div className="sf-secret">
        {box(value, onText, t('sf.secret.emptyNone'))}
        {!open && !locked && value !== '' && (
          <Button size="sm" variant="ghost" icon={<EyeOff size={13} />} aria-label={t('sf.secret.hide', { name })} onClick={() => setRevealed(false)}>
            {t('sf.secret.hideShort')}
          </Button>
        )}
      </div>
    );
  }

  if (locked) return <Input {...common} mono={mono} secret value={value} />;

  return (
    <Field label={common.label} help={common.help} error={common.error} required={common.required}>
      <div className="sf-secret__set">
        <span className="sf-secret__stored">{t('sf.secret.stored')}</span>
        <Button size="sm" variant="ghost" icon={<Eye size={13} />} aria-label={t('sf.secret.show', { name })} onClick={() => setRevealed(true)}>
          {t('sf.secret.showShort')}
        </Button>
        <Button size="sm" variant="ghost" icon={<Replace size={13} />} aria-label={t('sf.secret.replace', { name })} onClick={() => setReplacing('')}>
          {t('sf.secret.replaceShort')}
        </Button>
      </div>
    </Field>
  );
}
