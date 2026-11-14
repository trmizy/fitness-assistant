import axios from "axios";
import { invokeHttpLambda, throwForLambdaHttpError } from "./lambda-http.client";

// Read per call (not at module load): modules that import this client indirectly (withdrawal.service -> withdrawal-notification.service) can load before a caller/test sets the env.
const authServiceUrl = () => process.env.AUTH_SERVICE_URL || "http://localhost:3001";

export async function verifyToken(token: string): Promise<any> {
  const headers = { Authorization: `Bearer ${token}` };
  const functionName = process.env.AUTH_LAMBDA_NAME;

  if (functionName) {
    const result = await invokeHttpLambda({
      functionName,
      method: "POST",
      path: "/auth/verify",
      headers,
      body: {},
    });
    throwForLambdaHttpError(result);
    return result.body;
  }

  const { data } = await axios.post(
    `${authServiceUrl()}/auth/verify`,
    {},
    { headers, timeout: 5000 },
  );
  return data;
}

/**
 * E6 / F3: the account behind a user id, read from auth-service's INTERNAL route (service secret). 404 = no such account (thrown with response.status 404); any other failure is thrown as is - the
 * caller treats "cannot tell" as a refusal.
 */
export async function getUserInternal(userId: string): Promise<{ id: string; role?: string; isActive?: boolean } | null> {
  const headers = { "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production" };
  const path = `/auth/internal/users/${encodeURIComponent(userId)}`;
  const functionName = process.env.AUTH_LAMBDA_NAME;
  if (functionName) {
    const result = await invokeHttpLambda({ functionName, method: "GET", path, headers, body: undefined as any });
    if (result.statusCode === 404) return null;
    throwForLambdaHttpError(result);
    return result.body?.user ?? null;
  }
  try {
    const { data } = await axios.get(`${authServiceUrl()}${path}`, { headers, timeout: 3000 });
    return data?.user ?? null;
  } catch (e: any) {
    if (e?.response?.status === 404) return null;
    throw e;
  }
}

/**
 * Q9: the ACTIVE admin accounts (ids), from auth-service's INTERNAL route (service secret) - the only service that knows roles. Thrown on any failure; the
 * caller (withdrawal notification) is best-effort and logs it.
 */
export async function listActiveAdminIdsInternal(): Promise<string[]> {
  const headers = { "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "dev_internal_service_secret_change_in_production" };
  const path = "/auth/internal/admins";
  const functionName = process.env.AUTH_LAMBDA_NAME;
  let body: any;
  if (functionName) {
    const result = await invokeHttpLambda({ functionName, method: "GET", path, headers, body: undefined as any });
    throwForLambdaHttpError(result);
    body = result.body;
  } else {
    body = (await axios.get(`${authServiceUrl()}${path}`, { headers, timeout: 3000 })).data;
  }
  return Array.isArray(body?.admins) ? body.admins.map((a: { id?: unknown }) => a?.id).filter((x: unknown): x is string => typeof x === "string" && x.length > 0) : [];
}
