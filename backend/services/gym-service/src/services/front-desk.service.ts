import { prisma } from '../repositories/prisma';
import { userClient } from '../clients/user.client';
import { gymService } from './gym.service';
import { localDayWindow } from '../utils/local-day';
import { resolveDisplayNames } from './display-name.service';
import {
  FALLBACK_CLIENT_NAME, FALLBACK_PT_NAME, frontDeskClientView, ptTodayView,
  type FrontDeskClientRow, type PtTodayRow,
} from './staff-views';

/**
 * D15b - dữ liệu CHỈ ĐỌC cho quầy lễ tân ở MỘT chi nhánh (phạm vi chi nhánh do `requirePermission(..., {gymParam})`
 * kiểm trước; `getOwnedGym` chứng minh chi nhánh thuộc đúng đối tác). Không có hàm ghi nào ở đây: lễ tân không
 * check-in hộ hội viên hay PT (luồng QR giữ nguyên, hội viên/PT tự quét bằng phiên của chính họ).
 */

const MAX_ROWS = 200;

export const frontDeskService = {
  /**
   * Khách có liên quan tới chi nhánh HÔM NAY (ngày địa phương Asia/Ho_Chi_Minh): đã check-in tại chi nhánh này, hoặc có
   * lịch tập PT trực tiếp tại chi nhánh này. Mỗi người một dòng. Trả về CHỈ tên hiển thị + giờ — không id, SĐT,
   * e-mail, gói/thẻ, InBody hay sức khoẻ; không phải danh sách hội viên (chỉ người có mặt/được hẹn hôm nay).
   */
  async todayClients(gymId: string, ownerId: string, now: Date = new Date()): Promise<{ localDate: string; bookingsAvailable: boolean; clients: FrontDeskClientRow[] }> {
    await gymService.getOwnedGym(gymId, ownerId);
    const { localDate, start, end } = localDayWindow(now);

    const [checkins, bookings] = await Promise.all([
      prisma.gymCheckIn.findMany({
        where: { gymId, createdAt: { gte: start, lt: end } },
        select: { clientId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1000,
      }),
      userClient.getGymBookedClients({ gymId, from: start, to: end }),
    ]);

    const byClient = new Map<string, { checkedInAt: Date | null; bookedAt: string | null }>();
    for (const c of checkins) {
      const cur = byClient.get(c.clientId) ?? { checkedInAt: null, bookedAt: null };
      if (!cur.checkedInAt || c.createdAt > cur.checkedInAt) cur.checkedInAt = c.createdAt; // lần vào gần nhất
      byClient.set(c.clientId, cur);
    }
    for (const b of bookings.clients) {
      const cur = byClient.get(b.clientUserId) ?? { checkedInAt: null, bookedAt: null };
      cur.bookedAt = b.startAt;
      byClient.set(b.clientUserId, cur);
    }

    const ids = [...byClient.keys()].slice(0, MAX_ROWS);
    const names = await resolveDisplayNames(ids, { max: MAX_ROWS });
    const rows = ids.map((id) => {
      const v = byClient.get(id)!;
      return frontDeskClientView({
        displayName: names.get(id) ?? FALLBACK_CLIENT_NAME,
        checkedInAt: v.checkedInAt ? v.checkedInAt.toISOString() : null,
        bookedAt: v.bookedAt,
      });
    });
    rows.sort((a, b) => String(a.bookedAt ?? a.checkedInAt).localeCompare(String(b.bookedAt ?? b.checkedInAt)));
    return { localDate, bookingsAvailable: bookings.available, clients: rows };
  },

  /** PT đã check-in HÔM NAY tại đúng chi nhánh này (gym_pt_check_ins). Tên + giờ; không ptUserId/số buổi/hợp đồng/khách. */
  async ptCheckinsToday(gymId: string, ownerId: string, now: Date = new Date()): Promise<{ localDate: string; pts: PtTodayRow[] }> {
    await gymService.getOwnedGym(gymId, ownerId);
    const { localDate } = localDayWindow(now);
    const rows = await prisma.gymPtCheckIn.findMany({
      where: { gymId, localDate: new Date(`${localDate}T00:00:00.000Z`) }, // cột DATE: UTC midnight == ngày lưu
      orderBy: { firstScanAt: 'asc' },
      take: MAX_ROWS,
    });
    const names = await resolveDisplayNames(rows.map((r) => r.ptUserId), { max: MAX_ROWS });
    return {
      localDate,
      pts: rows.map((r) =>
        ptTodayView({ id: r.id, ptName: names.get(r.ptUserId) ?? FALLBACK_PT_NAME, firstScanAt: r.firstScanAt, lastScanAt: r.lastScanAt }),
      ),
    };
  },
};
