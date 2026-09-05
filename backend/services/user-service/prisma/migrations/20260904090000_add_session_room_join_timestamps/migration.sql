-- Open-room online sessions: first-arrival timestamps for each side, used to auto-resolve
-- a session when its scheduled window closes (on-time/late PT, ever-joined client).
ALTER TABLE "sessions" ADD COLUMN "room_pt_joined_at" TIMESTAMP(3);
ALTER TABLE "sessions" ADD COLUMN "room_client_joined_at" TIMESTAMP(3);
