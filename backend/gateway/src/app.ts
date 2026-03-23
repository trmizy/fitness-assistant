import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { logger } from '@gym-coach/shared';
import { rateLimiter } from './middleware/rateLimit.middleware';
import proxyRoutes from './routes/proxy.routes';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');
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
