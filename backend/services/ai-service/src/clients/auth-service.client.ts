/**
 * Verifies a caller's JWT against auth-service, so ai-service can establish
 * identity itself instead of trusting `x-user-id` / `x-user-role` headers
 * injected by the Express gateway.
 *
 * Same contract as payment-service's clients/auth-service.client.ts:
 * `POST /auth/verify` with the Bearer header, response `{ user: {...} }`
 * (auth.controller.ts's `verify`). Uses AUTH_LAMBDA_NAME when set (direct
 * Lambda Invoke), AUTH_SERVICE_URL otherwise.
 */
import { requestService } from "./service-lambda.client";

export interface VerifiedUser {
  id: string;
  role?: string;
  email?: string;
}

// Test seam, same pattern as `bedrockRuntimeDeps.send` (services/bedrock.client.ts) and
// `sqsDeps`/`bullmqStatsDeps` (workers/queue-provider.ts): lets a test simulate a fast, definite
// auth-service answer (e.g. a real 401 rejection) instead of a real network call — without this,
// a test sending a malformed token has no reachable auth-service in most test environments and
// falls through to a 5s connection timeout, which is a transient-failure shape (no `.response`),
// not the definite-rejection shape auth.middleware.ts's `isDefiniteTokenRejection` correctly
// requires for a 401. Production is unaffected: AUTH_LAMBDA_NAME direct-invoke answers in
// milliseconds either way.
export const authServiceClientDeps = {
  verify: (token: string) =>
    requestService<{ user?: VerifiedUser }>({
      service: "auth",
      method: "POST",
      path: "/auth/verify",
      body: {},
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 5000,
    }),
};

export async function verifyToken(token: string): Promise<VerifiedUser | null> {
  const { data } = await authServiceClientDeps.verify(token);
  return data?.user?.id ? data.user : null;
}
