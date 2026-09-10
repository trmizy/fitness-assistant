import axios from 'axios';
import { logger } from '@gym-coach/shared';

const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

const headers = { 'x-service-secret': INTERNAL_SERVICE_SECRET };

export const userClient = {
  /**
   * Phase 5 — số hợp đồng PT đang ACTIVE tại các chi nhánh này, cho màn xác nhận chấm dứt
   * hợp tác. Không quan trọng bằng số hội viên (tiền chính nằm ở đó), nên lỗi mạng ở đây
   * không được chặn cả màn hình — trả 0 kèm cảnh báo log thay vì ném lỗi lên trên.
   */
  async countActivePtContractsByGyms(gymIds: string[]): Promise<number> {
    if (gymIds.length === 0) return 0;
    try {
      const { data } = await axios.post(
        `${USER_SERVICE_URL}/internal/contracts/count-active-by-gyms`,
        { gymIds },
        { headers, timeout: 5000 },
      );
      return data.count as number;
    } catch (e) {
      logger.error({ err: (e as Error).message }, '[gym-service] đếm hợp đồng PT thất bại — trả 0');
      return 0;
    }
  },

  /**
   * GYM_MANAGEMENT master spec, Phase 5 (Complaints) — "khách nhận thông báo khi xử lý
   * xong". Reuses user-service's existing generic `POST /internal/notifications` (built for
   * fitness-service's WORKOUT_* events) rather than inventing a second notification
   * pipeline — gym-service never had a write path into that table before this. Best-effort:
   * a failed notification must never fail the complaint resolution itself.
   */
  async notifyUser(params: { userId: string; text: string; eventType: string; entityType: string; entityId: string; link?: string }) {
    try {
      await axios.post(`${USER_SERVICE_URL}/internal/notifications`, params, { headers, timeout: 5000 });
    } catch (e) {
      logger.error({ err: (e as Error).message, userId: params.userId }, '[gym-service] gửi thông báo thất bại');
    }
  },
};
