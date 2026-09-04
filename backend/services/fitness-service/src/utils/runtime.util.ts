export function isLambdaRuntime(): boolean {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}
