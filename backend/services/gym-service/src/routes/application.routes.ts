import { Router } from 'express';
import { validateBody } from '../middleware/validate.middleware';
import { applicationController } from '../controllers/application.controller';
import {
  applicationBranchSchema,
  applicationBrandSchema,
  businessScaleSchema,
  confirmUploadSchema,
  legalSchema,
  markUpdatedSchema,
  presignSchema,
  reorderPhotosSchema,
  representativeSchema,
  submitApplicationSchema,
} from '../schemas/application.schemas';

/**
 * Hồ sơ đối tác tự đăng ký, phía ỨNG VIÊN. Mount ở /owner/application, SAU resolvePartnerContext và
 * TRƯỚC cổng vận hành (owner.routes.ts) — đây là vùng duy nhất một ứng viên chưa được duyệt dùng
 * được, cùng với /owner/onboarding.
 *
 * `status` và `bootstrap` là hai route duy nhất dùng được cả khi CHƯA có tài khoản đối tác (user
 * GYM_OWNER vừa đặt mật khẩu). Mọi route còn lại tự đòi một tài khoản OWNER (service ném 403
 * NO_PARTNER_ACCOUNT / OWNER_ROLE_REQUIRED) và — với thao tác ghi — trạng thái ONBOARDING hoặc
 * CHANGES_REQUESTED (409 APPLICATION_LOCKED nếu hồ sơ đang xét duyệt/đã từ chối).
 */
const router = Router();

router.get('/status', applicationController.status);
router.post('/bootstrap', applicationController.bootstrap);

router.get('/', applicationController.get);
router.get('/timeline', applicationController.timeline);

router.put('/representative', validateBody(representativeSchema), applicationController.representative);
router.put('/business-scale', validateBody(businessScaleSchema), applicationController.businessScale);
router.put('/brand', validateBody(applicationBrandSchema), applicationController.brand);
router.put('/branch', validateBody(applicationBranchSchema), applicationController.branch);
router.put('/legal', validateBody(legalSchema), applicationController.legal);

// Tải lên: presign → (trình duyệt POST thẳng lên S3) → confirm. Client không bao giờ gửi khoá S3.
router.post('/uploads/presign', validateBody(presignSchema), applicationController.presign);
router.post('/uploads/confirm', validateBody(confirmUploadSchema), applicationController.confirm);
router.put('/photos/reorder', validateBody(reorderPhotosSchema), applicationController.reorderPhotos);
router.patch('/photos/:photoId/cover', applicationController.setCover);
router.delete('/photos/:photoId', applicationController.deletePhoto);

router.post('/submit', validateBody(submitApplicationSchema), applicationController.submit);
router.post('/resubmit', applicationController.resubmit);
router.post('/issues/:id/mark-updated', validateBody(markUpdatedSchema), applicationController.markIssueUpdated);

export default router;
