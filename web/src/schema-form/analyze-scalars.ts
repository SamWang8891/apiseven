// Strings, numbers and enums, with what property names tell about them: secret, multi-line, monospace.
import type { Obj } from '../api/types';
import { json, num, strings, text, type Ctx } from './analyze-ctx';
import type { Node, NumberNode, StringNode } from './node';

// --- Heuristics on property names ------------------------------------------------------------

const SECRET_KEY = /secret|password|private_key|token/i;
/** Names that contain a secret word but name something else: token_endpoint, client_rsa_private_key_id, … */
const NOT_SECRET_KEY = /(^|_)(url|uri|endpoint|method|expected|id|header|name|field|path|in|alg|type)$/i;
/** Whether a property's name says it holds a secret (client_secret, redis_password, service_token, but not token_endpoint). */
export function isSecretName(key: string): boolean {
  return SECRET_KEY.test(key) && !NOT_SECRET_KEY.test(key);
}

const MULTILINE_KEY = /(^|_)(body|template|pem|cert|certificate|private_key|public_key|lua|script|functions?|prompt|content)(_|$)/i;
const MULTILINE_DESCRIPTION = /\b(PEM|Lua (code|function)|template)\b/i;
/** Names of values that are one line however long they may be (URIs, hosts, names, patterns). */
const ONE_LINE_KEY = /(^|_)(uri|uris|url|urls|host|hosts|endpoint|path|paths|addr|address|addresses|domain|discovery|origin|origins|dn|server|servers|ip|ips|cidr|regex|pattern|name|names|rules)(_|$)/i;
const MONO_KEY = /(^|_)(uri|uris|url|urls|host|hosts|endpoint|addr|address|addresses|domain|discovery|origins?|ip|ips|cidr|id|ids|path|paths|regex|pattern)(_|$)/i;
const MONO_FORMATS = new Set(['ipv4', 'ipv6', 'uri', 'hostname', 'uri-reference', 'email']);

export function enumNode(values: unknown[], s: Obj, ctx: Ctx): Node {
  if (values.every((v): v is string => typeof v === 'string')) return stringNode({ ...s, type: 'string' }, ctx, [...new Set(values)]);
  if (values.every((v) => v === null || typeof v !== 'object')) return { kind: 'enum', values };
  return json(s, ctx);
}

export function stringNode(s: Obj, ctx: Ctx, enumValues?: string[]): StringNode {
  const { key, description } = ctx;
  const format = typeof s.format === 'string' ? s.format : undefined;
  const maxLength = num(s.maxLength);
  const encrypted = ctx.encrypt.has(ctx.path.join('.'));
  const secret = !enumValues && (encrypted || isSecretName(key));
  const oneLine = ONE_LINE_KEY.test(key) || (format !== undefined && MONO_FORMATS.has(format));
  const multiline =
    !enumValues &&
    !oneLine &&
    (MULTILINE_KEY.test(key) || MULTILINE_DESCRIPTION.test(description) || (maxLength !== undefined && maxLength > 256 && !secret));
  const node: StringNode = {
    kind: 'string',
    multiline,
    secret,
    mono: !enumValues && (MONO_KEY.test(key) || (format !== undefined && MONO_FORMATS.has(format)) || (multiline && /pem|cert|key|lua|function|script/i.test(key))),
  };
  if (enumValues) node.enum = enumValues;
  if (typeof s.pattern === 'string') node.pattern = s.pattern;
  if (num(s.minLength) !== undefined) node.minLength = num(s.minLength);
  if (maxLength !== undefined) node.maxLength = maxLength;
  return node;
}

export function numberNode(s: Obj, integer: boolean, orText: boolean): NumberNode {
  const node: NumberNode = { kind: 'number', integer };
  const min = num(s.minimum);
  const max = num(s.maximum);
  // draft-07: exclusiveMinimum is the bound; draft-04: a boolean beside minimum.
  if (num(s.exclusiveMinimum) !== undefined) {
    node.min = num(s.exclusiveMinimum);
    node.exclusiveMin = true;
  } else if (min !== undefined) {
    node.min = min;
    if (s.exclusiveMinimum === true) node.exclusiveMin = true;
  }
  if (num(s.exclusiveMaximum) !== undefined) {
    node.max = num(s.exclusiveMaximum);
    node.exclusiveMax = true;
  } else if (max !== undefined) {
    node.max = max;
    if (s.exclusiveMaximum === true) node.exclusiveMax = true;
  }
  if (orText) node.orText = true;
  return node;
}

export function mergedStrings(s: Obj, options: Obj[], ctx: Ctx): StringNode {
  const enums = options.map((o) => (Array.isArray(o.enum) ? strings(o.enum) : undefined));
  const all = enums.every((e): e is string[] => e !== undefined) ? [...new Set(enums.flat())] : undefined;
  const node = stringNode({ ...s, type: 'string' }, ctx, all);
  const accepts = options.map((o) => text(o.title) ?? text(o.format)).filter((x): x is string => x !== undefined);
  if (accepts.length > 0) node.accepts = [...new Set(accepts)];
  return node;
}
