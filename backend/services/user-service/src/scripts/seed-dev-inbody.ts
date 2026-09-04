import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1]?.trim();
  return undefined;
}

function startOfUtcDay(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

async function main() {
  const userId = readArg("user-id") || process.env.DEV_EVIDENCE_USER_ID;
  const email =
    readArg("email") ||
    process.env.DEV_EVIDENCE_USER_EMAIL ||
    "user@example.com";

  if (!userId) {
    throw new Error(
      "Missing --user-id. Example: pnpm exec tsx src/scripts/seed-dev-inbody.ts --user-id <auth-user-id>",
    );
  }

  const date = startOfUtcDay();
  const measuredAt = new Date();
  const bodyFatKg = Math.round(85 * 0.273 * 10) / 10;

  const profile = await prisma.userProfile.upsert({
    where: { userId },
    update: {
      email,
      age: 21,
      gender: "MALE",
      heightCm: 173,
      goal: "WEIGHT_LOSS",
      activityLevel: "LIGHTLY_ACTIVE",
      experienceLevel: "BEGINNER",
      currentWeight: 85,
      availableEquipment: ["barbell", "dumbbells", "machines", "cable"],
      injuries: [],
      updatedAt: new Date(),
    },
    create: {
      userId,
      email,
      age: 21,
      gender: "MALE",
      heightCm: 173,
      goal: "WEIGHT_LOSS",
      activityLevel: "LIGHTLY_ACTIVE",
      experienceLevel: "BEGINNER",
      preferredTrainingDays: [1, 3, 5, 0],
      availableEquipment: ["barbell", "dumbbells", "machines", "cable"],
      injuries: [],
      currentWeight: 85,
    },
  });

  const inBody = await prisma.inBodyEntry.upsert({
    where: {
      inbody_entries_user_id_date_only_key: {
        userId,
        dateOnly: date,
      },
    },
    create: {
      userId,
      date: measuredAt,
      dateOnly: date,
      weight: 85,
      height: 173,
      bmi: 28.4,
      bodyFat: bodyFatKg,
      bodyFatPct: 27.3,
      muscleMass: 35,
      status: "manual",
      notes: "Dev-only seed for AI Plan evidence demo. Waist: 90 cm.",
    },
    update: {
      date: measuredAt,
      weight: 85,
      height: 173,
      bmi: 28.4,
      bodyFat: bodyFatKg,
      bodyFatPct: 27.3,
      muscleMass: 35,
      status: "manual",
      notes: "Dev-only seed for AI Plan evidence demo. Waist: 90 cm.",
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        userId,
        profile: {
          id: profile.id,
          goal: profile.goal,
          experienceLevel: profile.experienceLevel,
          heightCm: profile.heightCm,
          currentWeight: profile.currentWeight,
        },
        inBody: {
          id: inBody.id,
          dateOnly: inBody.dateOnly.toISOString().slice(0, 10),
          weight: inBody.weight,
          height: inBody.height,
          bmi: inBody.bmi,
          bodyFatPct: inBody.bodyFatPct,
          muscleMass: inBody.muscleMass,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
