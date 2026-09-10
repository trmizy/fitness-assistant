import axios from "axios";
import { invokeHttpLambda, throwForLambdaHttpError } from "./lambda-http.client";

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || "http://localhost:3001";

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
    `${AUTH_SERVICE_URL}/auth/verify`,
    {},
    { headers, timeout: 5000 },
  );
  return data;
}
