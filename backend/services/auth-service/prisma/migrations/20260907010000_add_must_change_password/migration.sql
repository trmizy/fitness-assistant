-- Forced password change on first login for admin-created accounts (currently gym owners
-- only). Defaults false so every existing/self-registered user is unaffected.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
