-- Money-flow redesign plan 1.5: entitlement consumed by a PT no-show, tracked separately
-- from usedSessions and totalSessions (which becomes immutable once signed — see the
-- schema.prisma comment on Contract.totalSessions).
ALTER TABLE "contracts" ADD COLUMN "compensated_sessions" INTEGER NOT NULL DEFAULT 0;
