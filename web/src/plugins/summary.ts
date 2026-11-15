// The one-line summary on a collapsed plugin card: what the config sets, at a glance.
import { isObj } from '../api/sanitize';
import type { Obj } from '../api/types';
import { t } from '../i18n';
import { isSecretName, MASK } from '../schema/secrets';
import { META } from './meta';

const MAX = 80;
const MAX_VALUE = 24;
const SHOWN = 3;

const elide = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function scalar(value: unknown): string {
  if (typeof value === 'string') return /\s/.test(value) ? `"${elide(value, MAX_VALUE - 2)}"` : elide(value, MAX_VALUE);
  return elide(String(value), MAX_VALUE);
}

/**
 * Up to three `key=value` pairs, scalars first (in the config's order), then lists as `key=[n]` and
 * objects as `key={…}`, then `, +N more`. Strings are quoted only when they hold spaces; long values
 * end in `…`. Secrets (the schema's `encrypt` paths, keys named like secrets) show masked. `_meta` is
 * left out; a config with nothing else reads "defaults". Never longer than 80 characters.
 */
export function pluginSummary(_name: string, conf: Obj, encrypt: string[] = []): string {
  const entries = Object.entries(conf).filter(([key]) => key !== META);
  if (entries.length === 0) return t('pl.summary.defaults');
  const isScalar = (v: unknown) => !Array.isArray(v) && !isObj(v);
  const ordered = [...entries.filter(([, v]) => isScalar(v)), ...entries.filter(([, v]) => !isScalar(v))];
  const pairs = ordered.map(([key, value]) => {
    if (encrypt.includes(key) || isSecretName(key)) return `${key}=${MASK}`;
    if (Array.isArray(value)) return `${key}=[${value.length}]`;
    if (isObj(value)) return `${key}={…}`;
    return `${key}=${scalar(value)}`;
  });

  const more = (n: number) => (n > 0 ? `, ${t('pl.summary.more', { count: n })}` : '');
  let shown = Math.min(SHOWN, pairs.length);
  let text = pairs.slice(0, shown).join(', ') + more(pairs.length - shown);
  while (text.length > MAX && shown > 1) {
    shown--;
    text = pairs.slice(0, shown).join(', ') + more(pairs.length - shown);
  }
  if (text.length <= MAX) return text;
  // One pair still too long: shorten it, keeping the count of the rest.
  const tail = more(pairs.length - 1);
  return elide(pairs[0] ?? '', MAX - tail.length) + tail;
}
