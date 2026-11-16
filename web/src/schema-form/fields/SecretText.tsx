// A multi-line secret in a form (a PEM private key, a service account key: StringField), following
// the rule for a secret field (Task 15, fix round 3):
// 1. `stored` is the field's value in the object as the editor last loaded it (SchemaForm's baseline,
//    read at the field's path: useStoredAt), never what this component saw when it mounted.
// 2. What it shows is a function of (stored, value, the session's flags, locked) only, so it is the
//    same after a tab switch, a Form / JSON toggle, a collapse, a late refused save or a refresh:
//    - not editing (locked, no save in flight): the kit's masked input, with its reveal; never text;
//    - an open box (typed in this session, or revealed), or no stored value and no value: the box;
//    - value === stored: "Set, not shown", with Show and Replace;
//    - value !== stored and not empty: "A new value was entered, not shown", with Show, Replace and,
//      only when stored exists, "Keep the stored value"; where what is stored can't be known (below a
//      list's or a map's rows), "A value is set, not shown", with no Keep;
//    - no value where one is stored (removed elsewhere, the JSON tab): says Save removes it, with
//      Replace and "Keep the stored value".
//    A save in flight (useBusy) shows what was shown before Save, inert (no actions, the box read-only).
// 3. "Keep the stored value" sets the value to stored (and closes an open box), and exists only when
//    stored exists (where another value stands, or a box is open over the stored one). An empty
//    box means stored stays when stored exists, and no value otherwise; the words under the box say
//    which, from the same two facts.
// 4. Every keystroke is the value; nothing is held; leaving the box changes nothing (addendum 20).
// The session's flags (useEditingState: the box's text, revealed) start over with each editing
// session and are lost on a remount; nothing shown depends on their surviving one.
// 5. A never-shown secret (`neverShown`: a client_key, or a value holding a PEM private key, stored or
//    entered: fix round 1, R1) has no Show anywhere: locked, "Set, not shown" in words; editing, the same
//    words as above without Show, and a box only for text typed in this session (Replace opens it
//    empty), as the upstream editor's key field does. A key typed or pasted into the box shows until
//    the box is left; then the box closes and the words say a new value was entered.
import { Eye, EyeOff, Replace, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Button, Field, Input, Textarea, useBusy, useEditingState, useLocked } from '../../ui';
import { ReadOnlyValue } from '../../ui/ReadOnly';
import { holdsPrivateKey } from '../../schema/secrets';

export interface SecretTextProps {
  /** The field's common props, as StringField builds them. */
  common: { id: string; label?: ReactNode; help?: ReactNode; error?: string; required?: boolean; placeholder?: string; 'aria-label'?: string };
  /** The property's name, for the buttons' accessible names. */
  name: string;
  /** The value in the draft ('' for none). */
  value: string;
  /** The value as stored in APISIX (the form's baseline at this path); undefined for none. */
  stored: string | undefined;
  /** Whether `stored` is known: below a list's or a map's rows it is not (context.ts BelowRows), so a value there is only "set". */
  storedKnown?: boolean;
  mono: boolean;
  rows: number;
  /** Never shown, not even on request (rule 5). */
  neverShown?: boolean;
  /** The next value ('' clears the field). */
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

export function SecretText({ common, name, value, stored, storedKnown = true, mono, rows, neverShown = false, onText }: SecretTextProps) {
  const locked = useLocked();
  const busy = useBusy();
  /** Session flag: the text typed in the open box this session (undefined: no box opened by typing or Replace). */
  const [boxText, setBoxText] = useEditingState<string | undefined>(undefined);
  /** Session flag: the value is shown (never for a never-shown one). */
  const [shownFlag, setRevealed] = useEditingState(false);
  const revealed = shownFlag && !neverShown;

  // Not editing: the masked input of the locked view (its own reveal), whatever a refresh brought; a
  // never-shown value only in words.
  if (locked && !busy) {
    if (!neverShown) return <Input {...common} mono={mono} secret value={value} />;
    return (
      <Field label={common.label} help={common.help} error={common.error} required={common.required}>
        <ReadOnlyValue>{value !== '' ? t('sf.secret.stored') : undefined}</ReadOnlyValue>
      </Field>
    );
  }

  const acting = !locked;
  const has = value !== '';
  /** What an empty box writes: the stored value when there is one, else none (rule 3). */
  const emptied = stored ?? '';
  const emptyWords = stored !== undefined ? t('sf.secret.emptyStored') : t('sf.secret.emptyNone');
  const type = (text: string) => {
    setBoxText(text);
    onText(text === '' ? emptied : text);
  };
  // Keep the stored value: wherever another value stands, or a box is open over the stored one.
  const keep = acting && stored !== undefined && (value !== stored || boxText !== undefined) && (
    <Button
      size="sm"
      variant="ghost"
      icon={<Undo2 size={13} />}
      onClick={() => {
        setBoxText(undefined);
        setRevealed(false);
        onText(stored);
      }}
    >
      {t('sf.secret.keep')}
    </Button>
  );

  // A box: typed in this session, revealed, or nothing to keep and nothing entered.
  if (boxText !== undefined || (revealed && has) || (!has && stored === undefined)) {
    const text = boxText ?? (revealed ? value : '');
    return (
      <div
        className="sf-secret"
        onBlur={(e) => {
          // Left (focus outside the box and its buttons) with a private key in it: masked from now on
          // (rule 5); other text stays as typed.
          if (e.currentTarget.contains(e.relatedTarget)) return;
          if (holdsPrivateKey(boxText)) setBoxText(undefined);
        }}
      >
        <div className="sf-secret__box">
          <Textarea
            {...common}
            mono={mono}
            rows={rows}
            value={text}
            help={acting ? helpWith(common.help, emptyWords) : undefined}
            onChange={type}
          />
        </div>
        {(keep || (acting && revealed && boxText === undefined)) && (
          <span className="sf-secret__tools">
            {acting && revealed && boxText === undefined && (
              <Button size="sm" variant="ghost" icon={<EyeOff size={13} />} aria-label={t('sf.secret.hide', { name })} onClick={() => setRevealed(false)}>
                {t('sf.secret.hideShort')}
              </Button>
            )}
            {keep}
          </span>
        )}
      </div>
    );
  }

  // A value not shown: the stored one, a new one, or none where one is stored; where what is stored
  // can't be known, only that a value is set (fix round 1, R2.1).
  const words = !has ? t('sf.secret.removed') : value === stored ? t('sf.secret.stored') : storedKnown ? t('sf.secret.entered') : t('sf.secret.set');
  return (
    <Field label={common.label} help={common.help} error={common.error} required={common.required}>
      <div className="sf-secret__set">
        <span className="sf-secret__stored">{words}</span>
        {acting && has && !neverShown && (
          <Button size="sm" variant="ghost" icon={<Eye size={13} />} aria-label={t('sf.secret.show', { name })} onClick={() => setRevealed(true)}>
            {t('sf.secret.showShort')}
          </Button>
        )}
        {acting && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Replace size={13} />}
            aria-label={t('sf.secret.replace', { name })}
            onClick={() => {
              setRevealed(false);
              setBoxText('');
              if (value !== emptied) onText(emptied);
            }}
          >
            {t('sf.secret.replaceShort')}
          </Button>
        )}
        {keep}
      </div>
    </Field>
  );
}
