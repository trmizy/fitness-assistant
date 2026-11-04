/**
 * E2E_DISPUTE fixture, gym-service side. Copied to /app/backend/services/gym-service/ and run INSIDE the e2e gym-service container with that service's own
 * Prisma client; refuses unless DATABASE_URL names gymini_gym_e2e. Evidence label of everything written here: TEST FIXTURE
 * (partner + owner account + brand + gym + plan + an ACTIVE membership for the client + one MEMBER_REPORT billing complaint filed by that member).
 * The Case itself (POST /admin/complaints/:id/case ...) is opened afterwards through the real gateway/HTTP path.
 * Input env: E2E_CLIENT_ID, E2E_OWNER_ID.   Output: one JSON line "FIXTURE_JSON {...}".   Idempotent (reuses by name).
 */
import { PrismaClient } from "./src/generated/prisma";

const DAY = 86_400_000;
const GYM_NAME = "E2E_DISPUTE Gym";

async function main() {
  if (!/\/gymini_gym_e2e(\?|$)/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing: DATABASE_URL is not the gymini_gym_e2e database");
  const { E2E_CLIENT_ID: clientId, E2E_OWNER_ID: ownerId } = process.env;
  if (!clientId || !ownerId) throw new Error("E2E_CLIENT_ID / E2E_OWNER_ID required");
  const db = new PrismaClient();
  try {
    let gym = await db.gym.findFirst({ where: { name: GYM_NAME, ownerId } });
    if (!gym) {
      const partner = await db.gymPartner.create({ data: { legalName: "E2E_DISPUTE Partner", status: "ACTIVE", verificationStatus: "VERIFIED" } });
      await db.gymPartnerAccount.create({ data: { partnerId: partner.id, userId: ownerId, role: "OWNER", scopedGymIds: [], status: "ACTIVE", activatedAt: new Date(), onboardingCompletedAt: new Date() } });
      const brand = await db.gymBrand.create({ data: { ownerId, name: "E2E_DISPUTE Brand", approvedName: "E2E_DISPUTE Brand" } });
      await db.gymPartner.update({ where: { id: partner.id }, data: { brandId: brand.id } });
      gym = await db.gym.create({ data: { ownerId, brandId: brand.id, name: GYM_NAME, address: "1 E2E Street", status: "APPROVED", operationalStatus: "OPEN", approvedName: GYM_NAME, approvedAddress: "1 E2E Street" } });
    }
    let membership = await db.gymMembershipContract.findFirst({ where: { gymId: gym.id, clientId } });
    if (!membership) {
      const plan = await db.gymMembershipPlan.create({ data: { brandId: gym.brandId!, name: "E2E_DISPUTE Plan", price: 300_000, durationDays: 30 } });
      membership = await db.gymMembershipContract.create({
        data: { gymId: gym.id, planId: plan.id, clientId, priceAtPurchase: 300_000, durationDaysSnapshot: 30, status: "ACTIVE", startDate: new Date(Date.now() - 5 * DAY), endDate: new Date(Date.now() + 25 * DAY), paymentTxnId: "e2e-dispute-fixture-txn" },
      });
    }
    let complaint = await db.gymComplaint.findFirst({ where: { gymId: gym.id, reporterUserId: clientId } });
    if (!complaint) {
      complaint = await db.gymComplaint.create({
        data: { gymId: gym.id, partnerId: null, source: "MEMBER_REPORT", issueType: "BILLING", reporterUserId: clientId, description: "E2E_DISPUTE: tôi bị trừ phí gói tập hai lần", photoTokens: [] },
      });
    }
    console.log("FIXTURE_JSON " + JSON.stringify({ gymId: gym.id, membershipId: membership.id, complaintId: complaint.id }));
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
