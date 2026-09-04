/**
 * Security review 2026-09-03 (H1) — every gateway-facing service used to re-verify the
 * caller's JWT with its own `axios.post(auth-service/auth/verify)` call on EVERY request,
 * even though the gateway's own `authMiddleware` had already done exactly that and stamped
 * the verified identity onto `x-user-id`/`x-user-email`/`x-user-role` (stripping any
 * client-supplied copies of those headers first — see gateway/src/app.ts). That made
 * auth-service a second network hop per request AND a single point of failure for every
 * downstream service, not just the gateway.
 *
 * This is the fast path: skip the round-trip when the request is already provably gateway-
 * verified — `x-gateway-secret` matching this service's own INTERNAL_SERVICE_SECRET (or the
 * legacy INTERNAL_API_SECRET name some services use for the same value — see
 * serviceSecret.middleware.ts's own comment on the naming split) is proof of that, since the
 * gateway is the only thing that ever sets it and a client cannot forge a value it never sees
 * on the wire back to itself. Call sites keep their existing auth-service HTTP-verify call as
 * a fallback for anything NOT carrying a valid secret (local dev hitting a service's own
 * published port directly, tests, or a misconfigured deployment) — this only ever adds a
 * shortcut, it never removes the ability to authenticate the slow way.
 *
 * Deliberately NOT applied to gym-service/payment-service's own auth.middleware.ts — those
 * two carry an explicit prior comment documenting a REAL fixed vulnerability (unconditional
 * x-user-id header trust, no secret check at all) and reasoning it through again is a decision
 * for a human, not something to silently redo even with a secret check added this time.
 */
export interface GatewayVerifiedUser {
  id: string;
  email: string;
  role: string;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Returns the gateway-verified identity if `headers['x-gateway-secret']` matches this
 * service's own configured secret, or null if untrusted (missing/mismatched secret, or no
 * x-user-id present even though the secret matched — should not happen in practice, since the
 * gateway always sets both together, but null is the fail-closed answer either way).
 */
export function readGatewayVerifiedUser(
  headers: Record<string, string | string[] | undefined>,
): GatewayVerifiedUser | null {
  const provided = firstHeaderValue(headers["x-gateway-secret"]);
  if (!provided) return null;

  const accepted = [process.env.INTERNAL_SERVICE_SECRET, process.env.INTERNAL_API_SECRET].filter(
    (v): v is string => !!v,
  );
  if (accepted.length === 0 || !accepted.includes(provided)) return null;

  const id = firstHeaderValue(headers["x-user-id"]);
  if (!id) return null;

  return {
    id,
    email: firstHeaderValue(headers["x-user-email"]) || "",
    role: firstHeaderValue(headers["x-user-role"]) || "CUSTOMER",
  };
}
