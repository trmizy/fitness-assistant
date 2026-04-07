import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { logger } from '@gym-coach/shared';
import { rateLimiter } from './middleware/rateLimit.middleware';
import proxyRoutes from './routes/proxy.routes';

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      const envOrigins = (process.env.CORS_ORIGIN || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const allowedOrigins = Array.from(
        new Set([
          'http://localhost:3000', // gateway itself — needed for n8n studio asset requests
          'http://localhost:5173',
          'http://localhost:5678',
          ...envOrigins,
        ]),
      );
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }),
);
app.use(rateLimiter);

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'api-gateway',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ── n8n Studio CSP bypass ────────────────────────────────────────────────────
// Helmet adds a strict 'script-src self' CSP to ALL responses which blocks n8n's
// inline scripts. We strip it here (before the proxy runs) for the studio route.
// noSniff is also disabled so browsers accept JS/CSS with their correct MIME types.
app.use('/admin/workflows/studio', (_req: Request, res: Response, next: NextFunction) => {
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Content-Type-Options');
  next();
});

app.use('/', proxyRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

// Global error handler
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack, path: req.path });
  res.status(err.statusCode || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : err.message,
    },
  });
});

export default app;
