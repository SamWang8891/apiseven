// Small helpers the upstream sections share (kept apart from the components in fields.tsx).
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { getPath, setPath, type Path } from '../editor/draft';
import { issueAt, type Issue } from '../editor/issues';
import { t } from '../i18n';
import type { Ctx } from '../resources/ctx';
import type { Subsystem } from '../resources/resolve';
import { parseCert } from '../resources/ssls/parseCert';

/** What every section gets: the whole upstream, the way to replace it, its issues (paths relative to the upstream). */
export interface SectionProps {
  value: Obj;
  onChange: (v: Obj) => void;
  issues: Issue[];
  ctx: Ctx;
  /**
   * The subsystem the upstream serves: http (default) or stream (a stream route's). In stream, the
   * sections offer only what applies to L4; a setting that doesn't but is stored shows with a note.
   */
  subsystem?: Subsystem;
  /**
   * The upstream as the editor last loaded it from APISIX (undefined for a new one): what "the stored
   * key" of the TLS client key field is, never what the field saw when it mounted.
   */
  stored?: Obj;
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const obj = (v: unknown): Obj => (isObj(v) ? v : {});

/** Reads and writes fields of the upstream (setPath: an emptied field leaves nothing behind). */
export function bind({ value, onChange, issues }: SectionProps) {
  return {
    get: (path: Path): unknown => getPath(value, path),
    set: (path: Path, v: unknown) => onChange(setPath(value, path, v)),
    issue: (path: string): string | undefined => issueAt(issues, path),
  };
}

/** "Default (x)": the label of the choice that leaves a key unset. */
export const byDefault = (value: string): string => t('up.default', { value });

/** `CN=…, expires 2027-01-22` for a PEM certificate that parses; undefined otherwise. */
export function certLine(pem: string | undefined): string | undefined {
  const info = pem ? parseCert(pem) : undefined;
  if (!info) return undefined;
  return t('up.tls.parsed', { subject: info.subject || info.sans.join(', '), date: new Date(info.notAfter).toISOString().slice(0, 10) });
}
