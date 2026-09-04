-- P0 cluster E2 — a membership whose gym is no longer APPROVED at the moment payment-service
-- confirms payment never activates; it lands here instead (auto-refund attempted immediately,
-- admin queue if that itself fails).
ALTER TYPE "GymMembershipContractStatus" ADD VALUE 'PENDING_ISSUE';
