import axios from "axios";
import { invokeHttpLambda, throwForLambdaHttpError } from "./lambda-http.client";

type ServiceKey = "gym" | "user" | "ai";

const serviceConfig: Record<ServiceKey, { lambdaEnv: string; urlEnv: string; defaultUrl: string }> = {
  gym: {
    lambdaEnv: "GYM_LAMBDA_NAME",
    urlEnv: "GYM_SERVICE_URL",
    defaultUrl: "http://localhost:3006",
  },
  user: {
    lambdaEnv: "USER_LAMBDA_NAME",
    urlEnv: "USER_SERVICE_URL",
    defaultUrl: "http://localhost:3004",
  },
  ai: {
    lambdaEnv: "AI_LAMBDA_NAME",
    urlEnv: "AI_SERVICE_URL",
    defaultUrl: "http://localhost:3003",
  },
};

export async function postServiceJson(params: {
  service: ServiceKey;
  path: string;
  body: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<any> {
  const config = serviceConfig[params.service];
  const functionName = process.env[config.lambdaEnv];

  if (functionName) {
    const result = await invokeHttpLambda({
      functionName,
      method: "POST",
      path: params.path,
      headers: params.headers,
      body: params.body,
    });
    throwForLambdaHttpError(result);
    return result.body;
  }

  const baseUrl = process.env[config.urlEnv] || config.defaultUrl;
  const { data } = await axios.post(`${baseUrl}${params.path}`, params.body, {
    headers: params.headers,
    timeout: params.timeoutMs ?? 10_000,
  });
  return data;
}
