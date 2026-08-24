-- Money-flow redesign plan 3.6: snapshot of the package's validityDays, applied to endDate on
-- activation. Null preserves today's behavior (no expiry) for every existing/new contract from
-- a package that never declared one.
ALTER TABLE "contracts" ADD COLUMN "validity_days" INTEGER;
