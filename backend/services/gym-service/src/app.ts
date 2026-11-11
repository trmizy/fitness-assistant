import { requestContextMiddleware } from './middleware/request-context.middleware';
import path from 'path';
import fs from 'fs';
import express, { NextFunction, Request, Response } from 'express';
import { logger, metricsMiddleware, register } from '@gym-coach/shared';
import { isLambdaRuntime } from './utils/runtime.util';
import publicRoutes from './routes/public.routes';
import ownerRoutes from './routes/owner.routes';
import ownerComplaintCaseRoutes from './routes/owner-complaint-case.routes';
import clientRoutes from './routes/client.routes';
import ptRoutes from './routes/pt.routes';
import adminRoutes from './routes/admin.routes';
import internalRoutes from './routes/internal.routes';
import mediaRoutes from './routes/media.routes';
import { gymMediaController } from './controllers/gym-media.controller';
import { asyncHandler } from './middleware/asyncHandler';
import { legacyCompatRefusalGuard } from './services/legacy-compat.service';
import { localizeErrors } from './middleware/localize-errors.middleware';
import { installViZodErrorMap } from './config/zod-vi';

// N09C-02: zod's default English messages ("Required", ...) become Vietnamese for every schema that gives none of its own.
installViZodErrorMap();

const app = express();

// Listing Management B3: a refused old-client request on a compat route leaves a REJECTED_OTHER event BEFORE the response goes out.
// Mounted ahead of the body parser so a malformed JSON body (400) is seen too.
app.use(legacyCompatRefusalGuard);
app.use(express.json());
// Catch malformed JSON early with 400 INVALID_JSON so body-parser messages/snippets never reach logger.error.
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
    res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'Dữ liệu JSON không hợp lệ' },
    });
    return;
  }
  next(err);
});
// N09C-02 / N-A-01: Vietnamese error messages (codes kept) and no Prisma text / file paths in any 5xx - see utils/error-messages.vi.ts.
app.use(localizeErrors);
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
app.use('/owner/complaint-cases', ownerComplaintCaseRoutes);
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
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  res.status(status).json({ success: false, error: { code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message: status === 500 ? 'Hệ thống đang gặp lỗi. Vui lòng thử lại sau.' : 'Yêu cầu không hợp lệ.' } });
});

export default app;
