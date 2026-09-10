import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { resolvePartnerContext, requirePartnerOwner, requireGymScope, principalId } from '../middleware/partner-context.middleware';
import { requireOnboardingComplete } from '../middleware/onboarding-gate.middleware';
import { partnerGuard } from '../services/partner-guard.service';
import { gymController } from '../controllers/gym.controller';
import { gymDraftController } from '../controllers/gym-draft.controller';
import { gymHoursController } from '../controllers/gym-hours.controller';
import { gymPhotoController } from '../controllers/gym-photo.controller';
import { gymBranchDocumentController } from '../controllers/gym-branch-document.controller';
import { branchDocumentPhotoController } from '../controllers/branch-document-photo.controller';
import { gymBranchReviewController } from '../controllers/gym-branch-review.controller';
import { brandController } from '../controllers/brand.controller';
import { planController } from '../controllers/plan.controller';
import { membershipController } from '../controllers/membership.controller';
import { affiliationController } from '../controllers/affiliation.controller';
import { checkinController } from '../controllers/checkin.controller';
import { collaborationController } from '../controllers/collaboration.controller';
import { paymentClient } from '../clients/payment.client';
import { gymService } from '../services/gym.service';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate.middleware';
import { brandCreateSchema, brandUpdateSchema } from '../schemas/brand.schemas';
import { gymCreateSchema, gymUpdateSchema, gymOperationalStatusSchema } from '../schemas/gym.schemas';
import { planCreateSchema, planUpdateSchema } from '../schemas/plan.schemas';
import { onboardingController } from '../controllers/onboarding.controller';
import { ownerPartnerController } from '../controllers/owner-partner.controller';

const router = Router();
// requireRoles('GYM_OWNER') vẫn là cổng vào duy nhất ở tầng xác thực — mọi tài khoản đối
// tác (chủ sở hữu lẫn quản lý) đều mang đúng vai trò đó. resolvePartnerContext mới là chỗ
// phân biệt hai cấp quyền BÊN TRONG một đối tác.
router.use(extractUser, requireAuth, requireRoles('GYM_OWNER'), resolvePartnerContext);

// ── Phase 3: trình thiết lập lần đầu ─────────────────────────────────────────
// PHẢI mount TRƯỚC requireOnboardingComplete bên dưới — đây chính là các route hoàn tất
// từng bước, tự chặn chính mình thì không ai thoát được trình thiết lập.
router.get('/onboarding/status', asyncHandler(onboardingController.status));
router.patch('/onboarding/contact', asyncHandler(onboardingController.submitContact));
router.post('/onboarding/brand', asyncHandler(onboardingController.submitBrand));
router.patch('/onboarding/payout', asyncHandler(onboardingController.submitPayout));
router.post('/onboarding/terms', asyncHandler(onboardingController.submitTerms));

// "Không vào được màn hình nào khi chưa xong 5 bước" (MANAGER: 2 bước) — mọi route /owner
// khác nằm SAU điểm này.
router.use(requireOnboardingComplete);

// Phase 3 mục 3.2 — chủ sở hữu tự mời/thu hồi quản lý chi nhánh, không cần admin.
router.get('/partner-accounts', requirePartnerOwner, asyncHandler(ownerPartnerController.listAccounts));
router.delete('/partner-accounts/:accountId', requirePartnerOwner, asyncHandler(ownerPartnerController.revokeAccount));
router.get('/partner-invitations', requirePartnerOwner, asyncHandler(ownerPartnerController.listInvitations));
router.post('/partner-invitations', requirePartnerOwner, asyncHandler(ownerPartnerController.inviteManager));
router.post('/partner-invitations/:id/resend', requirePartnerOwner, asyncHandler(ownerPartnerController.resendInvitation));
router.delete('/partner-invitations/:id', requirePartnerOwner, asyncHandler(ownerPartnerController.revokeInvitation));

// ── Ma trận quyền (Phase 1, mục 1.4) ────────────────────────────────────────
// Ranh giới một câu: **tiền và người thì chỉ chủ sở hữu**.
//
//   requirePartnerOwner  → ví, rút tiền, mời/thu hồi người, cộng tác PT, thương hiệu,
//                          tạo/sửa chi nhánh, quản lý gói (gói là brand-wide nên không
//                          giới hạn theo chi nhánh được — đã chốt: chỉ chủ sở hữu sửa)
//   requireGymScope(...) → quản lý chỉ thao tác trên chi nhánh được phân công
//   (không guard)        → đọc chung, đã tự lọc theo phạm vi trong controller

// A chain: one owner, many branches (Gym rows below with brandId set). Optional — an owner
// who never creates a brand just keeps creating standalone gyms exactly as before.
router.post('/brands', requirePartnerOwner, validateBody(brandCreateSchema), asyncHandler(brandController.create));
router.get('/brands', asyncHandler(brandController.listOwned));
router.get('/brands/:id', asyncHandler(brandController.getOwnedById));
router.patch('/brands/:id', requirePartnerOwner, validateBody(brandUpdateSchema), asyncHandler(brandController.update));

// Ownership is verified per-row inside each service method (gymService.getOwnedGym) —
// requireRoles('GYM_OWNER') alone only proves the caller is *a* gym owner, not that
// they own *this* gym.
router.post('/gyms', requirePartnerOwner, validateBody(gymCreateSchema), asyncHandler(gymController.createOwned));
// GYM_BRANCH_FORM_SPEC.md, Phase 1 — "Add Branch" wizard shell. requirePartnerOwner is the
// same §95.2 gate as the route above: a MANAGER cannot create/edit a branch, draft or not.
// No validateBody here on purpose — a draft's whole point is accepting partial, unvalidated
// state (see gym-draft.service.ts's own doc comment); full validation happens once, at submit.
router.post('/gyms/draft', requirePartnerOwner, asyncHandler(gymDraftController.create));
router.patch('/gyms/:id/draft', requirePartnerOwner, asyncHandler(gymDraftController.update));
router.post('/gyms/:id/submit', requirePartnerOwner, asyncHandler(gymDraftController.submit));
// GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours". §74: free edit whether DRAFT
// or already APPROVED, so this isn't scoped under /draft the way the other new routes are.
router.get('/gyms/:id/hours', requirePartnerOwner, asyncHandler(gymHoursController.get));
router.put('/gyms/:id/hours', requirePartnerOwner, asyncHandler(gymHoursController.set));
// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Public gallery — no validateBody (the
// write payload here is multipart/form-data, not JSON).
router.get('/gyms/:id/photos', requirePartnerOwner, asyncHandler(gymPhotoController.list));
router.post('/gyms/:id/photos', requirePartnerOwner, gymPhotoController.uploadMiddleware, asyncHandler(gymPhotoController.upload));
router.put('/gyms/:id/photos/reorder', requirePartnerOwner, asyncHandler(gymPhotoController.reorder));
router.patch('/gyms/:id/photos/:photoId/cover', requirePartnerOwner, asyncHandler(gymPhotoController.setCover));
router.delete('/gyms/:id/photos/:photoId', requirePartnerOwner, asyncHandler(gymPhotoController.remove));
// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification" (branch-level only, §95.4).
router.get('/gyms/:id/branch-documents', requirePartnerOwner, asyncHandler(gymBranchDocumentController.list));
router.post(
  '/gyms/:id/branch-documents/:docType',
  requirePartnerOwner,
  branchDocumentPhotoController.uploadMiddleware,
  asyncHandler(gymBranchDocumentController.attach),
);
router.get('/branch-documents/:token', requirePartnerOwner, asyncHandler(branchDocumentPhotoController.serve));
// GYM_BRANCH_FORM_SPEC.md, Phase 4 — the wizard's "fix loop" banner reads this to show which
// categories admin flagged, so the owner knows exactly what to revisit before resubmitting.
router.get('/gyms/:id/review-issues', requirePartnerOwner, asyncHandler(gymBranchReviewController.listOpenForOwner));
router.get('/gyms', asyncHandler(gymController.listOwned));
router.get('/gyms/:id', requireGymScope('id'), asyncHandler(gymController.getOwnedById));
router.patch('/gyms/:id', requirePartnerOwner, validateBody(gymUpdateSchema), asyncHandler(gymController.updateOwned));

// Vòng 4 / Phase C3 — the owner's own open/close switch, separate from admin moderation.
// Quản lý chi nhánh được phép đổi trạng thái vận hành của đúng chi nhánh mình phụ trách.
router.patch('/gyms/:id/operational-status', requireGymScope('id'), validateBody(gymOperationalStatusSchema), asyncHandler(gymController.setOperationalStatus));
// GYM_BRANCH_FORM_SPEC.md, Phase 5 — shown before confirming permanent closure (§9 of
// GYM_BRANCH_FORM_API_GAPS.md). requireGymScope, not requirePartnerOwner — a MANAGER
// assigned to this branch may be the one clicking "Đóng cửa vĩnh viễn" too.
router.get('/gyms/:id/closure-impact', requireGymScope('id'), asyncHandler(gymController.closureImpact));

router.get('/gyms/:gymId/wallet', requirePartnerOwner, asyncHandler(async (req, res) => {
  try {
    const ownerId = principalId(req);
    const gym = await gymService.getOwnedGym(req.params.gymId, ownerId);
    const wallet = await paymentClient.getWallet('GYM', gym.id);
    res.json({ success: true, data: wallet });
  } catch (e: any) {
    res.status(e.status || 500).json({ success: false, error: { message: e.message } });
  }
}));

// Plans are brand-scoped now (one owner, one brand — see GymMembershipPlan's schema doc
// comment): a plan is sold by the brand, works at every branch, so these hang off /brands/:id
// rather than any one gym.
// Ghi gói = đặt giá bán của cả chuỗi → chỉ chủ sở hữu. Quản lý vẫn ĐỌC được để tư vấn
// khách. (Bảng quyền gốc ghi "quản lý gói: ✅ theo chi nhánh được gán", nhưng gói đã là
// tài sản cấp thương hiệu — không giới hạn theo chi nhánh được; đã chốt hướng này.)
router.post('/brands/:brandId/plans', requirePartnerOwner, validateBody(planCreateSchema), asyncHandler(planController.create));
router.get('/brands/:brandId/plans', asyncHandler(planController.listOwned));
router.patch('/brands/:brandId/plans/:planId', requirePartnerOwner, validateBody(planUpdateSchema), asyncHandler(planController.update));

router.get('/gyms/:gymId/memberships', requireGymScope(), asyncHandler(membershipController.listForOwner));

// Phase 4 — the gym displays this QR at the desk; members scan it to check themselves in.
router.get('/gyms/:gymId/checkin-qr', requireGymScope(), asyncHandler(checkinController.getGymQr));
router.get('/gyms/:gymId/checkins', requireGymScope(), asyncHandler(checkinController.listForGym));

// Mời PT về đầu quân cho chi nhánh là việc "người" → chỉ chủ sở hữu, cùng nhóm với đàm
// phán cộng tác PT bên dưới.
router.post('/gyms/:gymId/trainers', requirePartnerOwner, asyncHandler(affiliationController.invite));

// Gym-owner-initiated side of a revenue-share negotiation (plan §1.2/F3). Note this router
// is mounted at /owner, so `POST /owner/gyms/:gymId/collaborations` and
// `PATCH|DELETE /owner/collaborations/:id` are the real paths — kept distinct from the PT
// side's identical-looking `/gyms/:gymId/collaborations` in pt.routes.ts (mounted at '/').
router.post('/gyms/:gymId/collaborations', requirePartnerOwner, asyncHandler(collaborationController.proposeAsGym));
router.patch('/collaborations/:id', requirePartnerOwner, asyncHandler(collaborationController.respondAsGym));
router.delete('/collaborations/:id', requirePartnerOwner, asyncHandler(collaborationController.terminateAsGym));
// Missing until now — the PT side had its GET (/me/collaborations, pt.routes.ts) but the owner
// side never got the mirror route, even though collaborationController.listMine already
// branches on req.user.role and handles GYM_OWNER correctly. Without this a gym owner had no
// way to see collaboration proposals at all (confirmed live: GymManagePage.tsx's
// CollaborationPanel calls exactly this path and 404s). Frontend already expects
// GET /owner/collaborations (collaborationService.listForOwner in api.ts).
router.get('/collaborations', requirePartnerOwner, asyncHandler(collaborationController.listMine));

// Money-flow plan 5.3 — same ownership-verify-then-proxy shape as /gyms/:gymId/wallet above.
// gym-service has no ledger logic; it only confirms this caller actually owns the gym before
// forwarding to payment-service's internal withdrawal endpoint.
router.post('/gyms/:gymId/withdrawals', requirePartnerOwner, asyncHandler(async (req, res) => {
  try {
    const ownerId = principalId(req);
    const gym = await gymService.getOwnedGym(req.params.gymId, ownerId);
    // Phase 5 mục 5.1 — "Yêu cầu rút tiền ❌ đóng băng", điểm quan trọng nhất của tạm khoá:
    // tiền vẫn được ghi nhận vào ví bình thường, chỉ không rút ra được trong lúc điều tra.
    await partnerGuard.assertWithdrawalsAllowed(ownerId);
    const { amount, payoutInfo } = req.body ?? {};
    const request = await paymentClient.requestGymWithdrawal(gym.id, amount, payoutInfo);
    res.status(201).json({ success: true, data: request });
  } catch (e: any) {
    const status = e.response?.status || e.status || 500;
    const body = e.response?.data ?? { success: false, error: { message: e.message } };
    res.status(status).json(body);
  }
}));

router.get('/gyms/:gymId/withdrawals', requirePartnerOwner, asyncHandler(async (req, res) => {
  try {
    const ownerId = principalId(req);
    const gym = await gymService.getOwnedGym(req.params.gymId, ownerId);
    const list = await paymentClient.listGymWithdrawals(gym.id);
    res.json({ success: true, data: list });
  } catch (e: any) {
    const status = e.response?.status || e.status || 500;
    const body = e.response?.data ?? { success: false, error: { message: e.message } };
    res.status(status).json(body);
  }
}));

export default router;
