import type { Request, Response } from 'express';
import { logger } from '@gym-coach/shared';
import { principalId } from '../middleware/partner-context.middleware';
import {
  ListingError,
  adminApproveBodySchema,
  adminDirectEditBodySchema,
  adminNoteRequiredBodySchema,
  adminRetireBodySchema,
  confirmBodySchema,
  createDraftBodySchema,
  emptyBodySchema,
  expectedDraftBodySchema,
  parseOrThrow,
  presignBodySchema,
  reorderPhotosBodySchema,
  saveDraftBodySchema,
  submitBodySchema,
} from '../services/gym-listing.schemas';
import { gymListingService } from '../services/gym-listing.service';
import { adminGymListingService } from '../services/gym-listing-apply.service';
import { gymListingUploadService } from '../services/gym-listing-upload.service';

/**
 * HTTP layer of the branch-listing workflow. Success bodies follow gym-service's own convention `{ success: true, data }`;
 * error bodies are `{ success:false, error:{ code, message }, message, ...extra }` - the shape the old mobile builds
 * already read (`message`) plus the machine code the new clients switch on.
 */
export function sendListingError(res: Response, e: unknown): void {
  if (e instanceof ListingError) {
    res.status(e.status).json({ success: false, error: { code: e.code, message: e.message }, message: e.message, ...e.extra });
    return;
  }
  const any = e as { status?: number; code?: string; message?: string };
  if (typeof any?.status === 'number' && any.status >= 400 && any.status < 600 && any.status !== 500) {
    res.status(any.status).json({ success: false, error: { code: any.code ?? 'REQUEST_REJECTED', message: any.message }, message: any.message });
    return;
  }
  logger.error(e as Error, 'Gym listing error');
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Lỗi hệ thống' }, message: 'Lỗi hệ thống' });
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
export const wrap = (fn: Handler) => async (req: Request, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    sendListingError(res, e);
  }
};
export const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });

const gymIdOf = (req: Request) => req.params.id;

export const gymListingController = {
  // ── OWNER (the router has already required the OWNER partner role and the operational gate) ──
  get: wrap(async (req, res) => ok(res, await gymListingService.getListing(gymIdOf(req), principalId(req)))),
  createDraft: wrap(async (req, res) => {
    const body = parseOrThrow(createDraftBodySchema, req.body);
    ok(res, await gymListingService.createDraft(gymIdOf(req), principalId(req), body), 201);
  }),
  saveDraft: wrap(async (req, res) => {
    ok(res, await gymListingService.saveDraft(gymIdOf(req), principalId(req), parseOrThrow(saveDraftBodySchema, req.body)));
  }),
  submit: wrap(async (req, res) => {
    ok(res, await gymListingService.submit(gymIdOf(req), principalId(req), req.user!.userId, parseOrThrow(submitBodySchema, req.body)));
  }),
  withdraw: wrap(async (req, res) => {
    parseOrThrow(emptyBodySchema, req.body);
    ok(res, await gymListingService.withdraw(gymIdOf(req), principalId(req)));
  }),
  discard: wrap(async (req, res) => {
    parseOrThrow(emptyBodySchema, req.body);
    ok(res, await gymListingService.discard(gymIdOf(req), principalId(req)));
  }),
  rebase: wrap(async (req, res) => {
    ok(res, await gymListingService.rebase(gymIdOf(req), principalId(req), parseOrThrow(expectedDraftBodySchema, req.body)));
  }),
  preview: wrap(async (req, res) => ok(res, await gymListingService.preview(gymIdOf(req), principalId(req)))),

  presign: wrap(async (req, res) => {
    const body = parseOrThrow(presignBodySchema, req.body);
    ok(res, await gymListingUploadService.presign(gymIdOf(req), { kind: 'OWNER', userId: req.user!.userId, ownerId: principalId(req) }, body.contentType));
  }),
  confirm: wrap(async (req, res) => {
    const body = parseOrThrow(confirmBodySchema, req.body);
    ok(res, await gymListingUploadService.confirm(gymIdOf(req), { kind: 'OWNER', userId: req.user!.userId, ownerId: principalId(req) }, body.uploadId), 201);
  }),
  reorderPhotos: wrap(async (req, res) => {
    const body = parseOrThrow(reorderPhotosBodySchema, req.body);
    ok(res, await gymListingUploadService.reorderDraftPhotos(gymIdOf(req), principalId(req), body.photoIds));
  }),
  setCover: wrap(async (req, res) => {
    parseOrThrow(emptyBodySchema, req.body);
    ok(res, await gymListingUploadService.setDraftCover(gymIdOf(req), principalId(req), req.params.photoId));
  }),
  deletePhoto: wrap(async (req, res) => {
    ok(res, await gymListingUploadService.deleteStaged(gymIdOf(req), principalId(req), req.params.photoId));
  }),

  // ── ADMIN (the router has already required role ADMIN) ───────────────────────────────────────
  adminList: wrap(async (req, res) => {
    const q = req.query;
    ok(
      res,
      await adminGymListingService.list({
        status: typeof q.status === 'string' ? q.status : undefined,
        brandId: typeof q.brandId === 'string' ? q.brandId : undefined,
        gymId: typeof q.gymId === 'string' ? q.gymId : undefined,
        q: typeof q.q === 'string' ? q.q : undefined,
        page: typeof q.page === 'string' ? Number(q.page) : undefined,
      }),
    );
  }),
  adminGetRevision: wrap(async (req, res) => ok(res, await adminGymListingService.getRevision(req.params.rid))),
  adminPreview: wrap(async (req, res) => ok(res, await adminGymListingService.previewRevision(req.params.rid))),
  adminApprove: wrap(async (req, res) => {
    const body = parseOrThrow(adminApproveBodySchema, req.body);
    ok(res, await adminGymListingService.approve(req.params.rid, req.user!.userId, body));
  }),
  adminReject: wrap(async (req, res) => {
    const body = parseOrThrow(adminNoteRequiredBodySchema, req.body);
    ok(res, await adminGymListingService.reject(req.params.rid, req.user!.userId, body.note));
  }),
  adminRequestChanges: wrap(async (req, res) => {
    const body = parseOrThrow(adminNoteRequiredBodySchema, req.body);
    ok(res, await adminGymListingService.requestChanges(req.params.rid, req.user!.userId, body.note));
  }),
  adminDirectEdit: wrap(async (req, res) => {
    const body = parseOrThrow(adminDirectEditBodySchema, req.body);
    ok(res, await adminGymListingService.directEdit(req.user!.userId, req.params.gymId, body));
  }),
  adminRetirePhoto: wrap(async (req, res) => {
    const body = parseOrThrow(adminRetireBodySchema, req.body);
    ok(res, await adminGymListingService.retirePhoto(req.user!.userId, req.params.gymId, req.params.photoId, body));
  }),
  adminHistory: wrap(async (req, res) => {
    ok(res, await adminGymListingService.history(req.params.gymId, typeof req.query.page === 'string' ? Number(req.query.page) : 1));
  }),
  adminPresign: wrap(async (req, res) => {
    const body = parseOrThrow(presignBodySchema, req.body);
    ok(res, await gymListingUploadService.presign(req.params.gymId, { kind: 'ADMIN', userId: req.user!.userId }, body.contentType));
  }),
  adminConfirm: wrap(async (req, res) => {
    const body = parseOrThrow(confirmBodySchema, req.body);
    ok(res, await gymListingUploadService.confirm(req.params.gymId, { kind: 'ADMIN', userId: req.user!.userId }, body.uploadId), 201);
  }),
};
