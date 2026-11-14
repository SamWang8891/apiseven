/**
 * Why an Admin API call failed:
 * - auth: 401/403, a missing or wrong key, a viewer key writing, or an address not in allow_admin
 * - network: no response at all (offline, refused, or blocked by CORS)
 * - http: any other error status with a JSON body
 * - parse: the response is not the JSON the Admin API sends (e.g. an HTML error page)
 */
export type ApiErrorKind = 'auth' | 'network' | 'http' | 'parse';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** APISIX's own message (`error_msg`, plus `description` when given); show it verbatim. */
  readonly errorMsg?: string;

  constructor(kind: ApiErrorKind, message: string, opts: { status?: number; errorMsg?: string; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts.status;
    this.errorMsg = opts.errorMsg;
  }
}
