import { Router, type Request, type Response } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { gymController } from '../controllers/gym.controller';
import { brandController } from '../controllers/brand.controller';
import { membershipController } from '../controllers/membership.controller';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate.middleware';
import { gymAdminUpdateSchema } from '../schemas/gym.schemas';
import { partnerController } from '../controllers/partner.controller';
import { partnerDiligenceController } from '../controllers/partner-diligence.controller';
import { commissionRateController } from '../controllers/commission-rate.controller';
import { complaintController } from '../controllers/complaint.controller';
import { complaintPhotoController } from '../controllers/complaint-photo.controller';
import { branchDocumentPhotoController } from '../controllers/branch-document-photo.controller';
import { gymBranchReviewController } from '../controllers/gym-branch-review.controller';
import { gymHoursController } from '../controllers/gym-hours.controller';
import { gymPhotoController } from '../controllers/gym-photo.controller';
import { gymBranchDocumentController } from '../controllers/gym-branch-document.controller';

import { applicationReviewController, blockSelfServicePartner } from '../controllers/application-review.controller';
import { rejectApplicationSchema, reopenIssueSchema, requestChangesSchema } from '../schemas/application.schemas';

const router = Router();
router.use(extractUser, requireAuth, requireRoles('ADMIN'));

// Vòng 4 / Phase C — there was no admin-facing gym/brand moderation list at all before this
// phase; ?status= defaults to everything (the UI defaults it to PENDING_REVIEW itself).
router.get('/gyms', asyncHandler(gymController.listAllForAdmin));
router.patch('/gyms/:id/status', asyncHandler(gymController.setStatus));
// "Quản lý gym & owner" — admin editing a branch's own details directly (name/address take
// effect immediately, no owner-approval round-trip — see gymService.updateGymAsAdmin).
router.patch('/gyms/:id', validateBody(gymAdminUpdateSchema), asyncHandler(gymController.updateAsAdmin));
// C2 — the dedicated action for a rename/address-change on an ALREADY-approved gym (the
// gym's very FIRST approval piggybacks on the /status route above instead — see
// gymService.setStatus's own doc comment).
router.patch('/gyms/:id/approve-rename', asyncHandler(gymController.approveRename));
// GYM_MANAGEMENT master spec §60/§62 — "Yêu cầu chỉnh sửa" theo từng trường, thay vì chỉ có
// duyệt/từ chối. Không đổi `status` — xem doc comment ở gymService.requestChanges.
router.post('/gyms/:id/request-changes', asyncHandler(gymController.requestChanges));
// C3 — the actionable item for a gym the owner permanently closed: still-ACTIVE memberships
// there need an admin to run the existing refundByAdmin(reason: 'GYM_CLOSED') on them.
router.get('/gyms/permanently-closed', asyncHandler(gymController.listPermanentlyClosed));
// GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace: the wizard collects opening
// hours/facilities/photos/verification documents that a bare `GET /admin/gyms` row alone
// doesn't carry (facilities does, via the plain Gym column; hours/photos/documents live in
// their own tables) — these 3 let the pending-review detail view actually show them.
router.get('/gyms/:id/hours', asyncHandler(gymHoursController.getForAdmin));
router.get('/gyms/:id/photos', asyncHandler(gymPhotoController.listForAdmin));
router.get('/gyms/:id/branch-documents', asyncHandler(gymBranchDocumentController.listForAdmin));
// GYM_BRANCH_FORM_SPEC.md, Phase 4 — the SEPARATE "Request Changes" action for a branch's
// first-time PENDING_REVIEW wizard submission (7 categories, sends the branch back to DRAFT
// so the owner can fix it in the wizard) — distinct from /gyms/:id/request-changes above,
// which is name/address only and never touches status. See GymBranchReviewIssue's own
// schema doc comment for why these are two separate mechanisms, not one.
router.post('/gyms/:id/branch-review-issues', asyncHandler(gymBranchReviewController.requestChanges));
router.get('/gyms/:id/branch-review-issues', asyncHandler(gymBranchReviewController.listAllForAdmin));

// C1 — same shape as the gym routes above: list for moderation, plus the dedicated
// "Duyệt đổi tên thương hiệu" action for a rename on a brand that already has an approved name.
router.get('/brands', asyncHandler(brandController.listAllForAdmin));
router.patch('/brands/:id/approve-rename', asyncHandler(brandController.approveRename));

// Exceptional, admin-only membership refund (money-flow plan §2.4) — gym violation/closure/
// transaction error only, `reason` required and validated against that fixed list. Replaces
// the old client-facing POST /me/gym-memberships/:id/refund, which let any client cancel for
// a prorated refund; clients now only get POST /me/gym-memberships/:id/cancel-membership,
// which forfeits the unused portion.
router.post('/gym-memberships/:id/refund', asyncHandler(membershipController.refundByAdmin));

// P0 cluster E2 — memberships whose auto-refund kept failing past payment-service's own
// activation-retry budget; a human resolves them from here.
router.get('/gym-memberships/pending-issues', asyncHandler(membershipController.listPendingIssues));
router.post('/gym-memberships/:id/resolve-pending-issue', asyncHandler(membershipController.resolvePendingIssue));

// ── Quản lý đối tác phòng tập (Phase 2) ──────────────────────────────────────
router.get('/partners/queue', asyncHandler(partnerDiligenceController.queue));
// GYM_MANAGEMENT master spec §61 — Admin Gym Management overview dashboard KPI row.
router.get('/partners/overview-stats', asyncHandler(partnerDiligenceController.overviewStats));
// Hồ sơ đối tác TỰ ĐĂNG KÝ — hàng đợi duyệt. Phải đứng trước /partners/:id.
router.get('/partners/applications', applicationReviewController.list);
router.get('/partners', asyncHandler(partnerController.list));
// Đã ngừng: chủ phòng gym tự đăng ký (/auth/partner-applications) rồi admin duyệt hồ sơ.
// Không còn đường admin tạo/cấp tài khoản chủ gym — xem GYM_PARTNER_SELF_ONBOARDING_SPEC.md.
const retiredOwnerProvisioning = (_req: Request, res: Response) =>
  res.status(410).json({
    success: false,
    error: {
      code: 'ENDPOINT_RETIRED',
      message: 'Admin không còn tạo hồ sơ hay cấp tài khoản chủ phòng gym. Chủ gym tự đăng ký, admin duyệt tại "Hồ sơ đăng ký".',
    },
  });
router.post('/partners', retiredOwnerProvisioning);
router.get('/partners/:id', asyncHandler(partnerController.detail));
router.patch('/partners/:id', blockSelfServicePartner, asyncHandler(partnerController.update));
router.get('/partners/:id/audit-log', asyncHandler(partnerController.auditLog));

// ── Duyệt hồ sơ đối tác tự đăng ký — MỘT vòng đời, mọi bước có dấu vết PartnerAuditLog ──────────────
router.get('/partners/:id/application', applicationReviewController.get);
router.get('/partners/:id/application/documents/:docType/file', applicationReviewController.documentFile);
router.post('/partners/:id/application/documents/:docType/accept', applicationReviewController.acceptDocument);
router.post('/partners/:id/application/request-changes', validateBody(requestChangesSchema), applicationReviewController.requestChanges);
router.post('/partners/:id/application/issues/:issueId/resolve', applicationReviewController.resolveIssue);
router.post('/partners/:id/application/issues/:issueId/reopen', validateBody(reopenIssueSchema), applicationReviewController.reopenIssue);
router.post('/partners/:id/application/approve', applicationReviewController.approve);
router.post('/partners/:id/application/reject', validateBody(rejectApplicationSchema), applicationReviewController.reject);
router.post('/partners/:id/application/reopen', applicationReviewController.reopen);
router.post('/partners/:id/application/publish-photos', applicationReviewController.publishPhotos);

// 2.1/2.3 — cấp tài khoản (PROSPECT -> INVITED, gửi thư mời OWNER).
router.post('/partners/:id/provision', retiredOwnerProvisioning);
router.post('/partners/:id/invitations/:invitationId/resend', asyncHandler(partnerController.resendInvitation));
router.post('/partners/:id/invitations/:invitationId/revoke', asyncHandler(partnerController.revokeInvitation));

// 2.3 — hành động lên từng tài khoản.
router.post('/partner-accounts/:accountId/reset-password', asyncHandler(partnerController.resetPassword));
router.post('/partner-accounts/:accountId/force-logout', asyncHandler(partnerController.forceLogout));
router.delete('/partner-accounts/:accountId', asyncHandler(partnerController.revokeAccount));
router.post('/partners/:id/transfer-ownership', asyncHandler(partnerController.transferOwnership));

// 2.3 — "Xem dưới góc nhìn đối tác": chỉ đọc, bắt buộc ghi nhật ký (partnerController tự làm).
router.get('/partners/:id/view-as', asyncHandler(partnerController.viewAsPartner));

// Phase 4 — thẩm định: giấy tờ, nhật ký trao đổi, điều khoản đã chốt, từ chối/mở lại.
router.get('/partners/:id/documents', asyncHandler(partnerDiligenceController.listDocuments));
router.put('/partners/:id/documents/:docType', blockSelfServicePartner, asyncHandler(partnerDiligenceController.upsertDocument));
router.post('/partners/:id/documents/:docType/verify', blockSelfServicePartner, asyncHandler(partnerDiligenceController.verifyDocument));
router.get('/partners/:id/contact-log', asyncHandler(partnerDiligenceController.listContactLog));
router.post('/partners/:id/contact-log', asyncHandler(partnerDiligenceController.addContactLog));
router.post('/partners/:id/reject', blockSelfServicePartner, asyncHandler(partnerDiligenceController.reject));
router.post('/partners/:id/reopen', blockSelfServicePartner, asyncHandler(partnerDiligenceController.reopen));
// GYM_MANAGEMENT master spec §60 — trục thẩm định riêng (không dùng cho REJECTED, dùng
// /reject ở trên để rejectedAt/rejectionReason và verificationStatus không lệch nhau).
router.patch('/partners/:id/verification-status', blockSelfServicePartner, asyncHandler(partnerDiligenceController.setVerificationStatus));
router.patch('/partners/:id/assigned-admin', asyncHandler(partnerDiligenceController.assignAdmin));
// §65 — "INTERNAL NOTES (Owner-invisible)". Cố ý CHỈ mount ở đây, không bao giờ ở
// owner.routes.ts — đó chính là điều làm nó "owner-invisible".
router.get('/partners/:id/internal-notes', asyncHandler(partnerDiligenceController.listInternalNotes));
router.post('/partners/:id/internal-notes', asyncHandler(partnerDiligenceController.addInternalNote));

// Phase 5 — tạm khoá / bỏ tạm khoá / chấm dứt.
router.post('/partners/:id/suspend', asyncHandler(partnerController.suspend));
router.post('/partners/:id/unsuspend', asyncHandler(partnerController.unsuspend));
router.get('/partners/:id/termination-impact', asyncHandler(partnerController.terminationImpact));
router.post('/partners/:id/terminate', asyncHandler(partnerController.terminate));

// Phase 5 — chiết khấu nền tảng: mức chung có ngày hiệu lực.
router.get('/commission-rate', asyncHandler(commissionRateController.current));
router.get('/commission-rate/history', asyncHandler(commissionRateController.history));
router.post('/commission-rate', asyncHandler(commissionRateController.setRate));

// GYM_MANAGEMENT master spec, Phase 5 — Khiếu nại/Vi phạm. Một hàng đợi chung
// (?status=OPEN|IN_PROGRESS|RESOLVED) bất kể nguồn; tab "Khiếu nại" trên hồ sơ đối tác dùng
// route riêng theo partnerId ngay dưới đây.
router.get('/complaints', asyncHandler(complaintController.queue));
router.post('/complaints', asyncHandler(complaintController.createByAdmin));
router.get('/complaints/:id', asyncHandler(complaintController.detail));
router.patch('/complaints/:id/status', asyncHandler(complaintController.updateStatus));
router.patch('/complaints/:id/assigned-admin', asyncHandler(complaintController.assignAdmin));
router.get('/complaint-photos/:token', asyncHandler(complaintPhotoController.serve));
router.get('/partners/:id/complaints', asyncHandler(complaintController.listForPartner));

// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification". Defense-in-depth mirror of the
// owner-side serve route (see branch-document-photo.controller.ts's own doc comment) — full
// admin listing/review of these documents is Phase 6's scope, not built yet.
router.get('/branch-documents/:token', asyncHandler(branchDocumentPhotoController.serve));

export default router;
