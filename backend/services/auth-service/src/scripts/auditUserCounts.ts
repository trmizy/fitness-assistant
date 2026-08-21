/**
 * Throwaway read-only audit script (Gate 1/2) — distinguishes real users
 * from E2E-test-churn users (email pattern `e2e-*@example.com`, per
 * fitnessassistant-playwright-e2e/fixtures/isolatedTestUser.ts) so the
 * fitness-service workout/nutrition history-volume audit isn't misread as
 * organic production usage.
 * Run inside the auth-service container:
 *   npx tsx src/scripts/auditUserCounts.ts
 */
import { PrismaClient } from "../generated/prisma";

const prisma = new PrismaClient();

async function main() {
  const totalUsers = await prisma.user.count();
  const e2eTestUsers = await prisma.user.count({
    where: { email: { contains: "@example.com" } },
  });
  const e2ePrefixedUsers = await prisma.user.count({
    where: { email: { startsWith: "e2e-" } },
  });
  const sampleNonTestUsers = await prisma.user.findMany({
    where: { NOT: { email: { contains: "@example.com" } } },
    select: { id: true, email: true, createdAt: true },
    take: 10,
    orderBy: { createdAt: "asc" },
  });
  console.log(
    JSON.stringify(
      { totalUsers, e2eTestUsers, e2ePrefixedUsers, sampleNonTestUsers },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
