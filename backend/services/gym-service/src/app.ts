import path from 'path';
import fs from 'fs';
import express, { NextFunction, Request, Response } from 'express';
import { logger, metricsMiddleware, register } from '@gym-coach/shared';
import { isLambdaRuntime } from './utils/runtime.util';
import publicRoutes from './routes/public.routes';
import ownerRoutes from './routes/owner.routes';
import clientRoutes from './routes/client.routes';
import ptRoutes from './routes/pt.routes';
import adminRoutes from './routes/admin.routes';
import internalRoutes from './routes/internal.routes';

const app = express();

app.use(express.json());
app.use(metricsMiddleware());

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Only gym-photos gets a static mount:
// same public/private split as user-service's own uploads (see that service's app.ts doc
// comment) — complaint-photos and branch-documents are legal/evidence material and stay
// behind their own authenticated `serve` routes with no static mount at all.
if (!isLambdaRuntime()) {
  const dir = path.join(process.cwd(), 'uploads/gym-photos');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.warn({ dir, err: (err as Error).message }, 'Could not create upload directory');
  }
}
app.use('/uploads/gym-photos', express.static(path.join(process.cwd(), 'uploads/gym-photos')));

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
