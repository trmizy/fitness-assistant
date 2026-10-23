import { requestContextMiddleware } from './middleware/request-context.middleware';
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
import mediaRoutes from './routes/media.routes';
import { gymMediaController } from './controllers/gym-media.controller';
import { asyncHandler } from './middleware/asyncHandler';
import { legacyCompatRefusalGuard } from './services/legacy-compat.service';

const app = express();

// Listing Management B3: a refused old-client request on a compat route leaves a REJECTED_OTHER event BEFORE the response goes out.
// Mounted ahead of the body parser so a malformed JSON body (400) is seen too.
app.use(legacyCompatRefusalGuard);
app.use(express.json());
// Địa chỉ công khai người gọi đang dùng — cho link tệp ký theo đúng cửa họ đi vào (partner-s3.service.ts).
app.use(requestContextMiddleware);
app.use(metricsMiddleware());

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". complaint-photos and branch-documents are
// legal/evidence material and stay behind their own authenticated `serve` routes. Branch photos are
// public - but only the PUBLISHED ones of publicly visible branches (Listing Management B1).
// There is deliberately NO express.static here any more: a static mount serves every file in the
// directory, so a withdrawn (RETIRED) or never-approved (STAGED) photo stayed reachable by URL.
if (!isLambdaRuntime()) {
  const dir = path.join(process.cwd(), 'uploads/gym-photos');
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    logger.warn({ dir, err: (err as Error).message }, 'Could not create upload directory');
  }
}
// Old URLs (`/uploads/gym-photos/<fileName>`, built by apps from the bare file name) keep working — checked per request.
app.get('/uploads/gym-photos/:file', asyncHandler(gymMediaController.serveLegacyFile));
// Stable public photo URL: /media/gym-photos/:photoId (redirect to a short presigned link, or stream a disk photo).
app.use('/media', mediaRoutes);

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
