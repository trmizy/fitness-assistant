/**
 * Invokes another service's HTTP Lambda directly (AWS SDK Invoke) by handing
 * it a synthetic API Gateway HTTP API **payload format 2.0** event — the same
 * shape API Gateway itself would deliver, so the target service's Express app
 * routes it identically whether the call arrived from the internet or from a
 * sibling Lambda.
 *
 * Mirrors payment-service's clients/lambda-http.client.ts 1:1 (same event
 * shape, same error contract) — this is deliberately a sibling copy rather
 * than a shared package: backend/shared has no AWS SDK dependency today, and
 * adding one there would pull the SDK into every service's bundle, including
 * the ones that never invoke a Lambda.
 *
 * Error contract: `throwForLambdaHttpError` throws an axios-shaped error
 * (`err.status`, `err.response.status`, `err.response.data`) so existing
 * catch blocks written against axios keep working unchanged when a call site
 * switches from HTTP to Lambda invoke.
 */
import {
  InvocationType,
  InvokeCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";

let lambdaClient: LambdaClient | null = null;

function getLambdaClient(): LambdaClient {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return lambdaClient;
}

export async function invokeHttpLambda(params: {
  functionName: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
  body?: unknown;
}): Promise<{ statusCode: number; body: any }> {
  const query = new URLSearchParams(params.queryStringParameters ?? {}).toString();
  const event = {
    version: "2.0",
    routeKey: `${params.method.toUpperCase()} ${params.path}`,
    rawPath: params.path,
    rawQueryString: query,
    headers: {
      "content-type": "application/json",
      ...(params.headers ?? {}),
    },
    queryStringParameters: params.queryStringParameters,
    requestContext: {
      http: {
        method: params.method.toUpperCase(),
        path: params.path,
        sourceIp: "ai-service",
        userAgent: "ai-service-lambda-invoke",
      },
      requestId: `ai-${Date.now()}`,
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    isBase64Encoded: false,
  };

  const response = await getLambdaClient().send(
    new InvokeCommand({
      FunctionName: params.functionName,
      InvocationType: InvocationType.RequestResponse,
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  );
  const payload = response.Payload
    ? JSON.parse(Buffer.from(response.Payload).toString("utf-8"))
    : {};
  const statusCode = Number(payload.statusCode ?? response.StatusCode ?? 500);
  const body =
    typeof payload.body === "string" && payload.body
      ? JSON.parse(payload.body)
      : payload.body;
  return { statusCode, body };
}

export function throwForLambdaHttpError(result: {
  statusCode: number;
  body: any;
}): void {
  if (result.statusCode >= 200 && result.statusCode < 300) return;
  const err: any = new Error(
    result.body?.error?.message ||
      result.body?.error ||
      `Lambda HTTP call failed with ${result.statusCode}`,
  );
  err.status = result.statusCode;
  err.response = { status: result.statusCode, data: result.body };
  throw err;
}
