-- CreateTable
CREATE TABLE "inbody_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "weight" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION,
    "bmi" DOUBLE PRECISION,
    "bmr" DOUBLE PRECISION,
    "body_fat" DOUBLE PRECISION NOT NULL,
    "body_fat_pct" DOUBLE PRECISION,
    "muscle_mass" DOUBLE PRECISION NOT NULL,
    "right_arm_muscle" DOUBLE PRECISION,
    "left_arm_muscle" DOUBLE PRECISION,
    "trunk_muscle" DOUBLE PRECISION,
    "right_leg_muscle" DOUBLE PRECISION,
    "left_leg_muscle" DOUBLE PRECISION,
    "right_arm_fat" DOUBLE PRECISION,
    "left_arm_fat" DOUBLE PRECISION,
    "trunk_fat" DOUBLE PRECISION,
    "right_leg_fat" DOUBLE PRECISION,
    "left_leg_fat" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbody_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "unread" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbody_entries_user_id_date_idx" ON "inbody_entries"("user_id", "date");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");
