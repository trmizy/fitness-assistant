import { Request, Response, NextFunction } from 'express';
import { partnerService, type PartnerContext } from '../services/partner.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      partner?: PartnerContext;
    }
  }
}

/**
 * Phase 1 — dịch "ai đang gọi" thành "hồ sơ của ai".
 *
 * Đặt ngay sau requireRoles('GYM_OWNER') trên router /owner. Sau middleware này,
 * `req.partner.principalUserId` là giá trị mọi route phải dùng làm ownerId — KHÔNG dùng
 * `req.user.userId` nữa. Với chủ sở hữu hai giá trị đó bằng nhau; với người quản lý thì
 * khác nhau, và chính chỗ khác nhau đó là điều làm cho "nhiều tài khoản đăng nhập trên
 * cùng một actor GYM_OWNER" chạy được mà không phải sửa một dòng nào trong các service
 * kiểm tra quyền sở hữu sẵn có.
 */
export async function resolvePartnerContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    req.partner = await partnerService.resolveContextForUser(req.user!.userId);
    next();
  } catch (e: any) {
    res.status(e.status || 500).json({
      success: false,
      error: { code: 'PARTNER_CONTEXT_UNRESOLVED', message: e.message },
    });
  }
}

/**
 * Cấp quyền thứ nhất: **tiền và người thì chỉ chủ sở hữu**.
 *
 * Dùng cho ví, rút tiền, mời/thu hồi tài khoản, đàm phán cộng tác PT, sửa thương hiệu,
 * tạo/sửa chi nhánh. Người quản lý gọi vào đây nhận 403 — không phải 404, vì họ có quyền
 * biết chức năng tồn tại nhưng không dành cho mình.
 */
export function requirePartnerOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.partner?.role !== 'OWNER') {
    res.status(403).json({
      success: false,
      error: {
        code: 'OWNER_ROLE_REQUIRED',
        message: 'Chức năng này chỉ dành cho chủ sở hữu — tài khoản quản lý không truy cập được',
      },
    });
    return;
  }
  next();
}

/**
 * requirePartnerOwner cho route dùng chung nhiều vai trò nằm NGOÀI `/owner` (vd
 * `/me/collaborations`, PT + GYM_OWNER): chỉ nhánh GYM_OWNER mới bị đòi cấp OWNER; vai trò khác
 * (PT) không có ngữ cảnh đối tác nên đi tiếp như cũ — controller tự giới hạn theo chính họ.
 *
 * Đặt SAU requireOperationalAccessForOwners (chỗ phân giải `req.partner`). Chủ gym cũ (`isLegacy`)
 * nhận role 'OWNER' từ resolveContextForUser nên qua được, đúng như trên các route /owner.
 */
export function requirePartnerOwnerForOwners(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'GYM_OWNER') {
    next();
    return;
  }
  requirePartnerOwner(req, res, next);
}

/**
 * Cấp quyền thứ hai: người quản lý chỉ thao tác được trên chi nhánh được gán.
 *
 * Chủ sở hữu đi qua vô điều kiện (scopedGymIds rỗng = toàn bộ). Đây KHÔNG thay thế cho
 * kiểm tra quyền sở hữu sẵn có trong service (getOwnedGym): tầng này chỉ trả lời "chi
 * nhánh này có nằm trong phạm vi của người quản lý không", còn "chi nhánh này có thuộc
 * đối tác này không" vẫn do getOwnedGym trả lời bằng principalUserId. Cần cả hai — thiếu
 * cái sau thì một quản lý có thể tự gán scope tới chi nhánh của đối tác khác.
 */
export function requireGymScope(paramName = 'gymId') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.partner;
    if (!ctx) {
      res.status(500).json({ success: false, error: { code: 'PARTNER_CONTEXT_MISSING', message: 'resolvePartnerContext chưa chạy' } });
      return;
    }
    if (ctx.role === 'OWNER') {
      next();
      return;
    }

    const gymId = req.params[paramName];
    if (!gymId || !ctx.scopedGymIds.includes(gymId)) {
      res.status(403).json({
        success: false,
        error: {
          code: 'GYM_OUT_OF_SCOPE',
          message: 'Bạn không được phân công quản lý chi nhánh này',
        },
      });
      return;
    }
    next();
  };
}

/** Đọc ownerId đúng chuẩn cho mọi route dưới /owner. */
export function principalId(req: Request): string {
  return req.partner?.principalUserId ?? req.user!.userId;
}
