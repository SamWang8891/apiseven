// The chrome around fields: the label (the key in monospace, as APISIX users know it from the docs,
// then the schema's title), the required mark, and error and help lines for groups and lists.
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { Tooltip, useLocked } from '../../ui';

/** Descriptions longer than this are clamped to two lines, with the full text in a tooltip. */
const LONG_HELP = 140;

export function FieldLabel({ name, title }: { name: string; title?: string }) {
  return (
    <span className="sf-label">
      <span className="sf-key mono">{name}</span>
      {title !== undefined && (
        <>
          {/* Keeps the words apart in the accessible name. */}{' '}
          <span className="sf-title">{title}</span>
        </>
      )}
    </span>
  );
}

/** A description as help: clamped to two lines, the whole of a long one in a tooltip (and to screen readers). */
export function HelpText({ text }: { text: string }) {
  const clamped = <span className="sf-desc">{text}</span>;
  return text.length > LONG_HELP ? <Tooltip content={<span className="sf-tip">{text}</span>}>{clamped}</Tooltip> : clamped;
}

/** The required mark, as the kit's Field draws it: hidden while locked (it is an editing instruction). */
export function RequiredMark() {
  const locked = useLocked();
  if (locked) return null;
  return (
    <>
      {' '}
      <span className="sf-required">
        <span aria-hidden="true">*</span>
        <span className="sf-sr-only">({t('ui.required')})</span>
      </span>
    </>
  );
}

/** An error line for chrome that is not a kit Field (groups, lists, the form as a whole). */
export function ErrorLine({ message, id }: { message: string; id?: string }) {
  return (
    <p className="sf-error" id={id}>
      <CircleAlert aria-hidden="true" size={14} strokeWidth={2.25} />
      <span>{message}</span>
    </p>
  );
}

/** The help of chrome that is not a kit Field (groups, lists). */
export function GroupHelp({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p className="sf-help" id={id}>
      {children}
    </p>
  );
}
