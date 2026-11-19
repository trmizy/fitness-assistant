/**
 * Where user-service reaches chat-service. Locally the compose service name is the default. On AWS Lambda a missing
 * CHAT_SERVICE_URL means chat-service is not wired in for this environment (it runs on ECS, and the compose name does
 * not resolve from a Lambda): the call would only burn its timeout and keep the Lambda busy, so callers skip it (null).
 */
export function resolveChatServiceUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = (env.CHAT_SERVICE_URL ?? "").trim();
  if (configured) return configured;
  if (env.AWS_LAMBDA_FUNCTION_NAME) return null;
  return "http://chat-service:3005";
}
