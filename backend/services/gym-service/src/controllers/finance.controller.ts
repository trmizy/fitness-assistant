import { Request, Response } from 'express';
import { brandService } from '../services/brand.service';
import { principalId } from '../middleware/partner-context.middleware';
import { canAccessGym, filterByScope } from '../services/partner-permissions';
import { parseCommissionRange, ptCommissionSummaryService } from '../services/pt-commission-summary.service';

export const financeController = {
  /**
   * D15b - GET /owner/brands/:brandId/pt-commission?from=&to=&gymId=
   * TỔNG hoa hồng PT theo kỳ của một thương hiệu, trong phạm vi của người gọi (kế toán để trống = cả thương hiệu; có
   * gán = chỉ các chi nhánh đó). `gymId` thu hẹp xuống một chi nhánh nhưng PHẢI nằm trong phạm vi. Không có chiều theo
   * PT. (Đặt dưới /owner/brands vì gateway chỉ proxy các prefix /owner/* khai báo tường minh.)
   */
  async ptCommission(req: Request, res: Response) {
    try {
      const ctx = req.partner!;
      const range = parseCommissionRange({ from: req.query.from, to: req.query.to });
      if (!range.ok) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_QUERY', message: range.error } });
      }
      // Thương hiệu phải thuộc ĐÚNG đối tác này (403/404 từ service); phạm vi chi nhánh lọc tiếp bên dưới.
      const brand = await brandService.getOwnedBrandWithBranches(req.params.brandId, principalId(req));
      const branches = ((brand as any)?.branches ?? []) as Array<{ id: string }>;
      let visible = filterByScope(ctx, branches);
      const only = typeof req.query.gymId === 'string' && req.query.gymId ? req.query.gymId : null;
      if (only) {
        if (!canAccessGym(ctx, only) || !visible.some((g) => g.id === only)) {
          return res.status(403).json({ success: false, error: { code: 'GYM_OUT_OF_SCOPE', message: 'Bạn không được phân công chi nhánh này' } });
        }
        visible = visible.filter((g) => g.id === only);
      }
      const data = await ptCommissionSummaryService.summarize(visible.map((g) => g.id), range.from, range.to);
      return res.json({ success: true, data });
    } catch (e: any) {
      return res.status(e.status || 500).json({ success: false, error: { message: e.message } });
    }
  },
};
