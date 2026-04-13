import { DayOfWeek } from '../generated/prisma';
import { availabilityRepository } from '../repositories/availability.repository';
import { sessionRepository } from '../repositories/session.repository';
import { profileRepository, prisma } from '../repositories/profile.repository';

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

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const availabilityService = {
  // Validate blocks: no overlap, startTime < endTime
  validateAvailabilityBlocks(slots: { dayOfWeek: string; startTime: string; endTime: string }[]) {
    // Group by day
    const dayGroups: Record<string, typeof slots> = {};
    for (const slot of slots) {
      if (!DAY_ORDER[slot.dayOfWeek]) throw err(`Invalid day: ${slot.dayOfWeek}`, 400);
      if (!/^\d{2}:\d{2}$/.test(slot.startTime) || !/^\d{2}:\d{2}$/.test(slot.endTime)) {
        throw err('Time must be in HH:MM format', 400);
      }
      if (slot.startTime >= slot.endTime) {
        throw err(`Start time must be before end time for ${slot.dayOfWeek}`, 400);
      }
      if (!dayGroups[slot.dayOfWeek]) dayGroups[slot.dayOfWeek] = [];
      dayGroups[slot.dayOfWeek].push(slot);
    }

    // Check for overlaps in each day
    for (const day in dayGroups) {
      const sorted = [...dayGroups[day]].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].endTime > sorted[i + 1].startTime) {
          throw err(`Overlapping blocks detected on ${day}: ${sorted[i].endTime} and ${sorted[i+1].startTime}`, 400);
        }
      }
    }
  },

  // Get a PT's weekly availability
  async getAvailability(ptUserId: string) {
    return availabilityRepository.findByPT(ptUserId);
  },

  // Set (replace) a PT's weekly availability
  async setAvailability(ptUserId: string, slots: { dayOfWeek: string; startTime: string; endTime: string }[]) {
    this.validateAvailabilityBlocks(slots);

    const typed = slots.map(s => ({
      dayOfWeek: s.dayOfWeek as DayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    await availabilityRepository.replaceAll(ptUserId, typed);
    return availabilityRepository.findByPT(ptUserId);
  },

  /**
   * One-time seeding from PTApplication to PTAvailability and UserProfile.
   * Idempotent check: won't overwrite PTAvailability if records already exist unless force=true.
   */
  async seedInitialAvailability(ptUserId: string, force = false) {
    const application = await profileRepository.findPTApplicationByUserId(ptUserId);
    if (!application) return;

    // 1. Sync sessionDurationMinutes to UserProfile
    await prisma.userProfile.update({
      where: { userId: ptUserId },
      data: { sessionDurationMinutes: application.sessionDurationMinutes }
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
      const start = application.availableFrom || '08:00';
      const end = application.availableUntil || '21:00';
      blocks = days.map(day => ({
        dayOfWeek: day,
        startTime: start,
        endTime: end
      }));
    }

    if (blocks.length > 0) {
      const typed = blocks.map(b => ({
        dayOfWeek: b.dayOfWeek as DayOfWeek,
        startTime: b.startTime,
        endTime: b.endTime
      }));
      await availabilityRepository.replaceAll(ptUserId, typed);
    }
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
  // Generates slots based on sessionDurationMinutes
  async getAvailableSlots(ptUserId: string, dateStr: string) {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) throw err('Invalid date', 400);

    const dayOfWeek = DAY_MAP[date.getDay()];

    // 1. Get PT's session duration (source of truth is UserProfile)
    const profile = await profileRepository.findByUserId(ptUserId);
    const duration = profile?.sessionDurationMinutes || 60;

    // 2. Check if date is blocked
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const exceptions = await availabilityRepository.findExceptions(ptUserId, dayStart, dayEnd);
    if (exceptions.length > 0) return [];

    // 3. Get PT's availability for this day of week
    const availability = await availabilityRepository.findByPT(ptUserId);
    const dayBlocks = availability.filter(a => a.dayOfWeek === dayOfWeek && a.isActive);

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
    const existingSessions = await sessionRepository.findConflictsByDate(ptUserId, dayStart, dayEnd);
    const bookedStarts = new Set<string>();
    
    for (const session of existingSessions) {
      // For simplicity in this phase, we map booked sessions back to 'HH:MM' start strings
      const h = String(session.scheduledStartAt.getHours()).padStart(2, '0');
      const m = String(session.scheduledStartAt.getMinutes()).padStart(2, '0');
      bookedStarts.add(`${h}:${m}`);
    }

    return allSlots.filter(s => !bookedStarts.has(s));
  },
};
