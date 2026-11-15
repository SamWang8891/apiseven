// The secret managers APISIX 3.20 has (apisix/secret/*.lua, one module per manager, loaded by name in
// admin/secrets.lua 30–33) and the schema each checks a secret's settings against (admin/secrets.lua
// 35–38: core.schema.check(secret_manager.schema, conf)), transcribed as they are: field names,
// types, required lists, defaults, patterns. The Lua schemas carry no descriptions. Nothing else is
// checked: an id is not (resource.lua 87–89 makes it "<manager>/<id>"), and other keys are kept.
import type { Obj } from '../../api/types';

export const MANAGERS = ['vault', 'aws', 'gcp'] as const;
export type Manager = (typeof MANAGERS)[number];

/** core.schema.uri_def (apisix/schema_def.lua 84). */
const URI_DEF: Obj = { type: 'string', pattern: '^[^\\/]+:\\/\\/([\\da-zA-Z.-]+|\\[[\\da-fA-F:]+\\])(:\\d+)?' };

export const SCHEMAS: Record<Manager, Obj> = {
  // apisix/secret/vault.lua 30–45
  vault: {
    type: 'object',
    properties: {
      uri: URI_DEF,
      prefix: { type: 'string' },
      token: { type: 'string' },
      namespace: { type: 'string' },
    },
    required: ['uri', 'prefix', 'token'],
  },
  // apisix/secret/aws.lua 33–52
  aws: {
    type: 'object',
    properties: {
      access_key_id: { type: 'string' },
      secret_access_key: { type: 'string' },
      session_token: { type: 'string' },
      region: { type: 'string', default: 'us-east-1' },
      endpoint_url: URI_DEF,
    },
    required: ['access_key_id', 'secret_access_key'],
  },
  // apisix/secret/gcp.lua 29–68
  gcp: {
    type: 'object',
    properties: {
      auth_config: {
        type: 'object',
        properties: {
          client_email: { type: 'string' },
          private_key: { type: 'string' },
          project_id: { type: 'string' },
          token_uri: { type: 'string', default: 'https://oauth2.googleapis.com/token' },
          scope: { type: 'array', items: { type: 'string' }, default: ['https://www.googleapis.com/auth/cloud-platform'] },
          entries_uri: { type: 'string', default: 'https://secretmanager.googleapis.com/v1' },
        },
        required: ['client_email', 'private_key', 'project_id'],
      },
      ssl_verify: { type: 'boolean', default: true },
      auth_file: { type: 'string' },
    },
    oneOf: [{ required: ['auth_config'] }, { required: ['auth_file'] }],
  },
};

/**
 * The credentials each manager signs in with: masked in every view (the form, the locked JSON, View
 * JSON, the conflict diff, the list and its search) until revealed. APISIX stores them as sent and a
 * GET returns them in clear (checked on the dev APISIX 3.20), so an untouched save sends them back
 * unchanged. Dotted paths, as SchemaForm's encryptFields.
 */
export const SECRET_FIELDS: Record<Manager, string[]> = {
  vault: ['token'],
  aws: ['access_key_id', 'secret_access_key', 'session_token'],
  gcp: ['auth_config.private_key'],
};

export const isManager = (v: unknown): v is Manager => typeof v === 'string' && (MANAGERS as readonly string[]).includes(v);

/** A secret's id split at its first slash: "vault/my-id" → vault, my-id; the manager part may be anything. */
export function splitSecretId(id: string | undefined): { manager: string; name: string } {
  if (id === undefined) return { manager: '', name: '' };
  const slash = id.indexOf('/');
  return slash < 0 ? { manager: '', name: id } : { manager: id.slice(0, slash), name: id.slice(slash + 1) };
}

/** The manager a secret's id names, when it is one APISIX has. */
export function managerOf(id: string | undefined): Manager | undefined {
  const { manager } = splitSecretId(id);
  return isManager(manager) ? manager : undefined;
}
