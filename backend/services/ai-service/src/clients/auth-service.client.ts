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

export async function verifyToken(token: string): Promise<VerifiedUser | null> {
  const { data } = await requestService<{ user?: VerifiedUser }>({
    service: "auth",
    method: "POST",
    path: "/auth/verify",
    body: {},
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 5000,
  });
  return data?.user?.id ? data.user : null;
}
