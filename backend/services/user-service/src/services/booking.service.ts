import { SessionStatus, SessionMode, ContractStatus, DayOfWeek } from '../generated/prisma';
import { sessionRepository } from '../repositories/session.repository';
import { contractRepository } from '../repositories/contract.repository';
import { availabilityRepository } from '../repositories/availability.repository';
import { notificationService } from './notification.service';
import { contractService } from './contract.service';

const DAY_MAP: Record<number, DayOfWeek> = {
  0: DayOfWeek.SUNDAY, 1: DayOfWeek.MONDAY, 2: DayOfWeek.TUESDAY,
  3: DayOfWeek.WEDNESDAY, 4: DayOfWeek.THURSDAY, 5: DayOfWeek.FRIDAY, 6: DayOfWeek.SATURDAY,
};

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export const bookingService = {
  // ── Client books a session ──────────────────────────────────────
  async bookSession(clientUserId: string, contractId: string, data: {
    scheduledDate: string;    // "2026-03-25"
    scheduledTime: string;    // "09:00"
    durationMin?: number;     // default 60
    sessionMode?: string;
    location?: string;
    notes?: string;
  }) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err('Contract not found', 404);

    // Must be the client of this contract
    if (contract.clientUserId !== clientUserId) {
      throw err('Not authorized', 403);
    }

    // Contract must be ACTIVE
    if (contract.status !== ContractStatus.ACTIVE) {
      throw err('Contract is not active', 400);
    }

    // Check session limit: usedSessions + pending/confirmed < totalSessions
    const activeSessionCount = await sessionRepository.countActiveByContract(contractId);
    if (contract.usedSessions + activeSessionCount >= contract.totalSessions) {
      throw err('Session limit reached for this contract', 400);
    }

    // Parse datetime
    const durationMin = data.durationMin || 60;
    const startAt = new Date(`${data.scheduledDate}T${data.scheduledTime}:00`);
    if (isNaN(startAt.getTime())) {
      throw err('Invalid date/time', 400);
    }
    const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

    // Must be in the future
    if (startAt <= new Date()) {
      throw err('Cannot book a session in the past', 400);
    }

    // Check contract date range
    if (contract.endDate && startAt > contract.endDate) {
      throw err('Session date is past the contract end date', 400);
    }

    // Check for PT time conflict
    const conflict = await sessionRepository.findConflict(contract.ptUserId, startAt, endAt);
    if (conflict) {
      throw err('This time slot conflicts with another session', 409);
    }

    // Check PT availability (if PT has set availability slots)
    const ptAvailability = await availabilityRepository.findByPT(contract.ptUserId);
    if (ptAvailability.length > 0) {
      const dayOfWeek = DAY_MAP[startAt.getDay()];
      const timeStr = `${String(startAt.getHours()).padStart(2, '0')}:${String(startAt.getMinutes()).padStart(2, '0')}`;
      const endTimeStr = `${String(endAt.getHours()).padStart(2, '0')}:${String(endAt.getMinutes()).padStart(2, '0')}`;

      const matchingSlot = ptAvailability.find(
        a => a.dayOfWeek === dayOfWeek && a.isActive && a.startTime <= timeStr && a.endTime >= endTimeStr
      );
      if (!matchingSlot) {
        throw err('This time is outside the trainer\'s available hours', 400);
      }

      // Check blocked dates
      const dayStart = new Date(startAt); dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(startAt); dayEnd.setHours(23, 59, 59, 999);
      const exceptions = await availabilityRepository.findExceptions(contract.ptUserId, dayStart, dayEnd);
      if (exceptions.length > 0) {
        throw err('The trainer is not available on this date', 400);
      }
    }

    const session = await sessionRepository.create({
      contractId,
      clientUserId,
      ptUserId: contract.ptUserId,
      sessionMode: (data.sessionMode as SessionMode) || SessionMode.OFFLINE,
      scheduledStartAt: startAt,
      scheduledEndAt: endAt,
      location: data.location,
      notes: data.notes,
    });

    // Notify PT
    await notificationService.create({
      userId: contract.ptUserId,
      text: 'New session booking request',
      eventType: 'SESSION_BOOKED',
      entityType: 'SESSION',
      entityId: session.id,
      link: '/pt/contracts',
    }).catch(() => {});

    return session;
  },

  // ── PT confirms a session ───────────────────────────────────────
  async confirmSession(sessionId: string, ptUserId: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err('Session not found', 404);
    if (session.ptUserId !== ptUserId) throw err('Not authorized', 403);
    if (session.status !== SessionStatus.REQUESTED) {
      throw err(`Cannot confirm session in ${session.status} status`, 400);
    }

    const updated = await sessionRepository.updateStatus(sessionId, SessionStatus.CONFIRMED);

    await notificationService.create({
      userId: session.clientUserId,
      text: 'Your session has been confirmed',
      eventType: 'SESSION_CONFIRMED',
      entityType: 'SESSION',
      entityId: sessionId,
      link: '/client/booking',
    }).catch(() => {});

    return updated;
  },

  // ── PT completes a session ──────────────────────────────────────
  async completeSession(sessionId: string, ptUserId: string, ptNotes?: string) {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err('Session not found', 404);
    if (session.ptUserId !== ptUserId) throw err('Not authorized', 403);
    if (session.status !== SessionStatus.CONFIRMED) {
      throw err(`Cannot complete session in ${session.status} status`, 400);
    }

    const updated = await sessionRepository.updateStatus(sessionId, SessionStatus.COMPLETED, {
      completedAt: new Date(),
      ptNotes: ptNotes || undefined,
      sessionDeducted: true,
    });

    // Increment usedSessions on contract
    await contractRepository.incrementSession(session.contractId);

    // Check if contract should auto-complete
    await contractService.checkAndCompleteContract(session.contractId);

    await notificationService.create({
      userId: session.clientUserId,
      text: 'Session marked as completed',
      eventType: 'SESSION_COMPLETED',
      entityType: 'SESSION',
      entityId: sessionId,
      link: '/client/booking',
    }).catch(() => {});

    return updated;
  },

  // ── Cancel session (either party) ──────────────────────────────
  async cancelSession(sessionId: string, userId: string, reason: string) {
    if (!reason?.trim()) throw err('Cancellation reason is required', 400);

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err('Session not found', 404);
    if (session.clientUserId !== userId && session.ptUserId !== userId) {
      throw err('Not authorized', 403);
    }
    if (session.status !== SessionStatus.REQUESTED && session.status !== SessionStatus.CONFIRMED) {
      throw err(`Cannot cancel session in ${session.status} status`, 400);
    }

    const isClient = userId === session.clientUserId;
    const hoursUntilSession = session.scheduledStartAt.getTime() - Date.now();

    // Determine if session should be deducted
    let shouldDeduct = false;
    if (isClient && hoursUntilSession < CANCEL_WINDOW_MS) {
      // Client cancels < 24h → lose session
      shouldDeduct = true;
    }
    // PT cancels → never deducts

    const updated = await sessionRepository.updateStatus(sessionId, SessionStatus.CANCELLED, {
      cancelledBy: userId,
      cancellationReason: reason.trim(),
      sessionDeducted: shouldDeduct,
    });

    // If deducted, increment contract usedSessions
    if (shouldDeduct) {
      await contractRepository.incrementSession(session.contractId);
      await contractService.checkAndCompleteContract(session.contractId);
    }

    // Notify the other party
    const otherUserId = isClient ? session.ptUserId : session.clientUserId;
    await notificationService.create({
      userId: otherUserId,
      text: isClient ? 'Client cancelled a session' : 'Trainer cancelled the session',
      eventType: 'SESSION_CANCELLED',
      entityType: 'SESSION',
      entityId: sessionId,
      link: isClient ? '/pt/contracts' : '/client/booking',
    }).catch(() => {});

    return updated;
  },

  // ── Mark no-show ────────────────────────────────────────────────
  async markNoShow(sessionId: string, userId: string, noShowBy: 'CLIENT' | 'PT') {
    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err('Session not found', 404);

    // Only PT or admin can mark no-show
    if (session.ptUserId !== userId) {
      throw err('Only the PT can mark no-show', 403);
    }
    if (session.status !== SessionStatus.CONFIRMED) {
      throw err(`Cannot mark no-show for session in ${session.status} status`, 400);
    }

    const isClientNoShow = noShowBy === 'CLIENT';

    const updated = await sessionRepository.updateStatus(sessionId, SessionStatus.NO_SHOW, {
      sessionDeducted: isClientNoShow,
      ptNotes: isClientNoShow ? 'Client no-show' : 'PT no-show',
    });

    if (isClientNoShow) {
      // Client no-show: deduct session
      await contractRepository.incrementSession(session.contractId);
      await contractService.checkAndCompleteContract(session.contractId);

      await notificationService.create({
        userId: session.clientUserId,
        text: 'You were marked as no-show for a session',
        eventType: 'SESSION_NO_SHOW_CLIENT',
        entityType: 'SESSION',
        entityId: sessionId,
        link: '/client/booking',
      }).catch(() => {});
    } else {
      // PT no-show: no deduction, notify client
      await notificationService.create({
        userId: session.clientUserId,
        text: 'Your trainer did not show up for the session. No session was deducted.',
        eventType: 'SESSION_NO_SHOW_PT',
        entityType: 'SESSION',
        entityId: sessionId,
        link: '/client/booking',
      }).catch(() => {});
    }

    return updated;
  },

  // ── Client reviews a completed session ──────────────────────────
  async reviewSession(sessionId: string, clientUserId: string, rating: number, comment?: string) {
    if (rating < 1 || rating > 5) throw err('Rating must be between 1 and 5', 400);

    const session = await sessionRepository.findById(sessionId);
    if (!session) throw err('Session not found', 404);
    if (session.clientUserId !== clientUserId) throw err('Not authorized', 403);
    if (session.status !== SessionStatus.COMPLETED) {
      throw err('Can only review completed sessions', 400);
    }
    if (session.review) {
      throw err('Session already reviewed', 409);
    }

    return sessionRepository.createReview({
      sessionId,
      contractId: session.contractId,
      clientUserId,
      rating,
      comment,
    });
  },

  // ── Get sessions for a contract ─────────────────────────────────
  async getContractSessions(contractId: string, userId: string) {
    const contract = await contractRepository.findById(contractId);
    if (!contract) throw err('Contract not found', 404);
    if (contract.clientUserId !== userId && contract.ptUserId !== userId) {
      throw err('Not authorized', 403);
    }
    return sessionRepository.findByContract(contractId);
  },

  // ── Get my upcoming sessions ────────────────────────────────────
  async getMyUpcoming(userId: string) {
    return sessionRepository.findUpcomingByUser(userId);
  },
};
