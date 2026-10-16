/**
 * The machine-readable `code` an error carries (e.g. PT_TEMPORARILY_UNAVAILABLE from
 * pt-restriction.service.ts), ready to spread into a JSON error body. Only errors that also carry an
 * HTTP `status` qualify — that is what separates a deliberate, coded refusal from a stray library
 * error whose `code` is something like a Postgres or Node error code.
 */
export function errorCodeBody(error: any): { code?: string } {
  return error && error.status && typeof error.code === "string" ? { code: error.code } : {};
}
