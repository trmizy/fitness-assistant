-- Vietnamese exercise guidance from a reviewable source (additive: new table only; exercises.id / exercise_name / instructions are untouched).
CREATE TABLE "exercise_guidance" (
    "id" TEXT NOT NULL,
    "exercise_id" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'vi',
    "name_vi" TEXT,
    "instructions_vi" TEXT,
    "common_mistakes_vi" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "safety_notes_vi" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "verification" TEXT NOT NULL DEFAULT 'CURATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exercise_guidance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exercise_guidance_exercise_id_language_key" ON "exercise_guidance"("exercise_id", "language");
CREATE INDEX "exercise_guidance_verification_idx" ON "exercise_guidance"("verification");

ALTER TABLE "exercise_guidance" ADD CONSTRAINT "exercise_guidance_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercises"("id") ON DELETE CASCADE ON UPDATE CASCADE;
