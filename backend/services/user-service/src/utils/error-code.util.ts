/**
 * The machine-readable `code` an error carries (e.g. PT_TEMPORARILY_UNAVAILABLE from
 * pt-restriction.service.ts), ready to spread into a JSON error body. Only errors that also carry an
 * HTTP `status` qualify — that is what separates a deliberate, coded refusal from a stray library
 * error whose `code` is something like a Postgres or Node error code.
 */
export function errorCodeBody(error: any): { code?: string } {
  return error && error.status && typeof error.code === "string" ? { code: error.code } : {};
}

/**
 * The structured `details` a deliberate, coded refusal carries (e.g. SESSION_NOT_COVERED_BY_MEMBERSHIP -> { gymId, date,
 * membershipEndsAt }), ready to spread into a JSON error body next to `error`/`code`. Same qualification as errorCodeBody: the
 * error must carry an HTTP `status` and a plain-object `details`.
 */
export function errorDetailsBody(error: any): { details?: Record<string, unknown> } {
  return error && error.status && error.details && typeof error.details === "object" && !Array.isArray(error.details)
    ? { details: error.details }
    : {};
}
