/**
 * Detects whether the current process is a real AWS Lambda execution environment (cold or warm
 * invocation), as opposed to local dev or a Docker container.
 *
 * Deliberately NOT based on `NODE_ENV === "production"` — a Docker deployment can legitimately
 * run with `NODE_ENV=production` while still having a genuinely writable, persisted filesystem
 * (bind mount / volume), so that check would misclassify it and disable disk-backed features it
 * doesn't need to lose. `AWS_LAMBDA_FUNCTION_NAME` is set automatically by the Lambda service
 * itself on every invocation (never something a developer sets in docker-compose or a local
 * .env), so it's a reliable, environment-specific signal rather than a deployment-mode guess.
 */
export function isLambdaRuntime(): boolean {
  return !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}
