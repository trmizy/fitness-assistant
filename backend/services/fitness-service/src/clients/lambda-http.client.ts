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
        sourceIp: "fitness-service",
        userAgent: "fitness-service-lambda-invoke",
      },
      requestId: `fitness-${Date.now()}`,
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

export function throwForLambdaHttpError(result: { statusCode: number; body: any }): void {
  if (result.statusCode >= 200 && result.statusCode < 300) return;
  const err: any = new Error(result.body?.error || `Lambda HTTP call failed with ${result.statusCode}`);
  err.status = result.statusCode;
  err.response = { status: result.statusCode, data: result.body };
  throw err;
}
