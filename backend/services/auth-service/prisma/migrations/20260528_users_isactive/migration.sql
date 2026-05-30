-- BUG-002 / TC-AUTH-10: admin can disable a user. Adds a boolean `isActive`
-- (camelCase to match the existing column convention firstName / lastName / createdAt).
ALTER TABLE "users" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
