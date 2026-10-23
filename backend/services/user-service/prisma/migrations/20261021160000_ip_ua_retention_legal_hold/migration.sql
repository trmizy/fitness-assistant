-- IP / user-agent retention (owner decision: 12 months, subject to privacy/legal review).
--
-- ip_address / user_agent on pt_terms_acceptances and audit_logs are personal data. After 12 months the retention sweep
-- (services/ip-ua-retention.service.ts) sets BOTH columns to NULL on the row; the row itself is never deleted. A row under legal
-- hold (legal_hold_until in the future) is skipped. legal_hold_until is written by admin tooling only (scripts/ip-ua-legal-hold.ts).
--
-- Additive and non-destructive: two nullable columns (no default, no backfill, no rewrite) and two partial indexes that make the
-- sweep's "what is still to scrub" query cheap (they only contain rows that still carry an IP or a user agent, so they shrink as the
-- sweep works). Raw SQL: Prisma cannot express partial indexes. Plain CREATE INDEX holds a SHARE lock on the table while it builds
-- (writes wait; milliseconds at current volumes) - run in a low-traffic moment.
ALTER TABLE "pt_terms_acceptances" ADD COLUMN "legal_hold_until" TIMESTAMPTZ(3);
ALTER TABLE "audit_logs" ADD COLUMN "legal_hold_until" TIMESTAMPTZ(3);

CREATE INDEX "pt_terms_acceptances_ip_retention_idx" ON "pt_terms_acceptances" ("accepted_at")
  WHERE "ip_address" IS NOT NULL OR "user_agent" IS NOT NULL;
CREATE INDEX "audit_logs_ip_retention_idx" ON "audit_logs" ("created_at")
  WHERE "ip_address" IS NOT NULL OR "user_agent" IS NOT NULL;
