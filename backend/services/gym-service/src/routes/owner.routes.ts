import { Router } from 'express';
import { extractUser, requireAuth, requireRoles } from '../middleware/auth.middleware';
import { resolvePartnerContext, requirePartnerOwner, requirePermission, principalId } from '../middleware/partner-context.middleware';
import { withdrawalsFor } from '../services/staff-views';
import { requireOperationalAccess, requirePartnerAccountOrLegacy } from '../middleware/operational-access.middleware';
import applicationRoutes from './application.routes';
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
import { assistedCheckinController } from '../controllers/assisted-checkin.controller';
import { noStorePrivate } from '../middleware/no-store.middleware';
import { financeController } from '../controllers/finance.controller';
import { collaborationController } from '../controllers/collaboration.controller';
import { paymentClient } from '../clients/payment.client';
import { gymService } from '../services/gym.service';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate.middleware';
import { brandCreateSchema, brandUpdateSchema } from '../schemas/brand.schemas';
import { gymQuickCreateSchema, gymUpdateSchema, gymOperationalStatusSchema, gymDraftUpdateSchema } from '../schemas/gym.schemas';
import { sendUploadRouteRetired } from '../services/client-compat.service';
import { planCreateSchema, planUpdateSchema } from '../schemas/plan.schemas';
import { onboardingController } from '../controllers/onboarding.controller';
import { ownerPartnerController } from '../controllers/owner-partner.controller';
import { ownerAmenityRouter, ownerListingRouter } from './owner-listing.routes';

const router = Router();
// requireRoles('GYM_OWNER') vẫn là cổng vào duy nhất ở tầng xác thực — mọi tài khoản đối
// tác (chủ sở hữu lẫn quản lý) đều mang đúng vai trò đó. resolvePartnerContext mới là chỗ
// phân biệt hai cấp quyền BÊN TRONG một đối tác.
router.use(extractUser, requireAuth, requireRoles('GYM_OWNER'), resolvePartnerContext);

// ── VÙNG ỨNG VIÊN — mount TRƯỚC cổng vận hành bên dưới ─────────────────────────
// Hai vùng này là thứ DUY NHẤT một tài khoản chưa được duyệt dùng được. Tự chặn chính mình thì
// không ai hoàn tất được hồ sơ / trình thiết lập.
//
// Hồ sơ đối tác tự đăng ký (GYM_PARTNER_SELF_ONBOARDING_SPEC.md): status + bootstrap dùng được cả
// khi chưa có tài khoản đối tác; phần còn lại tự đòi tài khoản OWNER (xem application.routes.ts).
router.use('/application', applicationRoutes);

// ── Phase 3: trình thiết lập lần đầu ─────────────────────────────────────────
// Đọc/ghi CHÍNH tài khoản đối tác của người gọi → cần có tài khoản (hoặc là chủ gym cũ chứng
// minh được). Trước đây ngữ cảnh không-account được coi như "đã xong hết".
router.get('/onboarding/status', requirePartnerAccountOrLegacy, asyncHandler(onboardingController.status));
router.patch('/onboarding/contact', requirePartnerAccountOrLegacy, asyncHandler(onboardingController.submitContact));
router.post('/onboarding/brand', requirePartnerAccountOrLegacy, asyncHandler(onboardingController.submitBrand));
router.patch('/onboarding/payout', requirePartnerAccountOrLegacy, asyncHandler(onboardingController.submitPayout));
router.post('/onboarding/terms', requirePartnerAccountOrLegacy, asyncHandler(onboardingController.submitTerms));

// ── CỔNG VẬN HÀNH — cho phép dương tính, mặc định từ chối ──────────────────────
// Mọi route /owner khác nằm SAU điểm này: chỉ qua được khi partner ACTIVE + VERIFIED + account
// ACTIVE + onboarding xong (hoặc chủ gym cũ chứng minh được). Xem partner-access.policy.ts.
router.use(requireOperationalAccess);

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
//   requirePartnerOwner  → rút tiền, mời/thu hồi người, cộng tác PT, thương hiệu,
//                          tạo/sửa chi nhánh, ghi gói (gói là brand-wide nên không
//                          giới hạn theo chi nhánh được — đã chốt: chỉ chủ sở hữu sửa)
//   requirePermission(...) → D15: danh mục quyền theo vai trò (partner-permissions.ts), mặc định từ chối,
//                          kèm phạm vi chi nhánh (gymParam). MỌI route đọc/ghi dưới đây đều phải có một trong
//                          hai cổng này — kiểm thử partner-staff-roles.matrix duyệt cây route để chứng minh.

// A chain: one owner, many branches (Gym rows below with brandId set). Optional — an owner
// who never creates a brand just keeps creating standalone gyms exactly as before.
router.post('/brands', requirePartnerOwner, validateBody(brandCreateSchema), asyncHandler(brandController.create));
router.get('/brands', requirePermission('brand.view'), asyncHandler(brandController.listOwned));
router.get('/brands/:id', requirePermission('brand.view'), asyncHandler(brandController.getOwnedById));
router.patch('/brands/:id', requirePartnerOwner, validateBody(brandUpdateSchema), asyncHandler(brandController.update));

// Ownership is verified per-row inside each service method (gymService.getOwnedGym) —
// requireRoles('GYM_OWNER') alone only proves the caller is *a* gym owner, not that
// they own *this* gym.
router.post('/gyms', requirePartnerOwner, validateBody(gymQuickCreateSchema), asyncHandler(gymController.createOwned));
// GYM_BRANCH_FORM_SPEC.md, Phase 1 — "Add Branch" wizard shell. requirePartnerOwner is the
// same §95.2 gate as the route above: a MANAGER cannot create/edit a branch, draft or not.
// A draft's whole point is accepting partial, unvalidated VALUES (see gym-draft.service.ts's own doc comment; full
// validation happens once, at submit) - but the KEYS are strict (gymDraftUpdateSchema): the wizard cannot write a
// column it does not own.
router.post('/gyms/draft', requirePartnerOwner, asyncHandler(gymDraftController.create));
router.patch('/gyms/:id/draft', requirePartnerOwner, validateBody(gymDraftUpdateSchema), asyncHandler(gymDraftController.update));
router.post('/gyms/:id/submit', requirePartnerOwner, asyncHandler(gymDraftController.submit));
// GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours". §74: free edit whether DRAFT
// or already APPROVED, so this isn't scoped under /draft the way the other new routes are.
router.get('/gyms/:id/hours', requirePartnerOwner, asyncHandler(gymHoursController.get));
router.put('/gyms/:id/hours', requirePartnerOwner, asyncHandler(gymHoursController.set));
// GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". Listing Management B1: the disk-photo WRITE routes are retired
// for EVERY gym status - 410 UPLOAD_ROUTE_RETIRED, answered before any upload middleware runs, so nothing is ever
// written to the public disk (a STAGED photo must never sit there). Reading the owner's own list stays.
const retiredPhotoWrite = asyncHandler(async (req, res) => sendUploadRouteRetired(req, res));
router.get('/gyms/:id/photos', requirePartnerOwner, asyncHandler(gymPhotoController.list));
router.post('/gyms/:id/photos', requirePartnerOwner, retiredPhotoWrite);
router.put('/gyms/:id/photos/reorder', requirePartnerOwner, retiredPhotoWrite);
router.patch('/gyms/:id/photos/:photoId/cover', requirePartnerOwner, retiredPhotoWrite);
router.delete('/gyms/:id/photos/:photoId', requirePartnerOwner, retiredPhotoWrite);
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
// Listing Management B2 - the branch listing workflow (revisions, preview, photo upload) and the amenity catalogue /
// proposals. OWNER only (a MANAGER gets 403 from requirePartnerOwner); the branch's ownership is checked per request.
router.use('/gyms/:id/listing', requirePartnerOwner, ownerListingRouter);
router.use('/amenities', requirePartnerOwner, ownerAmenityRouter);
router.get('/gyms', requirePermission('branch.view'), asyncHandler(gymController.listOwned));
router.get('/gyms/:id', requirePermission('branch.view', { gymParam: 'id' }), asyncHandler(gymController.getOwnedById));
router.patch('/gyms/:id', requirePartnerOwner, validateBody(gymUpdateSchema), asyncHandler(gymController.updateOwned));

// Vòng 4 / Phase C3 — the owner's own open/close switch, separate from admin moderation.
// Quản lý chi nhánh được TẠM đóng cửa / mở lại đúng chi nhánh mình phụ trách (requireGymScope).
// Đóng cửa VĨNH VIỄN thì chỉ chủ sở hữu: route này nhận cả ba trạng thái đích nên không gắn
// requirePartnerOwner được — luật theo trạng thái đích nằm trong gymService.setOperationalStatus
// (403 OWNER_ROLE_REQUIRED), kèm việc ghi lại ai đã đóng (`closedBy`).
router.patch('/gyms/:id/operational-status', requirePermission('branch.status.temporary', { gymParam: 'id' }), validateBody(gymOperationalStatusSchema), asyncHandler(gymController.setOperationalStatus));
// GYM_BRANCH_FORM_SPEC.md, Phase 5 — shown before confirming permanent closure (§9 of
// GYM_BRANCH_FORM_API_GAPS.md). requirePartnerOwner: permanent closure is OWNER-only now, so
// nobody else has a reason to open this screen — and it returns the branch's wallet balance and
// its PT-collaboration count, both on the owner-only side of the matrix above.
router.get('/gyms/:id/closure-impact', requirePartnerOwner, asyncHandler(gymController.closureImpact));

// D15: kế toán ĐỌC được ví của chi nhánh trong phạm vi (không có route ghi nào cho vai trò này).
router.get('/gyms/:gymId/wallet', requirePermission('finance.wallet.view', { gymParam: 'gymId' }), asyncHandler(async (req, res) => {
  try {
    const ownerId = principalId(req);
    const gym = await gymService.getOwnedGym(req.params.gymId, ownerId);
    const wallet = await paymentClient.getWallet('GYM', gym.id);
    res.json({ success: true, data: wallet });
  } catch (e: any) {
    res.status(e.status || 500).json({ success: false, error: { message: e.message } });
  }
}));

// D15b: kế toán đọc TỔNG hoa hồng PT theo kỳ (không theo PT, không tỷ lệ). Đặt dưới /brands vì gateway chỉ proxy các
// prefix /owner/* khai báo tường minh. Thương hiệu phải thuộc đối tác; phạm vi chi nhánh lọc trong controller.
router.get('/brands/:brandId/pt-commission', requirePermission('finance.ptCommission.view'), asyncHandler(financeController.ptCommission));

// Plans are brand-scoped now (one owner, one brand — see GymMembershipPlan's schema doc
// comment): a plan is sold by the brand, works at every branch, so these hang off /brands/:id
// rather than any one gym.
// Ghi gói = đặt giá bán của cả chuỗi → chỉ chủ sở hữu. Quản lý vẫn ĐỌC được để tư vấn
// khách. (Bảng quyền gốc ghi "quản lý gói: ✅ theo chi nhánh được gán", nhưng gói đã là
// tài sản cấp thương hiệu — không giới hạn theo chi nhánh được; đã chốt hướng này.)
router.post('/brands/:brandId/plans', requirePartnerOwner, validateBody(planCreateSchema), asyncHandler(planController.create));
router.get('/brands/:brandId/plans', requirePermission('plan.view'), asyncHandler(planController.listOwned));
router.patch('/brands/:brandId/plans/:planId', requirePartnerOwner, validateBody(planUpdateSchema), asyncHandler(planController.update));

// Một route, hai cách nhìn theo vai trò (staff-views.ts): đủ (chủ/quản lý), doanh số không clientId (kế toán).
// Lễ tân KHÔNG có danh sách hội viên (D15b) - chỉ có /front-desk/today bên dưới.
router.get('/gyms/:gymId/memberships', requirePermission(['membership.full', 'membership.sales'], { gymParam: 'gymId' }), asyncHandler(membershipController.listForOwner));

// Phase 4 — the gym displays this QR at the desk; members scan it to check themselves in.
router.get('/gyms/:gymId/checkin-qr', requirePermission('checkin.qr', { gymParam: 'gymId' }), asyncHandler(checkinController.getGymQr));
router.get('/gyms/:gymId/checkins', requirePermission('checkin.list', { gymParam: 'gymId' }), asyncHandler(checkinController.listForGym));
// Phase 2 / P2.2 — PT entries at this branch (separate from member visits; never shows clients).
router.get('/gyms/:gymId/pt-checkins', requirePermission('ptCheckin.list', { gymParam: 'gymId' }), asyncHandler(checkinController.listPtForGym));
// D15b - lễ tân: PT đã check-in hôm nay; khách có lịch/check-in hôm nay (chỉ tên hiển thị), chỉ chi nhánh được gán (gymParam).
// Lễ tân KHÔNG có đường ghi nào cho PT: lượt PT chỉ do chính PT quét QR (gym_pt_check_ins). Đường GHI duy nhất của lễ tân là
// check-in hộ HỘI VIÊN sau khi xác minh danh tính (D15c, bên dưới).
router.get('/gyms/:gymId/pt-checkins/today', requirePermission('ptCheckin.today', { gymParam: 'gymId' }), asyncHandler(checkinController.ptCheckinsToday));
router.get('/gyms/:gymId/front-desk/today', requirePermission('frontDesk.clients', { gymParam: 'gymId' }), asyncHandler(checkinController.frontDeskToday));

// D15c - check-in HỘ hội viên không dùng được QR (quyết định mới của chủ sở hữu, thay D15b #3). Mọi route: phạm vi chi
// nhánh (gymParam) + quyền riêng; danh tính nhân viên lấy từ phiên; phản hồi không cache (có ảnh hồ sơ ký sẵn).
const frontDeskNoStore = noStorePrivate;
router.get('/gyms/:gymId/front-desk/members', frontDeskNoStore, requirePermission('member.search', { gymParam: 'gymId' }), asyncHandler(assistedCheckinController.searchMembers));
router.get('/gyms/:gymId/front-desk/assisted-checkin/config', frontDeskNoStore, requirePermission('checkin.assisted', { gymParam: 'gymId' }), asyncHandler(assistedCheckinController.config));
router.post('/gyms/:gymId/front-desk/assisted-checkin/otp', frontDeskNoStore, requirePermission('checkin.assisted', { gymParam: 'gymId' }), asyncHandler(assistedCheckinController.requestOtp));
router.post('/gyms/:gymId/front-desk/assisted-checkin', frontDeskNoStore, requirePermission('checkin.assisted', { gymParam: 'gymId' }), asyncHandler(assistedCheckinController.checkIn));
router.post('/gyms/:gymId/front-desk/exceptions', frontDeskNoStore, requirePermission('checkin.exception.request', { gymParam: 'gymId' }), asyncHandler(assistedCheckinController.requestException));
router.get('/gyms/:gymId/front-desk/exceptions', frontDeskNoStore, requirePermission(['checkin.exception.request', 'checkin.exception.approve'], { gymParam: 'gymId' }), asyncHandler(assistedCheckinController.listExceptions));
router.post('/gyms/:gymId/front-desk/exceptions/:exceptionId/approve', frontDeskNoStore, requirePermission('checkin.exception.approve', { gymParam: 'gymId' }), asyncHandler(assistedCheckinController.approveException));
router.post('/gyms/:gymId/front-desk/exceptions/:exceptionId/reject', frontDeskNoStore, requirePermission('checkin.exception.approve', { gymParam: 'gymId' }), asyncHandler(assistedCheckinController.rejectException));

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

// D15: lịch sử rút tiền — chủ sở hữu và kế toán (chỉ đọc). Kế toán nhận bản che số tài khoản nhận tiền.
router.get('/gyms/:gymId/withdrawals', requirePermission('finance.withdrawals.view', { gymParam: 'gymId' }), asyncHandler(async (req, res) => {
  try {
    const ownerId = principalId(req);
    const gym = await gymService.getOwnedGym(req.params.gymId, ownerId);
    const list = await paymentClient.listGymWithdrawals(gym.id);
    res.json({ success: true, data: Array.isArray(list) ? withdrawalsFor(req.partner!.role, list) : req.partner!.role === 'OWNER' ? list : [] });
  } catch (e: any) {
    const status = e.response?.status || e.status || 500;
    const body = e.response?.data ?? { success: false, error: { message: e.message } };
    res.status(status).json(body);
  }
}));

export default router;
