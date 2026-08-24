import { DayOfWeek, SessionStatus } from "../generated/prisma";
import { availabilityRepository } from "../repositories/availability.repository";
import { sessionRepository } from "../repositories/session.repository";
import { profileRepository, prisma } from "../repositories/profile.repository";
import { notificationService } from "./notification.service";
import { compensateNoShowMoney } from "./contract-payout.service";
import { resolveSessionOutcome } from "./session-outcome";

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const DAY_MAP: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY,
  1: DayOfWeek.MONDAY,
  2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY,
  4: DayOfWeek.THURSDAY,
  5: DayOfWeek.FRIDAY,
  6: DayOfWeek.SATURDAY,
};

const DAY_ORDER: Record<string, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

// Normalize abbreviated or mixed-case day names from PTApplication to DayOfWeek enum values.
const DAY_NAME_NORMALIZE: Record<string, DayOfWeek> = {
  MONDAY: DayOfWeek.MONDAY,
  Monday: DayOfWeek.MONDAY,
  Mon: DayOfWeek.MONDAY,
  TUESDAY: DayOfWeek.TUESDAY,
  Tuesday: DayOfWeek.TUESDAY,
  Tue: DayOfWeek.TUESDAY,
  WEDNESDAY: DayOfWeek.WEDNESDAY,
  Wednesday: DayOfWeek.WEDNESDAY,
  Wed: DayOfWeek.WEDNESDAY,
  THURSDAY: DayOfWeek.THURSDAY,
  Thursday: DayOfWeek.THURSDAY,
  Thu: DayOfWeek.THURSDAY,
  FRIDAY: DayOfWeek.FRIDAY,
  Friday: DayOfWeek.FRIDAY,
  Fri: DayOfWeek.FRIDAY,
  SATURDAY: DayOfWeek.SATURDAY,
  Saturday: DayOfWeek.SATURDAY,
  Sat: DayOfWeek.SATURDAY,
  SUNDAY: DayOfWeek.SUNDAY,
  Sunday: DayOfWeek.SUNDAY,
  Sun: DayOfWeek.SUNDAY,
};

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * "YYYY-MM-DD" in the process timezone, which the containers set to Asia/Ho_Chi_Minh.
 *
 * `toISOString().slice(0, 10)` was used for this and is wrong east of Greenwich: local
 * midnight on the 12th is 17:00 UTC on the 11th, so the day the loop was walking and the
 * day a booked session was keyed under never matched. Booked slots and days off were
 * therefore never subtracted — the count was just "every slot the PT publishes". Anything
 * that compares a wall-clock day has to read the same clock `getDay()` and `getHours()` do.
 */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface SlotAvailabilityRow {
  ptUserId: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  isActive: boolean;
}
export interface SlotExceptionRow {
  ptUserId: string;
  date: Date;
}
export interface SlotBookedRow {
  ptUserId: string;
  scheduledStartAt: Date;
}

/**
 * The slot arithmetic on its own, with the database already read.
 *
 * Split out from countAvailableSlotsForPTs so it can be tested against fixed rows: the
 * number this produces drives the purchase warning a client is shown, and until it was
 * pinned by tests it was silently ignoring every booking and day off.
 */
export function countSlotsFromRows(input: {
  ptUserIds: string[];
  availabilities: SlotAvailabilityRow[];
  exceptions: SlotExceptionRow[];
  bookedSessions: SlotBookedRow[];
  fromDate: Date;
  toDate: Date;
  sessionDurationMinutes: number;
}): Record<string, number> {
  const { ptUserIds, availabilities, exceptions, bookedSessions, fromDate, toDate, sessionDurationMinutes } = input;

  // ptUserId -> set of local date strings the PT is unavailable
  const exceptionsByPT: Record<string, Set<string>> = {};
  for (const ex of exceptions) {
    if (!exceptionsByPT[ex.ptUserId]) exceptionsByPT[ex.ptUserId] = new Set();
    exceptionsByPT[ex.ptUserId].add(localDateKey(new Date(ex.date)));
  }

  // ptUserId -> set of "HH:MM@YYYY-MM-DD" already taken
  const bookedByPT: Record<string, Set<string>> = {};
  for (const s of bookedSessions) {
    if (!bookedByPT[s.ptUserId]) bookedByPT[s.ptUserId] = new Set();
    const start = new Date(s.scheduledStartAt);
    const h = String(start.getHours()).padStart(2, "0");
    const m = String(start.getMinutes()).padStart(2, "0");
    bookedByPT[s.ptUserId].add(`${h}:${m}@${localDateKey(start)}`);
  }

  const availByPT: Record<string, SlotAvailabilityRow[]> = {};
  for (const a of availabilities) {
    if (!availByPT[a.ptUserId]) availByPT[a.ptUserId] = [];
    availByPT[a.ptUserId].push(a);
  }

  const result: Record<string, number> = {};

  for (const ptUserId of ptUserIds) {
    const ptAvail = availByPT[ptUserId] ?? [];
    const ptExceptions = exceptionsByPT[ptUserId] ?? new Set<string>();
    const ptBooked = bookedByPT[ptUserId] ?? new Set<string>();

    let slotCount = 0;
    const current = new Date(fromDate);
    while (current <= toDate) {
      const dateStr = localDateKey(current);
      const dayOfWeek = DAY_MAP[current.getDay()];

      if (!ptExceptions.has(dateStr)) {
        const blocks = ptAvail.filter((a) => a.dayOfWeek === dayOfWeek && a.isActive);
        for (const block of blocks) {
          let cur = timeToMinutes(block.startTime);
          const end = timeToMinutes(block.endTime);
          while (cur + sessionDurationMinutes <= end) {
            if (!ptBooked.has(`${minutesToTime(cur)}@${dateStr}`)) slotCount++;
            cur += sessionDurationMinutes;
          }
        }
      }

      current.setDate(current.getDate() + 1);
    }

    result[ptUserId] = slotCount;
  }

  return result;
}

/**
 * The single nearest bookable slot, instead of a count. Walks the same day-by-day,
 * block-by-block arithmetic as countSlotsFromRows and stops at the first opening — used to
 * tell a client "PT is booked solid this week, but has an opening on the 14th" instead of
 * just a bare low-availability warning with no next step.
 *
 * Split out as a pure function for the same reason countSlotsFromRows is: the day/hour
 * arithmetic is exactly the kind of thing that silently breaks (see the timezone bug fixed
 * above) and deserves tests pinned to fixed rows, not just "did the UI look right once".
 */
export function findEarliestSlotFromRows(input: {
  ptUserId: string;
  availabilities: SlotAvailabilityRow[];
  exceptions: SlotExceptionRow[];
  bookedSessions: SlotBookedRow[];
  fromDate: Date;
  toDate: Date;
  sessionDurationMinutes: number;
}): { date: string; startTime: string } | null {
  const { ptUserId, availabilities, exceptions, bookedSessions, fromDate, toDate, sessionDurationMinutes } = input;

  const exceptionDates = new Set(
    exceptions.filter((e) => e.ptUserId === ptUserId).map((e) => localDateKey(new Date(e.date))),
  );

  const booked = new Set<string>();
  for (const s of bookedSessions) {
    if (s.ptUserId !== ptUserId) continue;
    const start = new Date(s.scheduledStartAt);
    const h = String(start.getHours()).padStart(2, "0");
    const m = String(start.getMinutes()).padStart(2, "0");
    booked.add(`${h}:${m}@${localDateKey(start)}`);
  }

  const ptAvail = availabilities.filter((a) => a.ptUserId === ptUserId && a.isActive);

  const current = new Date(fromDate);
  while (current <= toDate) {
    const dateStr = localDateKey(current);
    if (!exceptionDates.has(dateStr)) {
      const dayOfWeek = DAY_MAP[current.getDay()];
      // A day can have several blocks (e.g. morning + evening); check them in start-time
      // order so "earliest" really means earliest, not just first-declared.
      const blocks = ptAvail
        .filter((a) => a.dayOfWeek === dayOfWeek)
        .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
      for (const block of blocks) {
        let cur = timeToMinutes(block.startTime);
        const end = timeToMinutes(block.endTime);
        while (cur + sessionDurationMinutes <= end) {
          const slotKey = `${minutesToTime(cur)}@${dateStr}`;
          if (!booked.has(slotKey)) {
            return { date: dateStr, startTime: minutesToTime(cur) };
          }
          cur += sessionDurationMinutes;
        }
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return null;
}

export const availabilityService = {
  // Validate blocks: no overlap, startTime < endTime
  validateAvailabilityBlocks(
    slots: { dayOfWeek: string; startTime: string; endTime: string }[],
  ) {
    // Group by day
    const dayGroups: Record<string, typeof slots> = {};
    for (const slot of slots) {
      if (!DAY_ORDER[slot.dayOfWeek])
        throw err(`Invalid day: ${slot.dayOfWeek}`, 400);
      if (
        !/^\d{2}:\d{2}$/.test(slot.startTime) ||
        !/^\d{2}:\d{2}$/.test(slot.endTime)
      ) {
        throw err("Time must be in HH:MM format", 400);
      }
      if (slot.startTime >= slot.endTime) {
        throw err(
          `Start time must be before end time for ${slot.dayOfWeek}`,
          400,
        );
      }
      if (!dayGroups[slot.dayOfWeek]) dayGroups[slot.dayOfWeek] = [];
      dayGroups[slot.dayOfWeek].push(slot);
    }

    // Check for overlaps in each day
    for (const day in dayGroups) {
      const sorted = [...dayGroups[day]].sort((a, b) =>
        a.startTime.localeCompare(b.startTime),
      );
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].endTime > sorted[i + 1].startTime) {
          throw err(
            `Overlapping blocks detected on ${day}: ${sorted[i].endTime} and ${sorted[i + 1].startTime}`,
            400,
          );
        }
      }
    }
  },

  // Get a PT's weekly availability
  async getAvailability(ptUserId: string) {
    return availabilityRepository.findByPT(ptUserId);
  },

  // Set (replace) a PT's weekly availability
  async setAvailability(
    ptUserId: string,
    slots: { dayOfWeek: string; startTime: string; endTime: string }[],
  ) {
    this.validateAvailabilityBlocks(slots);

    const typed = slots.map((s) => ({
      dayOfWeek: s.dayOfWeek as DayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    await availabilityRepository.replaceAll(ptUserId, typed);
    const savedBlocks = await availabilityRepository.findByPT(ptUserId);

    // Find affected sessions (future sessions that no longer fit in the new availability)
    const futureSessions = await prisma.session.findMany({
      where: {
        ptUserId,
        scheduledStartAt: { gte: new Date() },
        status: { in: ["REQUESTED", "CONFIRMED"] },
      },
    });

    const affectedSessions = futureSessions.filter((session) => {
      const dayOfWeek = DAY_MAP[session.scheduledStartAt.getDay()];
      const startTime = `${String(session.scheduledStartAt.getHours()).padStart(2, "0")}:${String(session.scheduledStartAt.getMinutes()).padStart(2, "0")}`;
      const endTime = `${String(session.scheduledEndAt.getHours()).padStart(2, "0")}:${String(session.scheduledEndAt.getMinutes()).padStart(2, "0")}`;

      // Check if this session fits entirely within at least one of the new blocks
      const fits = typed.some(
        (b) =>
          b.dayOfWeek === dayOfWeek &&
          b.startTime <= startTime &&
          b.endTime >= endTime,
      );
      return !fits;
    });

    return { saved: true, savedBlocks, affectedSessions };
  },

  /**
   * @deprecated Used for one-time seeding from PTApplication to PTAvailability. Do not use for new flows.
   */
  async seedInitialAvailability(ptUserId: string, force = false) {
    const application =
      await profileRepository.findPTApplicationByUserId(ptUserId);
    if (!application) return;

    // 1. Sync sessionDurationMinutes to UserProfile
    await prisma.userProfile.update({
      where: { userId: ptUserId },
      data: { sessionDurationMinutes: application.sessionDurationMinutes },
    });

    // 2. Check if PT already has availability records
    const existing = await availabilityRepository.findByPT(ptUserId);
    if (existing.length > 0 && !force) {
      return; // Already initialized, don't overwrite
    }

    // 3. Process blocks
    let blocks: any[] = [];
    if (application.availabilityBlocks) {
      blocks = application.availabilityBlocks as any[];
    } else {
      // Fallback for old/simple apps
      const days = application.availableDays || [];
      const start = application.availableFrom || "08:00";
      const end = application.availableUntil || "21:00";
      blocks = days.map((day) => ({
        dayOfWeek: day,
        startTime: start,
        endTime: end,
      }));
    }

    if (blocks.length > 0) {
      const typed = blocks
        .map((b) => {
          const day = DAY_NAME_NORMALIZE[b.dayOfWeek as string];
          if (!day) return null;
          return {
            dayOfWeek: day,
            startTime: b.startTime as string,
            endTime: b.endTime as string,
          };
        })
        .filter(
          (
            b,
          ): b is {
            dayOfWeek: DayOfWeek;
            startTime: string;
            endTime: string;
          } => b !== null,
        );
      if (typed.length > 0) {
        await availabilityRepository.replaceAll(ptUserId, typed);
      }
    }
  },

  // Get schedule exceptions (blocked dates)
  async getExceptions(ptUserId: string) {
    return availabilityRepository.findExceptions(ptUserId);
  },

  /**
   * Add a blocked date. Any session already sitting on that date must not just silently keep
   * pointing at a PT who has now marked themselves unavailable that day:
   *   - CONFIRMED → the PT is the one at fault, same as a same-day no-show (§3.4): the client
   *     is compensated one session's value via compensateNoShowMoney, the session doesn't
   *     count against quota, and the reason is recorded on the session itself.
   *   - REQUESTED (never confirmed) → nothing was committed yet, so just cancel it, no
   *     compensation — there is nothing to refund.
   * Both notify the affected client with the block's reason.
   */
  async addException(ptUserId: string, dateStr: string, reason?: string) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) throw err("Invalid date", 400);
    const exception = await availabilityRepository.addException(ptUserId, date, reason);

    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    const conflicts = await sessionRepository.findConflictsByDate(ptUserId, dayStart, dayEnd);

    const reasonSuffix = reason ? `: ${reason}` : "";
    for (const session of conflicts) {
      if (session.status === SessionStatus.CONFIRMED) {
        // Money-flow plan 3.1: routed through the single shared matrix instead of always
        // treating a PT block as a compensated no-show — a block ≥24h out is just a
        // reschedule, no money changes hands (see session-outcome.ts for the full table).
        const hoursBeforeStart = (session.scheduledStartAt.getTime() - Date.now()) / (60 * 60 * 1000);
        const outcome = resolveSessionOutcome({ actor: "PT", event: "CANCEL", hoursBeforeStart });

        await sessionRepository.updateStatus(session.id, outcome.sessionStatus, {
          sessionDeducted: outcome.clientQuotaEffect === "DEDUCT",
          ptNotes: `PT chặn lịch ngày này${reasonSuffix}`,
        });
        if (outcome.clientCompensation) {
          await compensateNoShowMoney(session.contractId, session.id);
          // Money-flow plan 1.2/3.1: if this compensation was the contract's LAST remaining
          // entitlement, the contract must be checked for natural completion here too — the
          // same gap 1.2 fixed for the usual session-confirmation path also applies to a PT
          // block landing on a contract's final session. Lazy import to avoid a circular
          // dependency (contract.service.ts imports this module already).
          const { contractService } = await import("./contract.service");
          await contractService.checkAndCompleteContract(session.contractId);
        }
        await notificationService
          .create({
            userId: session.clientUserId,
            text: outcome.clientCompensation
              ? `Huấn luyện viên đã chặn lịch ngày ${dateStr}${reasonSuffix}. Buổi tập của bạn không bị trừ và bạn được hoàn tiền một buổi vào ví.`
              : `Huấn luyện viên đã chặn lịch ngày ${dateStr}${reasonSuffix}. Buổi tập của bạn không bị trừ — vui lòng đặt lại lịch mới.`,
            eventType: outcome.clientCompensation ? "SESSION_NO_SHOW_PT" : "SESSION_CANCELLED",
            entityType: "SESSION",
            entityId: session.id,
            link: outcome.clientCompensation ? "/client/wallet" : "/client/booking",
          })
          .catch(() => {});
      } else {
        await sessionRepository.updateStatus(session.id, SessionStatus.CANCELLED, {
          ptNotes: `PT chặn lịch ngày này trước khi xác nhận${reasonSuffix}`,
        });
        await notificationService
          .create({
            userId: session.clientUserId,
            text: `Huấn luyện viên đã chặn lịch ngày ${dateStr}${reasonSuffix}. Yêu cầu đặt lịch của bạn đã bị hủy — chưa được xác nhận nên không có khoản nào bị trừ.`,
            eventType: "SESSION_CANCELLED",
            entityType: "SESSION",
            entityId: session.id,
            link: "/client/booking",
          })
          .catch(() => {});
      }
    }

    return { exception, affectedSessions: conflicts.length };
  },

  // Remove a blocked date
  async removeException(id: string, ptUserId: string) {
    await availabilityRepository.removeException(id, ptUserId);
  },

  // Get available time slots for a PT on a specific date
  // Generates slots based on sessionDurationMinutes
  async getAvailableSlots(ptUserId: string, dateStr: string) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) throw err("Invalid date", 400);

    const dayOfWeek = DAY_MAP[date.getDay()];

    // 1. Get PT's session duration (source of truth is UserProfile)
    const profile = await profileRepository.findByUserId(ptUserId);
    const duration = profile?.sessionDurationMinutes || 60;

    // 2. Check if date is blocked
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const exceptions = await availabilityRepository.findExceptions(
      ptUserId,
      dayStart,
      dayEnd,
    );
    if (exceptions.length > 0) return [];

    // 3. Get PT's availability for this day of week.
    // Lazy-seed from PTApplication if no records exist yet (handles PTs approved before
    // the PTAvailability system was in place, or those with abbreviated day names in PTApplication).
    let availability = await availabilityRepository.findByPT(ptUserId);
    if (availability.length === 0) {
      await this.seedInitialAvailability(ptUserId);
      availability = await availabilityRepository.findByPT(ptUserId);
    }
    const dayBlocks = availability.filter(
      (a) => a.dayOfWeek === dayOfWeek && a.isActive,
    );

    if (dayBlocks.length === 0) return [];

    // 4. Generate slots from availability blocks using session duration
    const allSlots: string[] = [];
    for (const block of dayBlocks) {
      let currentMinutes = timeToMinutes(block.startTime);
      const endMinutes = timeToMinutes(block.endTime);

      while (currentMinutes + duration <= endMinutes) {
        allSlots.push(minutesToTime(currentMinutes));
        currentMinutes += duration;
      }
    }

    // 5. Get existing sessions for this PT on this date to filter out booked slots
    const existingSessions = await sessionRepository.findConflictsByDate(
      ptUserId,
      dayStart,
      dayEnd,
    );
    const bookedStarts = new Set<string>();

    for (const session of existingSessions) {
      // For simplicity in this phase, we map booked sessions back to 'HH:MM' start strings
      const h = String(session.scheduledStartAt.getHours()).padStart(2, "0");
      const m = String(session.scheduledStartAt.getMinutes()).padStart(2, "0");
      bookedStarts.add(`${h}:${m}`);
    }

    return allSlots.filter((s) => !bookedStarts.has(s));
  },

  // ─── Slot counting for purchase warnings and PT list display ─────────────
  //
  // SLOT_LOOKAHEAD_DAYS: the look-ahead window used when estimating how many
  // sessions a client can book in the near term. Chosen as 4 weeks — long enough
  // to give a meaningful signal, short enough that PT schedules are reasonably stable.
  // Exposed as a constant so tests can pin it without monkey-patching.
  SLOT_LOOKAHEAD_DAYS: 28,

  /**
   * Batch-count available slots for multiple PTs over a date window.
   * Fetches PTAvailability, PTScheduleException, and Session data in 3 queries
   * (not 3N), then calculates everything in memory.
   *
   * No Redis cache. At current scale the 3-query batch is fast enough.
   * If profiling shows otherwise, a short-lived cache can be added without
   * changing the public interface. (see docs/pt-scheduling-and-discovery.md)
   */
  async countAvailableSlotsForPTs(
    ptUserIds: string[],
    fromDate: Date,
    toDate: Date,
    sessionDurationMinutes = 60,
  ): Promise<Record<string, number>> {
    if (ptUserIds.length === 0) return {};

    // Three batch queries — not 3N.
    const [availabilities, exceptions, bookedSessions] = await Promise.all([
      availabilityRepository.findByPTs(ptUserIds),
      availabilityRepository.findExceptionsByPTsAndRange(ptUserIds, fromDate, toDate),
      sessionRepository.findBookedByPTsAndRange(ptUserIds, fromDate, toDate),
    ]);

    return countSlotsFromRows({
      ptUserIds,
      availabilities,
      exceptions,
      bookedSessions,
      fromDate,
      toDate,
      sessionDurationMinutes,
    });
  },

  /**
   * Single-PT convenience wrapper — used in the contract request flow.
   */
  async countAvailableSlotsForPT(
    ptUserId: string,
    sessionDurationMinutes = 60,
    lookaheadDays?: number,
  ): Promise<number> {
    const days = lookaheadDays ?? this.SLOT_LOOKAHEAD_DAYS;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + days - 1);
    to.setHours(23, 59, 59, 999);
    const counts = await this.countAvailableSlotsForPTs([ptUserId], from, to, sessionDurationMinutes);
    return counts[ptUserId] ?? 0;
  },

  /**
   * The nearest date/time a client could actually book this PT — the fallback the
   * low-availability warning offers instead of leaving the client to guess. Searches a wider
   * window than the 28-day purchase-warning count (EARLIEST_SLOT_SEARCH_DAYS): a PT who is
   * booked solid for the next four weeks may still have an opening five weeks out, and "no
   * suggestion at all" is a worse answer than one slightly outside the usual lookahead.
   * Returns null if genuinely nothing opens up within that window.
   */
  EARLIEST_SLOT_SEARCH_DAYS: 60,

  async findEarliestAvailableSlot(
    ptUserId: string,
    sessionDurationMinutes = 60,
    searchDays?: number,
  ): Promise<{ date: string; startTime: string } | null> {
    const days = searchDays ?? this.EARLIEST_SLOT_SEARCH_DAYS;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + days - 1);
    to.setHours(23, 59, 59, 999);

    const [availabilities, exceptions, bookedSessions] = await Promise.all([
      availabilityRepository.findByPTs([ptUserId]),
      availabilityRepository.findExceptionsByPTsAndRange([ptUserId], from, to),
      sessionRepository.findBookedByPTsAndRange([ptUserId], from, to),
    ]);

    return findEarliestSlotFromRows({
      ptUserId,
      availabilities,
      exceptions,
      bookedSessions,
      fromDate: from,
      toDate: to,
      sessionDurationMinutes,
    });
  },
};
