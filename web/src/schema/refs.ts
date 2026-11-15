// Walking JSON Schema: local $ref resolution, combinator expansion and pattern tests. Shared by the
// JSON editor's schema support (ui/codemirror/jsonSchema.ts) and the schema-form generator. Nothing
// here throws on a malformed schema: what cannot be followed is left out.
import type { Obj } from '../api/types';

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The target of a local `#/…` JSON pointer in `root`; undefined for remote refs, missing targets and bad escapes. */
export function resolveRef(root: Obj, ref: string): Obj | undefined {
  if (!ref.startsWith('#')) return undefined;
  let cur: unknown = root;
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return undefined; // a stray % in the pointer
    }
    seg = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    cur = isObj(cur) ? cur[seg] : Array.isArray(cur) ? cur[Number(seg)] : undefined;
  }
  return isObj(cur) ? cur : undefined;
}

/** `schema` with any chain of $refs followed; undefined when it is not an object, dangles or loops. */
export function deref(root: Obj, schema: unknown): Obj | undefined {
  const seen = new Set<Obj>();
  let cur: unknown = schema;
  while (isObj(cur) && typeof cur.$ref === 'string') {
    if (seen.has(cur)) return undefined;
    seen.add(cur);
    cur = resolveRef(root, cur.$ref);
  }
  return isObj(cur) ? cur : undefined;
}

const MAX_DEPTH = 10;

/** The schema plus everything it pulls in through $ref and allOf/anyOf/oneOf/then/else, each schema once. */
export function expand(root: Obj, schema: unknown): Obj[] {
  const out: Obj[] = [];
  const seen = new Set<Obj>();
  const visit = (s: unknown, depth: number) => {
    if (!isObj(s) || depth > MAX_DEPTH || seen.has(s)) return;
    seen.add(s);
    if (typeof s.$ref === 'string') {
      visit(resolveRef(root, s.$ref), depth + 1);
      return;
    }
    out.push(s);
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      const list = s[key];
      if (Array.isArray(list)) for (const sub of list) visit(sub, depth + 1);
    }
    visit(s.then, depth + 1);
    visit(s.else, depth + 1);
  };
  visit(schema, 0);
  return out;
}

/**
 * Whether Ajv can compile `pattern`: it builds `new RegExp(pattern, 'u')` (its default
 * unicodeRegExp). One it cannot (PCRE's `\A…\z`) is left to APISIX everywhere: the validator skips
 * it (prepare.ts), and testPattern counts it as matching.
 */
export function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}

const patterns = new Map<string, RegExp | null>();

/**
 * Whether `text` matches a JSON Schema `pattern`, read as Ajv reads it. A pattern Ajv cannot compile
 * counts as matching: read any other way (without the unicode flag, `\A` is a literal A) it would
 * refuse what APISIX accepts, and an entry refused here is held, which blocks Save and Save anyway.
 */
export function testPattern(pattern: string, text: string): boolean {
  let re = patterns.get(pattern);
  if (re === undefined) {
    re = compiles(pattern) ? new RegExp(pattern, 'u') : null;
    patterns.set(pattern, re);
  }
  return re === null || re.test(text);
}
