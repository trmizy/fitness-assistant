import { Request, Response, NextFunction } from 'express';
import { logger } from '@gym-coach/shared';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PRIMARY = process.env.INTERNAL_SERVICE_SECRET;
const SECONDARY = process.env.INTERNAL_API_SECRET;
const DEV_DEFAULTS = [
  'dev_internal_service_secret_change_in_production',
  'dev_internal_api_secret_change_in_production',
];

// Dev defaults are only ever accepted OUTSIDE production. Including them
// unconditionally (as this file previously did) means anyone who knows this
// public string — it's right here in source control — could forge internal
// service requests in production regardless of what INTERNAL_SERVICE_SECRET
// is actually set to.
const ACCEPTED = [
  ...new Set(
    [PRIMARY, SECONDARY, ...(IS_PRODUCTION ? [] : DEV_DEFAULTS)].filter(
      (v): v is string => !!v,
    ),
  ),
];

if (IS_PRODUCTION) {
  const isWeak = (v?: string) => !v || DEV_DEFAULTS.includes(v) || v.length < 32;
  if (isWeak(PRIMARY) && isWeak(SECONDARY)) {
    logger.error(
      'INTERNAL_SERVICE_SECRET/INTERNAL_API_SECRET missing, default, or under 32 chars in production — refusing to start.',
    );
    process.exit(1);
  }
}

if (ACCEPTED.length === 0) {
  logger.error(
    'Neither INTERNAL_SERVICE_SECRET nor INTERNAL_API_SECRET is set; /internal/* endpoints will reject all requests',
  );
}

export function serviceSecretMiddleware(req: Request, res: Response, next: NextFunction) {
  if (ACCEPTED.length === 0) {
    return res.status(503).json({ error: 'Internal endpoint disabled: no internal secret configured' });
  }
  const provided = req.headers['x-service-secret'];
  const value = Array.isArray(provided) ? provided[0] : provided;
  if (!value || !ACCEPTED.includes(value)) {
    return res.status(401).json({ error: 'Invalid service secret' });
  }
  return next();
}
