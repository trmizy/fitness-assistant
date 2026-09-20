import { Request, Response, NextFunction } from 'express';
import type { PartnerDocumentType } from '../generated/prisma';
import { partnerApplicationReviewService } from '../services/partner-application-review.service';
import { partnerRepository } from '../repositories/partner.repository';
import { failApplication } from './application.controller';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });

function handler(fn: (req: Request, res: Response) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e: any) {
      failApplication(res, e?.status ? e : Object.assign(new Error('Đã có lỗi xảy ra'), { status: 500 }));
    }
  };
}

/** Lỗi nghiệp vụ APPROVE_BLOCKED kèm danh sách lý do — trả nguyên để màn admin hiện từng dòng. */
function failWithBlockers(res: Response, e: any) {
  res.status(e.status || 500).json({
    success: false,
    error: { code: e.code, message: e.message, blockers: e.blockers },
  });
}

const adminId = (req: Request) => req.user!.userId;

export const applicationReviewController = {
  list: handler(async (req, res) => {
    const raw = req.query.verificationStatus;
    const VALID = ['NOT_VERIFIED', 'IN_REVIEW', 'NEEDS_INFO', 'REJECTED', 'VERIFIED'];
    const verificationStatus = typeof raw === 'string' && VALID.includes(raw) ? (raw as any) : undefined;
    ok(res, await partnerApplicationReviewService.listApplications({ verificationStatus }));
  }),

  get: handler(async (req, res) => ok(res, await partnerApplicationReviewService.getApplication(req.params.id))),

  documentFile: handler(async (req, res) =>
    ok(
      res,
      await partnerApplicationReviewService.getDocumentFile(
        req.params.id,
        req.params.docType as PartnerDocumentType,
        adminId(req),
        req,
      ),
    ),
  ),

  acceptDocument: handler(async (req, res) =>
    ok(
      res,
      await partnerApplicationReviewService.acceptDocument(req.params.id, req.params.docType as PartnerDocumentType, adminId(req), req),
    ),
  ),

  requestChanges: handler(async (req, res) =>
    ok(res, await partnerApplicationReviewService.requestChanges(req.params.id, adminId(req), req.body, req)),
  ),

  resolveIssue: handler(async (req, res) =>
    ok(res, await partnerApplicationReviewService.resolveIssue(req.params.id, req.params.issueId, adminId(req), req)),
  ),

  reopenIssue: handler(async (req, res) =>
    ok(
      res,
      await partnerApplicationReviewService.reopenIssue(req.params.id, req.params.issueId, adminId(req), req.body.message, req),
    ),
  ),

  async approve(req: Request, res: Response) {
    try {
      ok(res, await partnerApplicationReviewService.approve(req.params.id, adminId(req), req));
    } catch (e: any) {
      if (e?.blockers) return failWithBlockers(res, e);
      failApplication(res, e?.status ? e : Object.assign(new Error('Đã có lỗi xảy ra'), { status: 500 }));
    }
  },

  reject: handler(async (req, res) =>
    ok(res, await partnerApplicationReviewService.reject(req.params.id, adminId(req), req.body.reason, req.body.adminNote, req)),
  ),

  reopen: handler(async (req, res) => ok(res, await partnerApplicationReviewService.reopen(req.params.id, adminId(req), req))),

  publishPhotos: handler(async (req, res) => {
    const branch = req.body?.gymId as string | undefined;
    if (!branch) throw Object.assign(new Error('Thiếu gymId'), { status: 400 });
    ok(res, await partnerApplicationReviewService.publishPhotos(branch));
  }),
};

/**
 * Hồ sơ tự đăng ký có MỘT vòng đời duy nhất (/partners/:id/application/*), mọi bước để lại dấu vết
 * trong PartnerAuditLog. Các thao tác admin cũ — sửa hồ sơ, nhập/duyệt giấy tờ bằng URL gõ tay, đặt
 * verificationStatus trực tiếp, từ chối/mở lại, cấp tài khoản — không có audit theo hồ sơ và sẽ tạo ra
 * một vòng đời thứ hai song song, nên bị chặn với hồ sơ SELF_SERVICE. Hồ sơ cũ do admin nhập tay
 * (ADMIN_CREATED) không bị ảnh hưởng.
 */
export async function blockSelfServicePartner(req: Request, res: Response, next: NextFunction) {
  try {
    const partner = await partnerRepository.findPartnerById(req.params.id);
    if (partner?.source === 'SELF_SERVICE') {
      res.status(409).json({
        success: false,
        error: {
          code: 'SELF_SERVICE_APPLICATION',
          message: 'Đây là hồ sơ tự đăng ký — hãy xử lý trong màn "Duyệt hồ sơ đối tác"',
        },
      });
      return;
    }
    next();
  } catch (e: any) {
    res.status(e.status || 500).json({ success: false, error: { message: e.message } });
  }
}
