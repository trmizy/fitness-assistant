const INTERNAL_SERVICE_SECRET_DEFAULT =
  "dev_internal_service_secret_change_in_production";

export function validateInternalSecret(
  rawSecret: string | undefined,
  nodeEnv: string | undefined,
): void {
  if (nodeEnv !== "production") return;
  if (
    !rawSecret ||
    rawSecret === INTERNAL_SERVICE_SECRET_DEFAULT ||
    rawSecret.length < 32
  ) {
    throw new Error(
      "[Gateway] INTERNAL_SERVICE_SECRET must be set in production, must not be the default value, and must be at least 32 characters long.",
    );
  }
}

export { INTERNAL_SERVICE_SECRET_DEFAULT };
