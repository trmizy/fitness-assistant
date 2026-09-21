import { Request, Response } from 'express';
import { partnerApplicationService } from '../services/partner-application.service';
import { partnerUploadService } from '../services/partner-upload.service';
import { PartnerDocumentType } from '../generated/prisma';

export function failApplication(res: Response, e: any) {
  res.status(e.status || 500).json({
    success: false,
    error: { code: e.code, message: e.message || 'Đã có lỗi xảy ra', issues: e.issues },
  });
}

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });

/** Bọc mọi handler: lỗi nghiệp vụ (có `status`) → JSON chuẩn; lỗi lạ → 500 đã che thông tin. */
function handler(fn: (req: Request, res: Response) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      if (!e?.status) {
        // eslint-disable-next-line no-console
        console.error('[application] lỗi không mong đợi', e?.message);
      }
      failApplication(res, e?.status ? e : Object.assign(new Error('Đã có lỗi xảy ra'), { status: 500 }));
    }
  };
}

const ctxOf = (req: Request) => req.partner!;
const userIdOf = (req: Request) => req.user!.userId;

/** Loại giấy tờ trên URL — sai thì 400 rõ ràng thay vì để Prisma ném lỗi enum thành 500. */
function docTypeParam(req: Request): PartnerDocumentType {
  const v = req.params.docType;
  if (!(Object.values(PartnerDocumentType) as string[]).includes(v)) {
    throw Object.assign(new Error('Loại giấy tờ không hợp lệ'), { status: 400, code: 'INVALID_DOC_TYPE' });
  }
  return v as PartnerDocumentType;
}

/** Hồ sơ đối tác tự đăng ký — phía ứng viên (`/owner/application/*`). */
export const applicationController = {
  status: handler((req, res) => ok(res, partnerApplicationService.getStatus(ctxOf(req)))),

  bootstrap: handler(async (req, res) => {
    const result = await partnerApplicationService.bootstrap(userIdOf(req), req.user!.email);
    ok(res, result, result.created ? 201 : 200);
  }),

  get: handler(async (req, res) => ok(res, await partnerApplicationService.getApplication(ctxOf(req)))),

  timeline: handler(async (req, res) => ok(res, await partnerApplicationService.getTimeline(ctxOf(req), userIdOf(req)))),

  representative: handler(async (req, res) =>
    ok(res, await partnerApplicationService.updateRepresentative(ctxOf(req), req.body)),
  ),

  businessScale: handler(async (req, res) =>
    ok(res, await partnerApplicationService.updateBusinessScale(ctxOf(req), req.body.scale)),
  ),

  brand: handler(async (req, res) => ok(res, await partnerApplicationService.upsertBrand(ctxOf(req), req.body))),

  branch: handler(async (req, res) => ok(res, await partnerApplicationService.upsertBranch(ctxOf(req), req.body))),

  social: handler(async (req, res) => ok(res, await partnerApplicationService.updateSocialLinks(ctxOf(req), req.body))),

  legal: handler(async (req, res) => ok(res, await partnerApplicationService.updateLegal(ctxOf(req), req.body))),

  presign: handler(async (req, res) =>
    ok(res, await partnerUploadService.presign(ctxOf(req), userIdOf(req), req.body), 201),
  ),

  confirm: handler(async (req, res) =>
    ok(res, await partnerUploadService.confirm(ctxOf(req), userIdOf(req), req.body.uploadId, req)),
  ),

  removeDocumentFile: handler(async (req, res) =>
    ok(
      res,
      await partnerUploadService.removeDocumentFile(ctxOf(req), userIdOf(req), docTypeParam(req), req.params.fileId, req),
    ),
  ),

  documentFile: handler(async (req, res) =>
    ok(res, await partnerUploadService.getOwnDocumentFile(ctxOf(req), docTypeParam(req), req.params.fileId)),
  ),

  deletePhoto: handler(async (req, res) => ok(res, await partnerUploadService.deletePhoto(ctxOf(req), req.params.photoId))),

  setCover: handler(async (req, res) => ok(res, await partnerUploadService.setCover(ctxOf(req), req.params.photoId))),

  reorderPhotos: handler(async (req, res) => ok(res, await partnerUploadService.reorderPhotos(ctxOf(req), req.body.ids))),

  submit: handler(async (req, res) =>
    ok(res, await partnerApplicationService.submit(ctxOf(req), userIdOf(req), req.body ?? {}, req)),
  ),

  resubmit: handler(async (req, res) => ok(res, await partnerApplicationService.resubmit(ctxOf(req), userIdOf(req), req))),

  markIssueUpdated: handler(async (req, res) =>
    ok(res, await partnerApplicationService.markIssueUpdated(ctxOf(req), userIdOf(req), req.params.id, req.body?.note, req)),
  ),
};
