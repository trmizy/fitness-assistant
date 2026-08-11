import { PrismaClient, DayOfWeek, PTApplicationStatus } from "../src/generated/prisma";

const prisma = new PrismaClient();

const DAY_NAME_NORMALIZE: Record<string, DayOfWeek> = {
  MONDAY: DayOfWeek.MONDAY,
  Monday: DayOfWeek.MONDAY,
  Mon: DayOfWeek.MONDAY,
  TUESDAY: DayOfWeek.TUESDAY,
  Tuesday: DayOfWeek.TUESDAY,
  Tue: DayOfWeek.TUESDAY,
  WEDNESDAY: DayOfWeek.WEDNESDAY,
  Wednesday: DayOfWeek.WEDNESDAY,
  Wed: DayOfWeek.WEDNESDAY,
  THURSDAY: DayOfWeek.THURSDAY,
  Thursday: DayOfWeek.THURSDAY,
  Thu: DayOfWeek.THURSDAY,
  FRIDAY: DayOfWeek.FRIDAY,
  Friday: DayOfWeek.FRIDAY,
  Fri: DayOfWeek.FRIDAY,
  SATURDAY: DayOfWeek.SATURDAY,
  Saturday: DayOfWeek.SATURDAY,
  Sat: DayOfWeek.SATURDAY,
  SUNDAY: DayOfWeek.SUNDAY,
  Sunday: DayOfWeek.SUNDAY,
  Sun: DayOfWeek.SUNDAY,
};

async function main() {
  const apps = await prisma.pTApplication.findMany({
    where: {
      status: {
        in: [
          PTApplicationStatus.DRAFT,
          PTApplicationStatus.SUBMITTED,
          PTApplicationStatus.UNDER_REVIEW,
          PTApplicationStatus.NEEDS_MORE_INFO,
        ],
      },
    },
    include: { userProfile: true },
  });

  let seededCount = 0;
  let alreadyHasCount = 0;
  let noDataCount = 0;

  for (const app of apps) {
    const ptUserId = app.userProfile.userId;

    const existing = await prisma.pTAvailability.findMany({
      where: { ptUserId },
    });

    if (existing.length > 0) {
      alreadyHasCount++;
      continue;
    }

    let blocks: any[] = [];
    if (app.availabilityBlocks) {
      blocks = app.availabilityBlocks as any[];
    } else {
      const days = app.availableDays || [];
      const start = app.availableFrom || "08:00";
      const end = app.availableUntil || "21:00";
      blocks = days.map((day) => ({
        dayOfWeek: day,
        startTime: start,
        endTime: end,
      }));
    }

    const typed = blocks
      .map((b) => {
        const day = DAY_NAME_NORMALIZE[b.dayOfWeek as string];
        if (!day) return null;
        return {
          dayOfWeek: day,
          startTime: b.startTime as string,
          endTime: b.endTime as string,
          ptUserId,
        };
      })
      .filter((b): b is any => b !== null);

    if (typed.length > 0) {
      await prisma.pTAvailability.createMany({
        data: typed,
      });
      seededCount++;
    } else {
      noDataCount++;
    }
  }

  console.log(`Seeded PT availability for ${seededCount} applications.`);
  console.log(`Skipped ${alreadyHasCount} applications that already have availability.`);
  console.log(`Skipped ${noDataCount} applications with no valid availability data.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
