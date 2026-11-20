-- One account = at most one web + one mobile session. Additive and backward compatible: every
-- existing row becomes a "web" session with no session id and not revoked.
ALTER TABLE "refresh_tokens" ADD COLUMN "platform" TEXT NOT NULL DEFAULT 'web';
ALTER TABLE "refresh_tokens" ADD COLUMN "sessionId" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "revokedAt" TIMESTAMP(3);

CREATE INDEX "refresh_tokens_sessionId_idx" ON "refresh_tokens"("sessionId");
CREATE INDEX "refresh_tokens_userId_platform_idx" ON "refresh_tokens"("userId", "platform");
