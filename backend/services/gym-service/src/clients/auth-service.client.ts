import axios from "axios";
import { invokeHttpLambda, throwForLambdaHttpError } from "./lambda-http.client";

function resolveAuthServiceUrl(): string {
  return process.env.AUTH_SERVICE_URL || "http://localhost:3001";
}

export const authServiceClient = {
  async verifyToken(authHeader: string): Promise<any> {
    if (process.env.AUTH_LAMBDA_NAME) {
      const result = await invokeHttpLambda({
        functionName: process.env.AUTH_LAMBDA_NAME,
        method: "POST",
        path: "/auth/verify",
        headers: { authorization: authHeader },
        body: {},
      });
      throwForLambdaHttpError(result);
      return result.body;
    }

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

  async getInternalUser(userId: string, serviceSecret: string): Promise<any> {
    const path = `/auth/internal/users/${encodeURIComponent(userId)}`;
    if (process.env.AUTH_LAMBDA_NAME) {
      const result = await invokeHttpLambda({
        functionName: process.env.AUTH_LAMBDA_NAME,
        method: "GET",
        path,
        headers: { "x-service-secret": serviceSecret },
      });
      throwForLambdaHttpError(result);
      return result.body;
    }

    const response = await axios.get(`${resolveAuthServiceUrl()}${path}`, {
      headers: { "x-service-secret": serviceSecret },
      timeout: 3000,
    });
    return response.data;
  },
};
