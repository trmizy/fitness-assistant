import { DayOfWeek } from '../generated/prisma';
import { availabilityRepository } from '../repositories/availability.repository';
import { sessionRepository } from '../repositories/session.repository';

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
  MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4,
  FRIDAY: 5, SATURDAY: 6, SUNDAY: 7,
};

export const availabilityService = {
  // Get a PT's weekly availability
  async getAvailability(ptUserId: string) {
    return availabilityRepository.findByPT(ptUserId);
  },

  // Set (replace) a PT's weekly availability
  async setAvailability(ptUserId: string, slots: { dayOfWeek: string; startTime: string; endTime: string }[]) {
    // Validate
    for (const slot of slots) {
      if (!DAY_ORDER[slot.dayOfWeek]) {
        throw err(`Invalid day: ${slot.dayOfWeek}`, 400);
      }
      if (!/^\d{2}:\d{2}$/.test(slot.startTime) || !/^\d{2}:\d{2}$/.test(slot.endTime)) {
        throw err('Time must be in HH:MM format', 400);
      }
      if (slot.startTime >= slot.endTime) {
        throw err(`Start time must be before end time for ${slot.dayOfWeek}`, 400);
      }
    }

    const typed = slots.map(s => ({
      dayOfWeek: s.dayOfWeek as DayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    await availabilityRepository.replaceAll(ptUserId, typed);
    return availabilityRepository.findByPT(ptUserId);
  },

  // Get schedule exceptions (blocked dates)
  async getExceptions(ptUserId: string) {
    return availabilityRepository.findExceptions(ptUserId);
  },

  // Add a blocked date
  async addException(ptUserId: string, dateStr: string, reason?: string) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) throw err('Invalid date', 400);
    return availabilityRepository.addException(ptUserId, date, reason);
  },

  // Remove a blocked date
  async removeException(id: string, ptUserId: string) {
    await availabilityRepository.removeException(id, ptUserId);
  },

  // Get available time slots for a PT on a specific date
  // Returns list of available start times (1-hour slots)
  async getAvailableSlots(ptUserId: string, dateStr: string) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) throw err('Invalid date', 400);

    const dayOfWeek = DAY_MAP[date.getDay()];

    // Check if date is blocked
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const exceptions = await availabilityRepository.findExceptions(ptUserId, dayStart, dayEnd);
    if (exceptions.length > 0) {
      return []; // Day is blocked
    }

    // Get PT's availability for this day of week
    const availability = await availabilityRepository.findByPT(ptUserId);
    const daySlots = availability.filter(a => a.dayOfWeek === dayOfWeek && a.isActive);

    if (daySlots.length === 0) return [];

    // Generate hourly slots from availability windows
    const allSlots: string[] = [];
    for (const slot of daySlots) {
      const startHour = parseInt(slot.startTime.split(':')[0]);
      const endHour = parseInt(slot.endTime.split(':')[0]);
      for (let h = startHour; h < endHour; h++) {
        allSlots.push(`${String(h).padStart(2, '0')}:00`);
      }
    }

    // Get existing sessions for this PT on this date
    const existingSessions = await sessionRepository.findConflictsByDate(ptUserId, dayStart, dayEnd);

    // Filter out slots that conflict with existing sessions
    const bookedTimes = new Set<string>();
    for (const session of existingSessions) {
      const startHour = session.scheduledStartAt.getHours();
      bookedTimes.add(`${String(startHour).padStart(2, '0')}:00`);
    }

    return allSlots.filter(s => !bookedTimes.has(s));
  },
};
