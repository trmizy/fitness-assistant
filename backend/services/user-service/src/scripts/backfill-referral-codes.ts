/**
 * One-off backfill: assign a referral code to every existing PT who is missing one.
 *
 * assignReferralCodeIfMissing (see ../utils/referralCode.ts) only ever runs at approval time
 * (money-flow plan §2.1) — a PT approved BEFORE that wiring went in has isPT=true but
 * referralCode still null, and stays that way forever since nothing else ever calls it.
 * This is that one-time catch-up.
 *
 * Idempotent: assignReferralCodeIfMissing itself is a no-op for a PT who already has a code,
 * so re-running this after a partial failure is safe.
 *
 * Run:
 *   docker exec gymcoach-user-dev npx tsx src/scripts/backfill-referral-codes.ts [--apply]
 *
 * Without --apply it only reports who would get a code.
 */
import { PrismaClient } from "../generated/prisma";
import { assignReferralCodeIfMissing } from "../utils/referralCode";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const missing = await prisma.userProfile.findMany({
    where: { isPT: true, OR: [{ referralCode: null }, { referralCode: "" }] },
    select: { userId: true, firstName: true, lastName: true },
  });

  console.log(`Found ${missing.length} PT(s) missing a referral code.`);
  if (missing.length === 0) return;

  for (const pt of missing) {
    const label = [pt.firstName, pt.lastName].filter(Boolean).join(" ") || pt.userId;
    if (!APPLY) {
      console.log(`  [dry-run] would assign a code to ${label} (${pt.userId})`);
      continue;
    }
    const code = await assignReferralCodeIfMissing(pt.userId);
    console.log(`  assigned ${code} to ${label} (${pt.userId})`);
  }

  if (!APPLY) console.log("\nDry run only — re-run with --apply to actually assign codes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
