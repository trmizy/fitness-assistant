import type { NextFunction, Request, Response } from "express";
import { logger } from "@gym-coach/shared";
import { prisma } from "../repositories/profile.repository";
import {
  ListingError,
  adminDecisionBodySchema,
  adminDirectEditBodySchema,
  adminNoteRequiredBodySchema,
  adminRetireBodySchema,
  confirmBodySchema,
  createDraftBodySchema,
  emptyBodySchema,
  expectedDraftBodySchema,
  parseOrThrow,
  presignBodySchema,
  saveDraftBodySchema,
  submitBodySchema,
} from "../services/pt-listing.schemas";
import { requireApprovedPt } from "../services/pt-listing.helpers";
import { ptListingService } from "../services/pt-listing.service";
import { adminPtListingService, buildPreview } from "../services/pt-listing-apply.service";
import { ptPhysiqueUploadService } from "../services/pt-physique-upload.service";
import { ptMediaStorage } from "../services/pt-media-s3.service";
import { isPtPubliclyVisible } from "../services/pt-public-dto";

interface AuthRequest extends Request {
  user?: { id: string; role: string };
}

/** Owner / admin / preview responses are per-user and may carry drafts or presigned URLs: never cached anywhere. */
export function noStorePrivate(_req: Request, res: Response, next: NextFunction): void {
  res.set("Cache-Control", "no-store, private");
  res.set("Vary", "Authorization");
  next();
}

/** Public JSON (trainer list / detail / packages): always revalidate; the ETag only saves bandwidth. */
export function publicNoCache(_req: Request, res: Response, next: NextFunction): void {
  res.set("Cache-Control", "no-cache");
  next();
}

/**
 * Error body shared with the legacy 409 answers old apps already know how to read:
 *   { success:false, error:{ code, message }, message, ...extra }
 */
function sendError(res: Response, e: unknown): void {
  if (e instanceof ListingError) {
    res.status(e.status).json({ success: false, error: { code: e.code, message: e.message }, message: e.message, ...e.extra });
    return;
  }
  const any = e as { status?: number; code?: string; message?: string };
  if (typeof any?.status === "number" && any.status >= 400 && any.status < 500) {
    res.status(any.status).json({ success: false, error: { code: any.code ?? "REQUEST_REJECTED", message: any.message }, message: any.message });
    return;
  }
  if (typeof any?.status === "number" && any.status === 503) {
    res.status(503).json({ success: false, error: { code: any.code ?? "UNAVAILABLE", message: any.message }, message: any.message });
    return;
  }
  logger.error(e as Error, "PT listing error");
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Lỗi hệ thống" }, message: "Lỗi hệ thống" });
}

type Handler = (req: AuthRequest, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => async (req: AuthRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (e) {
    sendError(res, e);
  }
};
/** The caller is the token's user, and must be an approved trainer. No body or path field names a PT. */
const ownerOnly = (fn: (userId: string, req: AuthRequest, res: Response) => Promise<unknown>) =>
  wrap(async (req, res) => {
    const userId = req.user!.id;
    await requireApprovedPt(prisma, userId);
    await fn(userId, req, res);
  });

export const ptListingController = {
  // ── PT ───────────────────────────────────────────────────────────────────────────────────────
  get: ownerOnly(async (userId, _req, res) => res.json(await ptListingService.getListing(userId))),

  createDraft: ownerOnly(async (userId, req, res) => {
    const body = parseOrThrow(createDraftBodySchema, req.body);
    res.status(201).json(await ptListingService.createDraft(userId, body));
  }),
  saveDraft: ownerOnly(async (userId, req, res) => {
    res.json(await ptListingService.saveDraft(userId, parseOrThrow(saveDraftBodySchema, req.body)));
  }),
  submit: ownerOnly(async (userId, req, res) => {
    res.json(await ptListingService.submit(userId, parseOrThrow(submitBodySchema, req.body)));
  }),
  withdraw: ownerOnly(async (userId, req, res) => {
    parseOrThrow(emptyBodySchema, req.body);
    res.json(await ptListingService.withdraw(userId));
  }),
  discard: ownerOnly(async (userId, req, res) => {
    parseOrThrow(emptyBodySchema, req.body);
    res.json(await ptListingService.discard(userId));
  }),
  rebase: ownerOnly(async (userId, req, res) => {
    res.json(await ptListingService.rebase(userId, parseOrThrow(expectedDraftBodySchema, req.body)));
  }),
  preview: ownerOnly(async (userId, _req, res) => {
    const open = await prisma.ptListingRevision.findFirst({ where: { ptUserId: userId, status: { in: ["DRAFT", "PENDING"] } } });
    if (!open) throw new ListingError(404, "NO_OPEN_REVISION", "Bạn chưa có bản nháp nào để xem trước.");
    res.json(await buildPreview(open, "OWNER"));
  }),

  presign: ownerOnly(async (userId, req, res) => {
    const body = parseOrThrow(presignBodySchema, req.body);
    res.json(await ptPhysiqueUploadService.presign(userId, body.contentType));
  }),
  confirm: ownerOnly(async (userId, req, res) => {
    const body = parseOrThrow(confirmBodySchema, req.body);
    res.status(201).json(await ptPhysiqueUploadService.confirm(userId, body.uploadId));
  }),
  deletePhoto: ownerOnly(async (userId, req, res) => {
    res.json(await ptPhysiqueUploadService.deleteStaged(userId, req.params.photoId));
  }),

  // ── ADMIN (the router has already required role ADMIN) ───────────────────────────────────────
  adminList: wrap(async (req, res) => {
    res.json(
      await adminPtListingService.list({
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        q: typeof req.query.q === "string" ? req.query.q : undefined,
        page: typeof req.query.page === "string" ? Number(req.query.page) : undefined,
      }),
    );
  }),
  adminGetRevision: wrap(async (req, res) => res.json(await adminPtListingService.getRevision(req.params.rid))),
  adminPreview: wrap(async (req, res) => res.json(await adminPtListingService.previewRevision(req.params.rid))),
  adminApprove: wrap(async (req, res) => {
    const body = parseOrThrow(adminDecisionBodySchema, req.body);
    res.json(await adminPtListingService.approve(req.params.rid, req.user!.id, body.note));
  }),
  adminReject: wrap(async (req, res) => {
    const body = parseOrThrow(adminNoteRequiredBodySchema, req.body);
    res.json(await adminPtListingService.reject(req.params.rid, req.user!.id, body.note));
  }),
  adminRequestChanges: wrap(async (req, res) => {
    const body = parseOrThrow(adminNoteRequiredBodySchema, req.body);
    res.json(await adminPtListingService.requestChanges(req.params.rid, req.user!.id, body.note));
  }),
  adminDirectEdit: wrap(async (req, res) => {
    const body = parseOrThrow(adminDirectEditBodySchema, req.body);
    res.json(await adminPtListingService.directEdit(req.user!.id, req.params.ptUserId, body));
  }),
  adminRetirePhoto: wrap(async (req, res) => {
    const body = parseOrThrow(adminRetireBodySchema, req.body);
    res.json(await adminPtListingService.retirePhoto(req.user!.id, req.params.ptUserId, req.params.photoId, body));
  }),
  adminHistory: wrap(async (req, res) => {
    res.json(await adminPtListingService.history(req.params.ptUserId, typeof req.query.page === "string" ? Number(req.query.page) : 1));
  }),

  // ── PUBLIC media ─────────────────────────────────────────────────────────────────────────────
  /**
   * GET /media/pt-physique/:photoId - no auth. 404 unless the photo is PUBLISHED and its trainer is publicly visible
   * (same rule as the list / detail). Otherwise a 302 to a 10-minute presigned GET; the browser may keep the
   * redirect for 5 minutes. A STAGED, RETIRED or DISCARDED photo is never signed.
   */
  async media(req: Request, res: Response): Promise<void> {
    try {
      const photo = await prisma.ptPhysiquePhoto.findUnique({ where: { id: req.params.photoId } });
      if (!photo || photo.status !== "PUBLISHED" || !(await isPtPubliclyVisible(photo.ptUserId))) {
        res.set("Cache-Control", "no-store");
        res.status(404).json({ error: "Not found" });
        return;
      }
      const url = await ptMediaStorage().presignGet({ key: photo.storageKey, contentType: "image/webp", expiresSec: 600 });
      res.set("Cache-Control", "private, max-age=300");
      res.redirect(302, url);
    } catch (e) {
      sendError(res, e);
    }
  },
};
