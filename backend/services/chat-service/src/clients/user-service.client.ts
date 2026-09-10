import axios from "axios";
import { invokeHttpLambda, throwForLambdaHttpError } from "./lambda-http.client";

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || "http://localhost:3004";

export async function getChatEligibility(params: {
  fromUserId: string;
  toUserId: string;
  internalSecret: string;
}): Promise<any> {
  const headers = { "x-service-secret": params.internalSecret };
  const queryStringParameters = {
    fromUserId: params.fromUserId,
    toUserId: params.toUserId,
  };
  const functionName = process.env.USER_LAMBDA_NAME;

  if (functionName) {
    const result = await invokeHttpLambda({
      functionName,
      method: "GET",
      path: "/internal/chat-eligibility",
      headers,
      queryStringParameters,
    });
    throwForLambdaHttpError(result);
    return result.body;
  }

  const { data } = await axios.get(`${USER_SERVICE_URL}/internal/chat-eligibility`, {
    params: queryStringParameters,
    headers,
    timeout: 3000,
  });
  return data;
}

export async function checkRelationship(params: {
  userAId: string;
  userBId: string;
  authToken: string;
}): Promise<any> {
  const headers = { Authorization: `Bearer ${params.authToken}` };
  const queryStringParameters = {
    userAId: params.userAId,
    userBId: params.userBId,
  };
  const functionName = process.env.USER_LAMBDA_NAME;

  if (functionName) {
    const result = await invokeHttpLambda({
      functionName,
      method: "GET",
      path: "/contracts/check-relationship",
      headers,
      queryStringParameters,
    });
    throwForLambdaHttpError(result);
    return result.body;
  }

  const { data } = await axios.get(`${USER_SERVICE_URL}/contracts/check-relationship`, {
    params: queryStringParameters,
    headers,
    timeout: 3000,
  });
  return data;
}

export async function getSession(coachingSessionId: string, authToken: string): Promise<any> {
  const headers = { Authorization: `Bearer ${authToken}` };
  const functionName = process.env.USER_LAMBDA_NAME;

  if (functionName) {
    const result = await invokeHttpLambda({
      functionName,
      method: "GET",
      path: `/sessions/${encodeURIComponent(coachingSessionId)}`,
      headers,
    });
    throwForLambdaHttpError(result);
    return result.body;
  }

  const { data } = await axios.get(
    `${USER_SERVICE_URL}/sessions/${encodeURIComponent(coachingSessionId)}`,
    { headers, timeout: 3000 },
  );
  return data;
}
