import { gymHoursRepository } from '../repositories/gym-hours.repository';
import { gymService } from './gym.service';
import type { WeekDay, DayScheduleType } from '../generated/prisma';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

export const ALL_WEEK_DAYS: WeekDay[] = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

export interface DayInput {
  day: WeekDay;
  type: DayScheduleType;
  openMinute?: number | null;
  closeMinute?: number | null;
}

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 2 — Step 3 "Opening Hours". §74 lists opening hours as
 * FREE EDIT even after a branch is approved (unlike name/address), so this is deliberately
 * NOT gated to DRAFT-only the way gym-draft.service.ts's other fields are — one function
 * serves both the wizard and the post-approval branch workspace, same ownership check
 * (`gymService.getOwnedGym`) either way.
 */
export const gymHoursService = {
  /** §18 — "always return all 7 rows, kể cả chưa từng đụng tới" (mirrors
   * partnerDiligenceService.listDocuments's own doc comment for the identical reason: the
   * caller shouldn't have to infer "missing row = CLOSED"). */
  async getHours(gymId: string) {
    const rows = await gymHoursRepository.findByGym(gymId);
    const byDay = new Map(rows.map((r) => [r.day, r]));
    return ALL_WEEK_DAYS.map(
      (day) =>
        byDay.get(day) ?? { id: null, gymId, day, type: 'CLOSED' as DayScheduleType, openMinute: null, closeMinute: null },
    );
  },

  /** §21 — open < close per day; §20 — single interval only (no split hours). Deliberately
   * does NOT enforce "at least one day open" here — that's a submit-time-only rule (§21
   * says "before submission"), an owner mid-edit is allowed to have every day closed for a
   * moment while rearranging. */
  validate(days: DayInput[]) {
    if (days.length !== 7) throw err('Cần đủ 7 ngày trong tuần', 400);
    const seen = new Set<string>();
    for (const d of days) {
      if (seen.has(d.day)) throw err(`Trùng ngày ${d.day}`, 400);
      seen.add(d.day);
      if (d.type === 'OPEN') {
        if (d.openMinute == null || d.closeMinute == null) {
          throw err(`${d.day}: cần giờ mở và giờ đóng cửa`, 400);
        }
        if (d.openMinute < 0 || d.openMinute > 1439 || d.closeMinute < 0 || d.closeMinute > 1439) {
          throw err(`${d.day}: giờ không hợp lệ`, 400);
        }
        if (d.openMinute >= d.closeMinute) {
          throw err(`${d.day}: giờ mở cửa phải trước giờ đóng cửa`, 400);
        }
      }
    }
  },

  async setHours(gymId: string, ownerId: string, days: DayInput[]) {
    await gymService.getOwnedGym(gymId, ownerId);
    this.validate(days);
    await gymHoursRepository.replaceAll(
      gymId,
      days.map((d) => ({
        day: d.day,
        type: d.type,
        openMinute: d.type === 'OPEN' ? d.openMinute! : null,
        closeMinute: d.type === 'OPEN' ? d.closeMinute! : null,
      })),
    );
    return this.getHours(gymId);
  },

  /** §21 — the one rule that's submit-time only, called from gymDraftService.submitForReview. */
  async assertReadyForSubmit(gymId: string) {
    const hours = await this.getHours(gymId);
    const hasAnyOpenDay = hours.some((h) => h.type === 'OPEN' || h.type === 'ALL_DAY');
    if (!hasAnyOpenDay) {
      throw err('Cần ít nhất một ngày mở cửa (hoặc mở 24 giờ) trước khi gửi duyệt', 400);
    }
  },
};
