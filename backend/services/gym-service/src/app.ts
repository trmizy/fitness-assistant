import express, { NextFunction, Request, Response } from 'express';
import { logger, metricsMiddleware, register } from '@gym-coach/shared';
import publicRoutes from './routes/public.routes';
import ownerRoutes from './routes/owner.routes';
import clientRoutes from './routes/client.routes';
import ptRoutes from './routes/pt.routes';
import adminRoutes from './routes/admin.routes';
import internalRoutes from './routes/internal.routes';

const app = express();

app.use(express.json());
app.use(metricsMiddleware());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'gym-service' });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/', publicRoutes);
app.use('/owner', ownerRoutes);
app.use('/', clientRoutes);
app.use('/', ptRoutes);
app.use('/admin', adminRoutes);
app.use('/internal', internalRoutes);

// Last-resort safety net: catches anything forwarded via next(err) (every
// route handler is now wrapped in asyncHandler, so a rejected promise ends
// up here instead of crashing the process as an unhandled rejection) and
// any synchronous throw Express 4 already catches on its own. Never leaks
// an internal stack trace/error message to the client.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err: err?.message, path: req.path }, 'Unhandled error in gym-service');
  if (res.headersSent) return;
  res.status(err?.status || 500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
});

export default app;
