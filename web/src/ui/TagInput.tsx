import { X } from 'lucide-react';
import { useRef, type ClipboardEvent, type ComponentProps, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { Field, type FieldProps } from './Field';
import { nameOfField, useFieldIds } from './fieldIds';
import { useEditingState, useLocked } from './LockContext';
import { usePending } from './PendingContext';
import { holdsPrivateKey, withoutPrivateKeys } from './privateKeys';
import { ReadOnlyValue } from './ReadOnly';
import { LabelTip } from './Tooltip';
import './collection.css';

export type TagInputProps = Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'children' | 'type'> &
  FieldProps & {
    value: string[];
    onChange: (v: string[]) => void;
    /** Returns a message to refuse a tag; the text stays in the box with the message shown. */
    validate?: (tag: string) => string | undefined;
    mono?: boolean;
    /** How a refused Save names the field while it holds refused text; default: the label (if text) or aria-label. */
    fieldName?: string;
  };

/** What a paste is split on. */
const SEPARATORS = /[\s,]+/;
const SEPARATED = /[\s,]/;
/** The mark of the words left where a private key was taken out of the box (ssl.pem.marker): never part of a tag. */
const TAKEN_OUT = '•';

/**
 * A list of short strings. Enter, comma, Tab or leaving the box adds what was typed; a paste replaces
 * the selection (or goes in at the caret) and the box's text is then split on whitespace and commas
 * (final wave O2); Backspace in the empty box removes the last tag; duplicates are skipped. Text
 * `validate` refuses stays in the box, flagged, and holds Save (usePending) until it is changed. When a
 * part of a paste is refused, the parts before it are added, and it and every part after it stay in
 * the box, so nothing pasted is lost; that text is split the same way when it is next committed, once
 * the refused part is corrected (final wave O1). Text typed is one tag, spaces and all, also when it
 * is typed over the whole of such text (fix round 1, F4). A private key in text left refused is taken
 * out of the page when the box is left, its words in its place, which are never added as a tag; the
 * held message never quotes a key (Codex final pass, fix round 1, Y2).
 */
export function TagInput({
  label, help, error, required, htmlFor, id, value, onChange, validate, mono, placeholder, className, disabled, onBlur, fieldName, ...native
}: TagInputProps) {
  const locked = useLocked();
  const [draft, setDraft] = useEditingState('');
  const [rejected, setRejected] = useEditingState<string | undefined>(undefined);
  /** Editing state: the box holds several parts of a paste, left after a refused one: committed, they are split again (O1). */
  const [parts, setParts] = useEditingState(false);
  /** A key that types a character went down with the whole text selected: what it types replaces all of it, so it is typed text (F4). */
  const overAll = useRef(false);
  // Text still being typed is added when the box is left (an editor's Save leaves it first); text
  // that was refused cannot be, so Save waits for it.
  const text = draft.trim();
  usePending(
    locked || rejected === undefined || text === ''
      ? undefined
      : t('ui.pending.tag', { field: nameOfField(fieldName, label, native['aria-label']), text: withoutPrivateKeys(text, t('ssl.pem.marker')), reason: rejected }),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const shownError = rejected ?? error;
  const ids = useFieldIds(id ?? htmlFor, { help, error: shownError });
  const field = { label, help, error: shownError, required, htmlFor: locked ? undefined : ids.id };

  if (locked) {
    return (
      <Field {...field} error={error}>
        <ReadOnlyValue className="ro-value--chips">
          {value.length === 0
            ? undefined
            : value.map((tag, i) => (
              // Keyed by position too: a value loaded from the API may repeat a tag.
              <span key={`${i}:${tag}`} className={mono ? 'ui-chip mono' : 'ui-chip'}>
                {tag}
              </span>
            ))}
        </ReadOnlyValue>
      </Field>
    );
  }

  /**
   * Adds the candidates that pass, in order, up to the first one refused; returns the text to leave in
   * the box: that one and every one after it, not looked at yet (O1), or '' when all were taken.
   */
  function add(candidates: string[]): string {
    const next = [...value];
    const tags = candidates.map((c) => c.trim()).filter(Boolean);
    for (const [i, tag] of tags.entries()) {
      if (next.includes(tag)) continue;
      const message = tag.includes(TAKEN_OUT) ? t('ui.tags.keyOut') : validate?.(tag);
      if (message) {
        setRejected(message);
        if (next.length > value.length) onChange(next);
        return tags.slice(i).join(' ');
      }
      next.push(tag);
    }
    setRejected(undefined);
    if (next.length > value.length) onChange(next);
    return '';
  }

  /** Splits `text` as a paste is split, adds what passes, and leaves the rest in the box. */
  function addParts(text: string): string {
    const left = add(text.split(SEPARATORS));
    setDraft(left);
    setParts(SEPARATED.test(left));
    return left;
  }

  /** Adds what the box holds; returns the text left in it ('' when all was taken). */
  function commit(): string {
    if (!draft.trim()) return '';
    if (parts) return addParts(draft);
    const left = add([draft]);
    setDraft(left);
    return left;
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    overAll.current = false;
    if (e.key === 'Enter' || e.key === ',') {
      if (draft.trim() || e.key === ',') e.preventDefault();
      commit();
    } else if (e.key === 'Tab' && draft.trim()) {
      // Move on as usual once the tag is in; stay put if it was refused, so the message is seen.
      if (commit() !== '') e.preventDefault();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const box = e.currentTarget;
      overAll.current = box.value !== '' && box.selectionStart === 0 && box.selectionEnd === box.value.length;
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    overAll.current = false;
    // One word: the browser puts it where the selection is, as typing would.
    if (!SEPARATED.test(text)) return;
    e.preventDefault();
    // Several: the paste replaces the selection (or goes in at the caret) first, then the box's text is split (O2).
    const { selectionStart, selectionEnd } = e.currentTarget;
    const start = selectionStart ?? draft.length;
    const end = selectionEnd ?? start;
    addParts(draft.slice(0, start) + text + draft.slice(end));
  }

  const classes = ['ui-tags', shownError && 'ui-tags--error', disabled && 'ui-tags--disabled', className].filter(Boolean).join(' ');

  return (
    <Field {...field}>
      {/* A click on the box's padding focuses the text input, as it would in a plain input. */}
      <div
        className={classes}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {value.map((tag, i) => (
          <span key={`${i}:${tag}`} className={mono ? 'ui-chip mono' : 'ui-chip'}>
            {tag}
            {!disabled && (
              <LabelTip label={t('ui.tags.remove', { tag })}>
                <button type="button" className="ui-chip__remove" aria-label={t('ui.tags.remove', { tag })} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                  <X aria-hidden="true" size={12} strokeWidth={2.5} />
                </button>
              </LabelTip>
            )}
          </span>
        ))}
        <input
          {...native}
          ref={inputRef}
          id={ids.id}
          type="text"
          disabled={disabled}
          value={draft}
          placeholder={value.length === 0 ? (placeholder ?? t('ui.tags.placeholder')) : undefined}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={ids.describedBy}
          autoComplete="off"
          spellCheck={mono ? false : native.spellCheck}
          className={mono ? 'ui-tags__input mono' : 'ui-tags__input'}
          onChange={(e) => {
            setDraft(e.target.value);
            setRejected(undefined);
            // Emptied, or typed over as a whole (fix round 1, F4), the box holds no part of a paste any more: what is typed is one tag.
            if (e.target.value === '' || overAll.current) setParts(false);
            overAll.current = false;
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={(e) => {
            const left = commit();
            // Text left refused stays, held (addendum rule 20), but a private key in it is taken out of
            // the page, its words in its place, as one piece from then on (fix round 1, Y2).
            if (holdsPrivateKey(left)) {
              setDraft(withoutPrivateKeys(left, t('ssl.pem.marker')));
              setParts(false);
            }
            onBlur?.(e);
          }}
        />
      </div>
    </Field>
  );
}
