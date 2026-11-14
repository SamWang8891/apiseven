import { en } from './en';
import { format, type Vars } from './format';

/** Looks up a UI string by key and fills its {placeholders}. A missing key returns the key itself. */
export function t(key: string, vars?: Vars): string {
  return format(en[key] ?? key, vars);
}
