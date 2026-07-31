import { Request, Response, NextFunction } from "express";
import { logger } from "@gym-coach/shared";

// Different services historically use different env-var names for the same shared
// secret (auth/user use INTERNAL_SERVICE_SECRET, chat uses INTERNAL_API_SECRET).
// Accept either env value, and also the well-known dev defaults so existing dev
// containers (with split naming) interoperate without a docker-compose change.
// Production deployments should set both env vars to the SAME long random value.
//
// Dev defaults are gated to non-production only — this file previously
// accepted them unconditionally, which meant anyone who knew this public
// string (it's right here in source control) could forge internal service
// requests in production regardless of what INTERNAL_SERVICE_SECRET was
// actually set to.
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PRIMARY = process.env.INTERNAL_SERVICE_SECRET;
const SECONDARY = process.env.INTERNAL_API_SECRET;
const DEV_DEFAULTS = [
  "dev_internal_service_secret_change_in_production",
  "dev_internal_api_secret_change_in_production",
];
const ACCEPTED = [
  ...new Set(
    [PRIMARY, SECONDARY, ...(IS_PRODUCTION ? [] : DEV_DEFAULTS)].filter(
      (v): v is string => !!v,
    ),
  ),
];

if (IS_PRODUCTION) {
  const isWeak = (v?: string) =>
    !v || DEV_DEFAULTS.includes(v) || v.length < 32;
  if (isWeak(PRIMARY) && isWeak(SECONDARY)) {
    logger.error(
      "INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET missing, default, or under 32 chars in production — refusing to start.",
    );
    process.exit(1);
  }
}

if (ACCEPTED.length === 0) {
  logger.error(
    "Neither INTERNAL_SERVICE_SECRET nor INTERNAL_API_SECRET is set; /internal/* endpoints will reject all requests",
  );
}

/**
 * Protect /internal/* endpoints — only callable by other services that share at
 * least one of the recognised internal secrets. Fail-closed if both are missing.
 */
export function serviceSecretMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (ACCEPTED.length === 0) {
    return res.status(503).json({
      error: "Internal endpoint disabled: no internal secret configured",
    });
  }
  const provided = req.headers["x-service-secret"];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value || !ACCEPTED.includes(value)) {
    return res.status(401).json({ error: "Invalid service secret" });
  }
  return next();
}
