import {
  InvocationType,
  InvokeCommand,
  LambdaClient,
} from "@aws-sdk/client-lambda";
import axios from "axios";

let lambdaClient: LambdaClient | null = null;

function getLambdaClient(): LambdaClient {
  if (!lambdaClient) {
    lambdaClient = new LambdaClient({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return lambdaClient;
}

function resolveAuthServiceUrl(): string {
  return process.env.AUTH_SERVICE_URL || "http://localhost:3001";
}

async function verifyTokenViaLambda(authHeader: string): Promise<any> {
  const functionName = process.env.AUTH_LAMBDA_NAME;
  if (!functionName) return null;

  const event = {
    version: "2.0",
    routeKey: "POST /auth/verify",
    rawPath: "/auth/verify",
    rawQueryString: "",
    headers: {
      authorization: authHeader,
      "content-type": "application/json",
    },
    requestContext: {
      http: {
        method: "POST",
        path: "/auth/verify",
        sourceIp: "fitness-service",
        userAgent: "fitness-service-lambda-invoke",
      },
      requestId: `fitness-auth-${Date.now()}`,
    },
    body: "{}",
    isBase64Encoded: false,
  };

  const response = await getLambdaClient().send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: InvocationType.RequestResponse,
      Payload: Buffer.from(JSON.stringify(event)),
    }),
  );

  const payload = response.Payload
    ? JSON.parse(Buffer.from(response.Payload).toString("utf-8"))
    : null;
  const statusCode = Number(payload?.statusCode ?? response.StatusCode ?? 500);
  const body =
    typeof payload?.body === "string" ? JSON.parse(payload.body || "{}") : payload?.body;
  if (statusCode < 200 || statusCode >= 300) {
    const err: any = new Error(body?.error || "Auth verification failed");
    err.status = statusCode;
    throw err;
  }
  return body;
}

export const authServiceClient = {
  async verifyToken(authHeader: string): Promise<any> {
    const lambdaResult = await verifyTokenViaLambda(authHeader);
    if (lambdaResult) return lambdaResult;

    const response = await axios.post(
      `${resolveAuthServiceUrl()}/auth/verify`,
      {},
      {
        headers: { Authorization: authHeader },
        timeout: 5000,
      },
    );
    return response.data;
  },
};
