import { Router, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from '@gym-coach/shared';
import { authMiddleware } from '../middleware/auth.middleware';

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:3004';
const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL || 'http://localhost:3002';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:3003';

function serviceUnavailable(serviceName: string) {
  return (err: Error, _req: Request, res: Response) => {
    logger.error({ error: `${serviceName} proxy error`, message: err.message });
    (res as Response).status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: `${serviceName} is unavailable`,
      },
    });
  };
}

const router = Router();

// Public — Auth Service
router.use(
  '/auth',
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/auth': '/auth' },
    onError: serviceUnavailable('Auth service'),
  }),
);

// Protected — User Service
router.use(
  '/profile',
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/profile': '/profile' },
    onError: serviceUnavailable('User service'),
  }),
);

// Protected — Fitness Service (workouts)
router.use(
  '/workouts',
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (nutrition)
router.use(
  '/nutrition',
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — Fitness Service (stats)
router.use(
  '/stats',
  authMiddleware,
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Public — Exercises (no auth needed to browse)
router.use(
  '/exercises',
  createProxyMiddleware({
    target: FITNESS_SERVICE_URL,
    changeOrigin: true,
  }),
);

// Protected — AI Service
router.use(
  '/ai',
  authMiddleware,
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('AI service'),
  }),
);

export default router;
