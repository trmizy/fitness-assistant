import rateLimit from 'express-rate-limit';

const N8N_RATE_LIMIT_BYPASS_PREFIXES = [
  '/admin/workflows/studio',
  '/rest',
  '/assets',
  '/static',
  '/signin',
];

export const rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => N8N_RATE_LIMIT_BYPASS_PREFIXES.some((prefix) => req.path.startsWith(prefix)),
});
