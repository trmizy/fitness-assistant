import { Router, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { logger } from '@gym-coach/shared';
import { authMiddleware, requireRoles } from '../middleware/auth.middleware';

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL || 'http://localhost:3004';
const FITNESS_SERVICE_URL =
  process.env.FITNESS_SERVICE_URL || 'http://localhost:3002';
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:3003';
const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL || 'http://localhost:3005';

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

// Protected — Auth role management (admin only)
router.use(
  '/auth/users/:userId/role',
  authMiddleware,
  requireRoles('ADMIN'),
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Auth service'),
  }),
);

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

// Protected — PT registration (only customer/admin can trigger)
router.use(
  '/profile/me/become-pt',
  authMiddleware,
  requireRoles('CUSTOMER', 'ADMIN'),
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/profile': '/profile' },
    onError: serviceUnavailable('User service'),
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
    onProxyReq: (proxyReq, req) => {
      const userId = req.headers['x-user-id'];
      const userEmail = req.headers['x-user-email'];
      const userRole = req.headers['x-user-role'];

      if (typeof userId === 'string') proxyReq.setHeader('x-user-id', userId);
      if (typeof userEmail === 'string')
        proxyReq.setHeader('x-user-email', userEmail);
      if (typeof userRole === 'string')
        proxyReq.setHeader('x-user-role', userRole);
    },
    onError: serviceUnavailable('AI service'),
  }),
);

// Protected — Chat Service (REST only; Socket.IO connects directly to :3005)
router.use(
  '/chat',
  authMiddleware,
  createProxyMiddleware({
    target: CHAT_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('Chat service'),
  }),
);

// Protected — InBody (User Service)
router.use(
  '/inbody',
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/inbody': '/inbody' },
    onError: serviceUnavailable('User service'),
  }),
);

// Protected — PT Applications (User Service)
router.use(
  '/pt-applications',
  authMiddleware,
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { '^/pt-applications': '/pt-applications' },
    onError: serviceUnavailable('User service'),
  }),
);

// Public — Uploads (User Service)
router.use(
  '/uploads',
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    onError: serviceUnavailable('User service (Uploads)'),
  }),
);

export default router;
