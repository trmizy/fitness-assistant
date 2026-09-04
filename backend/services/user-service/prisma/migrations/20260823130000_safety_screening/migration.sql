-- Onboarding/Safety redesign: safety screening status + flags on UserProfile.
-- Purely additive, default UNKNOWN for every existing row.
CREATE TYPE "SafetyScreeningStatus" AS ENUM ('UNKNOWN', 'CLEARED', 'FOLLOW_UP_SUGGESTED');

ALTER TABLE "user_profiles" ADD COLUMN     "safety_screening_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "safety_screening_status" "SafetyScreeningStatus" NOT NULL DEFAULT 'UNKNOWN';
