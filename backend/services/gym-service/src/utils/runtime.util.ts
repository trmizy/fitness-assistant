/**
 * Detects whether the current process is a real AWS Lambda execution environment, as opposed
 * to local dev or a Docker container. Mirrors user-service's own `runtime.util.ts` exactly
 * (see its doc comment for why this isn't based on `NODE_ENV`) — duplicated rather than
 * pulled into `@gym-coach/shared` to avoid touching a package every other service depends on
 * for a two-line utility.
 */
export function isLambdaRuntime(): boolean {
  return !!process.env.AWS_LAMBDA_FUNCTION_NAME;
}
