/**
 * One call path for every outbound service-to-service request ai-service
 * makes, with two transports behind the same signature:
 *
 *   1. `<SERVICE>_LAMBDA_NAME` set  → direct AWS Lambda Invoke, carrying a
 *      synthetic API Gateway v2 event (see lambda-http.client.ts). This is
 *      the AWS path: no NAT, no public route, no API Gateway hop, and the
 *      caller is authorised by IAM instead of only by a shared secret.
 *   2. otherwise                    → plain HTTP to `<SERVICE>_SERVICE_URL`,
 *      byte-for-byte the behaviour every call site had before this file
 *      existed. This is what local dev and docker-compose keep using.
 *
 * Mirrors payment-service's clients/service-lambda.client.ts, extended with
 * GET + query-string support because ai-service reads far more than it
 * writes (profile, InBody, exercise catalog, workout/nutrition history).
 *
 * Returns an axios-shaped `{ status, data }` on purpose: every existing call
 * site already destructures `res.data...`, so switching a call site to this
 * helper changes only the line that makes the request, never the lines that
 * read the response — and the axios-shaped error thrown by
 * `throwForLambdaHttpError` keeps existing `err.response?.data?.error?.code`
 * catch blocks working unchanged.
 *
 * Gym is deliberately absent: ai-service does not call gym-service anywhere.
 */
import axios from "axios";
import { invokeHttpLambda, throwForLambdaHttpError } from "./lambda-http.client";

export type ServiceKey = "auth" | "user" | "fitness" | "payment";

const serviceConfig: Record<
  ServiceKey,
  { lambdaEnv: string; urlEnv: string; defaultUrl: () => string }
> = {
  auth: {
    lambdaEnv: "AUTH_LAMBDA_NAME",
    urlEnv: "AUTH_SERVICE_URL",
    // Defaults below reproduce each call site's own pre-existing default
    // exactly, so nothing changes for local/docker runs.
    defaultUrl: () => "http://auth-service:3001",
  },
  user: {
    lambdaEnv: "USER_LAMBDA_NAME",
    urlEnv: "USER_SERVICE_URL",
    defaultUrl: () =>
      process.env.NODE_ENV === "production"
        ? "http://user-service:3004"
        : "http://localhost:3004",
  },
  fitness: {
    lambdaEnv: "FITNESS_LAMBDA_NAME",
    urlEnv: "FITNESS_SERVICE_URL",
    defaultUrl: () =>
      process.env.NODE_ENV === "production"
        ? "http://fitness-service:3002"
        : "http://localhost:3002",
  },
  payment: {
    lambdaEnv: "PAYMENT_LAMBDA_NAME",
    urlEnv: "PAYMENT_SERVICE_URL",
    defaultUrl: () => "http://localhost:3007",
  },
};

export interface ServiceResponse<T = any> {
  status: number;
  data: T;
}

function toQueryStringParameters(
  params?: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!params) return undefined;
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null,
  );
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries.map(([key, value]) => [key, String(value)]));
}

export async function requestService<T = any>(params: {
  service: ServiceKey;
  method: "GET" | "POST";
  path: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<ServiceResponse<T>> {
  const config = serviceConfig[params.service];
  const functionName = process.env[config.lambdaEnv];
  const query = toQueryStringParameters(params.params);

  if (functionName) {
    const result = await invokeHttpLambda({
      functionName,
      method: params.method,
      path: params.path,
      headers: params.headers,
      queryStringParameters: query,
      body: params.method === "POST" ? (params.body ?? {}) : undefined,
    });
    throwForLambdaHttpError(result);
    return { status: result.statusCode, data: result.body as T };
  }

  const baseUrl = process.env[config.urlEnv] || config.defaultUrl();
  const url = `${baseUrl}${params.path}`;
  const timeout = params.timeoutMs ?? 10_000;

  const response =
    params.method === "GET"
      ? await axios.get<T>(url, { headers: params.headers, params: params.params, timeout })
      : await axios.post<T>(url, params.body, { headers: params.headers, timeout });

  return { status: response.status, data: response.data };
}
