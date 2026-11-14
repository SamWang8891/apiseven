import { X } from 'lucide-react';
import { useRef, type ClipboardEvent, type ComponentProps, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { Field, type FieldProps } from './Field';
import { nameOfField, useFieldIds } from './fieldIds';
import { useEditingState, useLocked } from './LockContext';
import { usePending } from './PendingContext';
import { ReadOnlyValue } from './ReadOnly';
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

/**
 * A list of short strings. Enter, comma, Tab or leaving the box adds what was typed; a paste is split
 * on whitespace and commas; Backspace in the empty box removes the last tag; duplicates are skipped.
 * Text `validate` refuses stays in the box, flagged, and holds Save (usePending) until it is changed.
 */
export function TagInput({
  label, help, error, required, htmlFor, id, value, onChange, validate, mono, placeholder, className, disabled, onBlur, fieldName, ...native
}: TagInputProps) {
  const locked = useLocked();
  const [draft, setDraft] = useEditingState('');
  const [rejected, setRejected] = useEditingState<string | undefined>(undefined);
  // Text still being typed is added when the box is left (an editor's Save leaves it first); text
  // that was refused cannot be, so Save waits for it.
  const text = draft.trim();
  usePending(
    locked || rejected === undefined || text === ''
      ? undefined
      : t('ui.pending.tag', { field: nameOfField(fieldName, label, native['aria-label']), text, reason: rejected }),
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

  /** Adds the candidates that pass; returns the text to leave in the box (the first refused one). */
  function add(candidates: string[]): string {
    const next = [...value];
    for (const tag of candidates.map((c) => c.trim()).filter(Boolean)) {
      if (next.includes(tag)) continue;
      const message = validate?.(tag);
      if (message) {
        setRejected(message);
        if (next.length > value.length) onChange(next);
        return tag;
      }
      next.push(tag);
    }
    setRejected(undefined);
    if (next.length > value.length) onChange(next);
    return '';
  }

  function commit(): boolean {
    if (!draft.trim()) return true;
    const left = add([draft]);
    setDraft(left);
    return left === '';
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      if (draft.trim() || e.key === ',') e.preventDefault();
      commit();
    } else if (e.key === 'Tab' && draft.trim()) {
      // Move on as usual once the tag is in; stay put if it was refused, so the message is seen.
      if (!commit()) e.preventDefault();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      e.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!/[\s,]/.test(text)) return;
    e.preventDefault();
    setDraft(add((draft + text).split(/[\s,]+/)));
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
              <button
                type="button"
                className="ui-chip__remove"
                aria-label={t('ui.tags.remove', { tag })}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X aria-hidden="true" size={12} strokeWidth={2.5} />
              </button>
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
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={(e) => {
            commit();
            onBlur?.(e);
          }}
        />
      </div>
    </Field>
  );
}
