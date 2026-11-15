import { Check, Minus } from 'lucide-react';
import { Checkbox } from 'radix-ui';
import type { KeyboardEvent, ReactNode, Ref } from 'react';
import { Link } from 'react-router';
import type { Item, Kind, Parent } from '../api/types';
import { t } from '../i18n';
import { pathFor } from '../router/paths';
import { Tooltip } from '../ui';
import { clipTitle } from '../ui/clipTitle';
import { isEmptyValue } from './sort';

/** How many lines of a list a cell shows before `+N more`. */
const SHOWN_LINES = 3;

/** A value as one line of text: objects as compact JSON. */
function line(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}

/** The empty mark. */
export function Empty() {
  return <span className="tbl-empty">{t('ui.empty')}</span>;
}

/** Up to three lines, then `+N more` with the whole list in a tooltip. */
export function Lines({ lines, mono }: { lines: string[]; mono?: boolean }) {
  const cls = mono ? 'tbl-line mono' : 'tbl-line';
  const hidden = lines.length - SHOWN_LINES;
  return (
    <>
      {lines.slice(0, SHOWN_LINES).map((text, i) => (
        <span key={i} className={cls} {...clipTitle(text)}>
          {text}
        </span>
      ))}
      {hidden > 0 && (
        <Tooltip
          content={
            <span className="tbl-tip-lines">
              {lines.map((text, i) => (
                <span key={i} className={mono ? 'mono' : undefined}>
                  {text}
                </span>
              ))}
            </span>
          }
        >
          <button type="button" className="tbl-more">
            {t('table.more', { count: hidden })}
          </button>
        </Tooltip>
      )}
    </>
  );
}

/**
 * What a column without its own `cell` shows: text and numbers as they are, booleans as Yes/No,
 * lists one per line, objects as compact JSON, and — for undefined, null, '' and [].
 */
export function DefaultCell({ value, mono }: { value: unknown; mono?: boolean }): ReactNode {
  if (isEmptyValue(value)) return <Empty />;
  if (Array.isArray(value)) return <Lines lines={value.map(line)} mono={mono} />;
  if (typeof value === 'boolean') return t(value ? 'ui.yes' : 'ui.no');
  const isObject = typeof value === 'object';
  const text = line(value);
  return (
    <span className={mono || isObject ? 'tbl-line mono' : 'tbl-line'} {...clipTitle(text)}>
      {text}
    </span>
  );
}

/** The name column without a cell of its own: a link to the editor (the id when there is no name); `mono` for a name that is an id (a username). */
export function NameCell({ kind, item, value, parent, mono }: { kind: Kind; item: Item; value: unknown; parent?: Parent; mono?: boolean }) {
  const text = isEmptyValue(value) ? item.id : line(value);
  return (
    <Link className={mono ? 'tbl-name mono' : 'tbl-name'} to={pathFor(kind, item.id, parent)} {...clipTitle(text)}>
      {text}
    </Link>
  );
}

export interface SelectBoxProps {
  checked: boolean | 'indeterminate';
  onChange: (next: boolean) => void;
  /** The accessible name, unless a wrapping <label> gives one. */
  label?: string;
  disabled?: boolean;
  onKeyDown?: (e: KeyboardEvent) => void;
  ref?: Ref<HTMLButtonElement>;
}

/** A kit-styled checkbox for selections; `indeterminate` shows a dash (aria-checked="mixed"). */
export function SelectBox({ checked, onChange, label, disabled, onKeyDown, ref }: SelectBoxProps) {
  return (
    <Checkbox.Root
      ref={ref}
      className="ui-checkbox tbl-check"
      checked={checked}
      disabled={disabled}
      onCheckedChange={(state) => onChange(state === true)}
      onKeyDown={onKeyDown}
      aria-label={label}
    >
      <Checkbox.Indicator className="ui-checkbox__indicator">
        {checked === 'indeterminate' ? <Minus aria-hidden="true" size={12} strokeWidth={3.5} /> : <Check aria-hidden="true" size={12} strokeWidth={3.5} />}
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
