// What APISIX 3.20 refuses in an SSL, checked in the browser so Save can say where: the `ssl` schema
// in apisix/schema_def.lua (901–994, with certificate_scheme 407–410 and private_key_schema
// 412–415) and check_ssl_conf in apisix/ssl.lua (184–236), which admin/ssl.lua runs (22–29).
// Nothing stricter (addendum rule 10): APISIX parses the certificates and keys with OpenSSL, which
// this file doesn't try to repeat (our certificate reader is not OpenSSL), and it does not check that
// a key belongs to its certificate (ssl.lua 131). Advice beyond that is given where a value is typed
// (the SNI box, the certificate dialog). Pure; the registry uses it as the SSL's `validate`.
import { isLuaArray, isLuaObject } from '../../api/lua';
import { isObj } from '../../api/sanitize';
import type { Obj } from '../../api/types';
import type { Issue } from '../../editor/issues';
import { t } from '../../i18n';
import type { ValidateEnv } from '../registry';
import { hostProblem, labelsRefused } from '../routes/validate';

/**
 * A `$secret://` or `$env://` reference (case-insensitive for env): APISIX's validator skips any
 * string field holding one (secret.lua 268–280, core/schema.lua 43–45), and check_ssl_conf doesn't
 * parse a pair with one (ssl.lua 192–199).
 */
export function isSecretRef(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('$secret://') || value.toUpperCase().startsWith('$ENV://'));
}

/** A string of `min`–65536 characters (certificate_scheme 128, private_key_schema 64), or a reference. */
const pemOk = (value: unknown, min: number): boolean => isSecretRef(value) || (typeof value === 'string' && value.length >= min && value.length <= 64 * 1024);

const CERT_MIN = 128;
const KEY_MIN = 64;

/** The values of ssl_protocols (schema_def.lua 969–977). */
export const SSL_PROTOCOLS = ['TLSv1.1', 'TLSv1.2', 'TLSv1.3'] as const;

const unique = (list: unknown[]): boolean => new Set(list.map((v) => JSON.stringify(v))).size === list.length;

type Add = (path: string, message: string) => void;

/** `sni` / `snis` and their pattern (host_def_pat, 57; 922–933); for a server, exactly one of them (the `then` oneOf, 986–991). */
function checkSnis(draft: Obj, server: boolean, add: Add): void {
  const hasSni = draft.sni !== undefined;
  const hasSnis = draft.snis !== undefined;
  if (server && hasSni && hasSnis) add('snis', t('ssl.issue.both'));
  else if (server && !hasSni && !hasSnis) add('snis', t('ssl.issue.sniRequired'));
  if (hasSni && !isSecretRef(draft.sni)) {
    const problem = typeof draft.sni === 'string' ? hostProblem(draft.sni) : t('ssl.issue.notText');
    if (problem) add('sni', problem);
  }
  if (!hasSnis) return;
  if (!isLuaArray(draft.snis)) return add('snis', t('ssl.issue.list'));
  const snis = Array.isArray(draft.snis) ? draft.snis : [];
  // minItems 1 (932): an empty list is no SNI at all.
  if (snis.length === 0 && !(server && hasSni)) return add('snis', t(server ? 'ssl.issue.sniRequired' : 'ssl.issue.snisEmpty'));
  snis.forEach((sni, i) => {
    if (isSecretRef(sni)) return;
    const problem = typeof sni === 'string' ? hostProblem(sni) : t('ssl.issue.notText');
    if (problem) add(`snis.${i}`, problem);
  });
}

/**
 * The extra pairs: each cert and key a PEM string (934–941), and for a server certificate as many
 * keys as certs in what APISIX will check (ssl.lua 205–208). For a stored object, that is the draft
 * merged into the stored object (every save of one is a PATCH, editor/save.ts): the stored keys, which
 * a GET never shows, stay unless `keys` is sent, and there are as many of them as the stored certs
 * (the same check ran when they were saved). Checked live: a PATCH of `certs` alone that
 * changes their number answers "mismatched number of certs and keys".
 */
function checkPairs(draft: Obj, env: ValidateEnv, server: boolean, add: Add): void {
  const certs = draft.certs;
  const keys = draft.keys;
  if (certs !== undefined && !isLuaArray(certs)) add('certs', t('ssl.issue.list'));
  if (keys !== undefined && !isLuaArray(keys)) add('keys', t('ssl.issue.list'));
  if (Array.isArray(certs)) certs.forEach((cert, i) => !pemOk(cert, CERT_MIN) && add(`certs.${i}`, t('ssl.issue.certsItem', { n: i + 1 })));
  if (Array.isArray(keys)) {
    keys.forEach((key, i) => {
      if (key === null || key === undefined) add(`keys.${i}`, t('ssl.issue.keyMissing', { n: i + 1 }));
      else if (!pemOk(key, KEY_MIN)) add(`keys.${i}`, t('ssl.issue.keysItem', { n: i + 1 }));
    });
  }
  // A client certificate is not counted: check_ssl_conf returns before (ssl.lua 201–203).
  if (!server) return;
  // A create sends the draft as it is; a stored SSL is saved as a PATCH (editor/save.ts), merged into
  // the stored keys unless `keys` is sent, also with a new main key (admin/resource.lua 471–483).
  const stored = env.original?.value.certs;
  const certCount = Array.isArray(certs) ? certs.length : 0;
  const keyCount = Array.isArray(keys) ? keys.length : isLuaArray(keys) ? 0 : env.isNew ? 0 : Array.isArray(stored) ? stored.length : 0;
  if (certCount === keyCount) return;
  if (Array.isArray(keys)) add('keys', t('ssl.issue.countKeys', { certs: certCount, keys: keyCount }));
  else add('keys', t(env.isNew ? 'ssl.issue.needKeys' : 'ssl.issue.reenterKeys'));
}

/** `client` (942–962): an object with a CA; depth a whole number ≥ 0; the skip list non-empty and unique. An empty table is an object to APISIX. */
function checkClient(client: unknown, add: Add): void {
  if (client === undefined) return;
  if (!isLuaObject(client)) return add('client', t('ssl.issue.notObject'));
  const c = isObj(client) ? client : {};
  if (c.ca === undefined) add('client.ca', t('ssl.issue.caRequired'));
  else if (!pemOk(c.ca, CERT_MIN)) add('client.ca', t('ssl.issue.caLength'));
  if (c.depth !== undefined && !(typeof c.depth === 'number' && Number.isInteger(c.depth) && c.depth >= 0)) add('client.depth', t('ssl.issue.depth'));
  const skip = c.skip_mtls_uri_regex;
  if (skip === undefined) return;
  if (!isLuaArray(skip) || (Array.isArray(skip) && skip.some((s) => typeof s !== 'string'))) add('client.skip_mtls_uri_regex', t('ssl.issue.list'));
  else if (!Array.isArray(skip) || skip.length === 0) add('client.skip_mtls_uri_regex', t('ssl.issue.skipEmpty'));
  else if (!unique(skip)) add('client.skip_mtls_uri_regex', t('ssl.issue.skipRepeat'));
}

/** Problems in an SSL draft, each at its path, for the editor to show on the right tab. */
export function sslIssues(draft: Obj, env: ValidateEnv): Issue[] {
  const issues: Issue[] = [];
  const add: Add = (path, message) => {
    issues.push({ path, message });
  };
  // A missing type is `server`, the schema's default (912–919), and the `if` (979–985) holds then too.
  const server = draft.type === undefined || draft.type === 'server';

  // cert and key: required for both types (`then` 986–991, `else` 992); a stored object's key stays
  // in APISIX, and the PATCH that saves it without a new one keeps it (admin/resource.lua 471–483).
  if (draft.cert === undefined) add('cert', t('ssl.issue.certRequired'));
  else if (!pemOk(draft.cert, CERT_MIN)) add('cert', t('ssl.issue.certLength'));
  if (draft.key === undefined) {
    if (env.isNew) add('key', t('ssl.issue.keyRequired'));
  } else if (!pemOk(draft.key, KEY_MIN)) add('key', t('ssl.issue.keyLength'));

  checkSnis(draft, server, add);
  checkPairs(draft, env, server, add);
  checkClient(draft.client, add);

  if (draft.type !== undefined && draft.type !== 'server' && draft.type !== 'client') add('type', t('ssl.issue.type'));
  if (draft.status !== undefined && draft.status !== 0 && draft.status !== 1) add('status', t('ssl.issue.status'));
  if (draft.desc !== undefined && !isSecretRef(draft.desc) && !(typeof draft.desc === 'string' && draft.desc.length <= 256)) add('desc', t('ssl.issue.desc'));
  if (labelsRefused(draft.labels)) add('labels', t('rt.issue.labels'));
  const protocols = draft.ssl_protocols;
  if (
    protocols !== undefined &&
    !(isLuaArray(protocols) && (!Array.isArray(protocols) || (protocols.length <= 3 && unique(protocols) && protocols.every((p) => (SSL_PROTOCOLS as readonly unknown[]).includes(p)))))
  ) {
    add('ssl_protocols', t('ssl.issue.protocols'));
  }
  return issues;
}
