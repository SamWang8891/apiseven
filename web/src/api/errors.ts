import { t } from '../i18n';

/**
 * Why an Admin API call failed:
 * - auth: 401/403, a missing or wrong key, a viewer key writing, or an address not in allow_admin
 * - network: no response at all (offline, refused, or blocked by CORS), or apiseven's server's
 *   502 saying it could not reach APISIX (`refusal.reason` upstream)
 * - http: any other error status with a JSON body
 * - parse: the response is not the JSON the Admin API sends (e.g. an HTML error page)
 * - refused: never sent, as the id would not stay one path segment (api/segments.ts); status 404
 * - server: apiseven's own server (Docker mode) refused the request itself (`refusal`); not APISIX,
 *   so never a key problem. When that server could not reach APISIX the kind is `network` instead.
 */
export type ApiErrorKind = 'auth' | 'network' | 'http' | 'parse' | 'refused' | 'server';

/** An answer apiseven's server made itself (X-Apiseven-Refusal): its reason word and its sentence. */
export interface Refusal {
  /** host, auth, header, origin, path, method, size, request or upstream (server/handler.go refusalHeader). */
  reason: string;
  message: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** APISIX's own message (`error_msg`, plus `description` when given); show it verbatim. */
  readonly errorMsg?: string;
  /** Set when apiseven's own server made this answer, not APISIX. */
  readonly refusal?: Refusal;

  constructor(kind: ApiErrorKind, message: string, opts: { status?: number; errorMsg?: string; refusal?: Refusal; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts.status;
    this.errorMsg = opts.errorMsg;
    this.refusal = opts.refusal;
  }
}

/** The heading for a refusal by apiseven's server: sign in again (its Basic auth), else that it refused. */
export function refusalTitle(refusal: Refusal): string {
  return refusal.reason === 'auth' ? t('api.server.signIn') : t('api.server.refused');
}
