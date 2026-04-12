import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { logger, register, metricsMiddleware } from '@gym-coach/shared';
import chatRoutes from './routes/chat.routes';

const app: Express = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
  }),
);
app.use(express.json());
app.use(metricsMiddleware());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({ method: req.method, path: req.path, ip: req.ip });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'chat-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/chat', chatRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ error: err.message, stack: err.stack });
  res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
});

export default app;
