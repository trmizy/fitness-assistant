import { PrismaClient } from "../src/generated/prisma";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding auth database...");

  // Create demo users
  const hashedPassword = await bcrypt.hash("password123", 10);

  const john = await prisma.user.upsert({
    where: { email: "john.doe@example.com" },
    update: {},
    create: {
      email: "john.doe@example.com",
      password: hashedPassword,
      firstName: "John",
      lastName: "Doe",
      role: "CUSTOMER",
    },
  });

  const jane = await prisma.user.upsert({
    where: { email: "jane.smith@example.com" },
    update: {},
    create: {
      email: "jane.smith@example.com",
      password: hashedPassword,
      firstName: "Jane",
      lastName: "Smith",
      role: "CUSTOMER",
    },
  });

  const pt = await prisma.user.upsert({
    where: { email: "pt@example.com" },
    update: {},
    create: {
      email: "pt@example.com",
      password: hashedPassword,
      firstName: "Professional",
      lastName: "Trainer",
      role: "PT",
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      password: hashedPassword,
      firstName: "Admin",
      lastName: "User",
      role: "ADMIN",
    },
  });

  // FitnessRoadmap E2E closure phase — a dedicated CUSTOMER account so
  // tests/31-fitness-roadmap.spec.ts no longer shares john.doe@example.com
  // (used by ~30 unrelated specs, whose own real workout/cycle data
  // repeatedly collided with the roadmap flow's own preconditions — see
  // docs/FITNESS_ROADMAP_BROWSER_E2E_REPORT.md Finding 3 and
  // docs/FITNESS_ROADMAP_REPEATABILITY_REPORT.md). Upsert-based, same
  // pattern as every other seed account above — safe to re-run.
  const roadmapClient = await prisma.user.upsert({
    where: { email: "roadmap.client@example.test" },
    update: {},
    create: {
      email: "roadmap.client@example.test",
      password: hashedPassword,
      firstName: "Roadmap",
      lastName: "Client",
      role: "CUSTOMER",
    },
  });

  // Second dedicated account for the Gymini Guided Roadmap Creation E2E
  // pass — needed because tests/31-fitness-roadmap.spec.ts's guided-wizard
  // happy path already consumes roadmapClient's one-time "no roadmap yet"
  // window; the minimal Expert-mode ("Tạo lộ trình nâng cao") check needs
  // its own separate no-roadmap account rather than reusing that window.
  // Same upsert-based pattern, safe to re-run.
  const roadmapClient2 = await prisma.user.upsert({
    where: { email: "roadmap.client2@example.test" },
    update: {},
    create: {
      email: "roadmap.client2@example.test",
      password: hashedPassword,
      firstName: "Roadmap",
      lastName: "Client2",
      role: "CUSTOMER",
    },
  });

  // Third dedicated account — roadmapClient itself already carried a
  // real ACTIVE roadmap left over from an earlier verification phase (no
  // legitimate client-facing way to reset it), so it could not exercise
  // this phase's guided-wizard Save/Start DB-evidence assertions fresh.
  // Same upsert-based pattern.
  const roadmapClient3 = await prisma.user.upsert({
    where: { email: "roadmap.client3@example.test" },
    update: {},
    create: {
      email: "roadmap.client3@example.test",
      password: hashedPassword,
      firstName: "Roadmap",
      lastName: "Client3",
      role: "CUSTOMER",
    },
  });

  // Fourth dedicated account — the Gymini Roadmap Projection & Strategy
  // Report Hardening phase's own fresh "no roadmap yet" happy path
  // (K-group rendering, phase forecast cards, Save->reopen richness).
  // roadmapClient3 already carries a real ACTIVE roadmap from the prior
  // phase's own live verification run.
  const roadmapClient4 = await prisma.user.upsert({
    where: { email: "roadmap.client4@example.test" },
    update: {},
    create: {
      email: "roadmap.client4@example.test",
      password: hashedPassword,
      firstName: "Roadmap",
      lastName: "Client4",
      role: "CUSTOMER",
    },
  });

  // Gymini Final Cross-System Fitness Journey Integration phase — a
  // dedicated, never-touched-by-any-other-spec account. The main E2E
  // (tests/32-cross-system-fitness-journey.spec.ts) drives this single
  // user through the ENTIRE journey (onboarding -> roadmap -> workout ->
  // nutrition -> cycle complete -> assessment -> advance), so it must
  // start with zero pre-existing profile/InBody/roadmap/workout state —
  // none of the roadmapClient* accounts qualify, they all carry leftover
  // state from prior phases' own verification runs.
  const crossSystemClient = await prisma.user.upsert({
    where: { email: "cross.system.client@example.test" },
    update: {},
    create: {
      email: "cross.system.client@example.test",
      password: hashedPassword,
      firstName: "CrossSystem",
      lastName: "Client",
      role: "CUSTOMER",
    },
  });

  // Gymini Adaptive Cycle Transition Continuity phase — dedicated account
  // for tests/32-cross-system-fitness-journey.spec.ts's TC-XSYS-006.
  // Needs a TEST-FIXTURE-prepared completed-cycle/assessment/advance
  // state (a real 28-day-old cycle can't be produced live in one
  // session — see docs/GYMINI_CYCLE_TRANSITION_CONTINUITY_DESIGN.md),
  // so it must never be shared with crossSystemClient (whose own state
  // is browser-driven from a fresh account and would conflict).
  const cycleTransitionClient = await prisma.user.upsert({
    where: { email: "cycle.transition.client@example.test" },
    update: {},
    create: {
      email: "cycle.transition.client@example.test",
      password: hashedPassword,
      firstName: "CycleTransition",
      lastName: "Client",
      role: "CUSTOMER",
    },
  });

  // Gymini PT Coaching Workspace phase — dedicated PT + two clients, never
  // touched by any other spec, so a real, legitimate ACTIVE PT-client
  // Contract can be established (and re-established on repeat runs)
  // without colliding with pt@example.com's other real relationships from
  // ~10 other specs (05-pt-contract-payment.spec.ts, 31-fitness-roadmap's
  // PT-authorization checks, etc.).
  const ptCoachingPt = await prisma.user.upsert({
    where: { email: "pt.coaching.workspace@example.test" },
    update: {},
    create: {
      email: "pt.coaching.workspace@example.test",
      password: hashedPassword,
      firstName: "Coaching",
      lastName: "PT",
      role: "PT",
    },
  });
  const ptCoachingClientA = await prisma.user.upsert({
    where: { email: "pt.coaching.clientA@example.test" },
    update: {},
    create: {
      email: "pt.coaching.clientA@example.test",
      password: hashedPassword,
      firstName: "ClientA",
      lastName: "Coaching",
      role: "CUSTOMER",
    },
  });
  const ptCoachingClientB = await prisma.user.upsert({
    where: { email: "pt.coaching.clientB@example.test" },
    update: {},
    create: {
      email: "pt.coaching.clientB@example.test",
      password: hashedPassword,
      firstName: "ClientB",
      lastName: "Unrelated",
      role: "CUSTOMER",
    },
  });

  console.log("✅ Created users:", {
    john: john.id,
    jane: jane.id,
    pt: pt.id,
    crossSystemClient: crossSystemClient.id,
    cycleTransitionClient: cycleTransitionClient.id,
    ptCoachingPt: ptCoachingPt.id,
    ptCoachingClientA: ptCoachingClientA.id,
    ptCoachingClientB: ptCoachingClientB.id,
    admin: admin.id,
    roadmapClient: roadmapClient.id,
    roadmapClient2: roadmapClient2.id,
    roadmapClient3: roadmapClient3.id,
    roadmapClient4: roadmapClient4.id,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
