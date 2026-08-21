/**
 * One-off migration: turn each approved trainer's PTApplication pricing into PTServicePackage
 * rows (Phase 1, "Di trú dữ liệu").
 *
 * Before PTServicePackage existed, a trainer's prices lived in eight scattered numeric columns
 * on their application, fixed at submission time. This moves them onto the new model so nobody
 * who was already selling silently loses every package — a trainer with zero packages vanishes
 * from the buying flow entirely.
 *
 * Idempotent: a trainer who already has a non-archived package is skipped, so re-running after
 * a partial failure is safe.
 *
 * Run:
 *   docker exec gymcoach-user-dev npx tsx src/scripts/migrate-pt-service-packages.ts [--apply]
 *
 * Without --apply it only reports what it would do.
 */
import { PrismaClient, SessionMode } from "../generated/prisma";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface Planned {
  ptUserId: string;
  name: string;
  sessionCount: number;
  price: number;
  sessionMode: SessionMode;
}

/** Trainers who could not be given a package, and why — the task requires reporting these. */
const skipped: { ptUserId: string; reason: string }[] = [];

function plan(profile: any): Planned[] {
  const app = profile.ptApplication;
  const out: Planned[] = [];
  if (!app) {
    skipped.push({ ptUserId: profile.userId, reason: "không có hồ sơ PTApplication" });
    return out;
  }

  const sessions = Number(app.sessionsPerPackage ?? 0) || 10;
  const mk = (price: unknown, mode: SessionMode): void => {
    const p = Number(price ?? 0);
    if (!(p > 0)) return;
    out.push({
      ptUserId: profile.userId,
      name: `Gói ${sessions} buổi`,
      sessionCount: sessions,
      price: p,
      sessionMode: mode,
    });
  };

  mk(app.offlinePackagePrice, "OFFLINE");
  mk(app.onlinePackagePrice, "ONLINE");

  // Falls back to the single legacy packagePrice, using whichever mode the trainer offers.
  if (out.length === 0) {
    const fallbackMode: SessionMode = app.serviceMode === "ONLINE" ? "ONLINE" : "OFFLINE";
    mk(app.packagePrice, fallbackMode);
  }

  if (out.length === 0) {
    skipped.push({
      ptUserId: profile.userId,
      reason: "hồ sơ không có giá gói nào (offline/online/packagePrice đều rỗng hoặc 0)",
    });
  }
  return out;
}

async function main() {
  const approved = await prisma.userProfile.findMany({
    where: { isPT: true, ptSuspended: false },
    include: { ptApplication: true, servicePackages: { where: { archivedAt: null } } },
  });

  console.log(`Tìm thấy ${approved.length} PT đang hoạt động.`);

  let created = 0;
  let alreadyHad = 0;

  for (const profile of approved as any[]) {
    if (profile.servicePackages?.length > 0) {
      alreadyHad++;
      continue;
    }
    const planned = plan(profile);
    for (const p of planned) {
      if (APPLY) {
        await prisma.pTServicePackage.create({
          data: {
            ptUserId: p.ptUserId,
            name: p.name,
            sessionCount: p.sessionCount,
            price: p.price,
            sessionMode: p.sessionMode,
            sessionDurationMinutes: 60,
            isActive: true,
          },
        });
      }
      created++;
      console.log(
        `  ${APPLY ? "TẠO" : "sẽ tạo"}: ${p.ptUserId.slice(0, 8)} — ${p.name} · ${p.price} · ${p.sessionMode}`,
      );
    }
  }

  console.log("\n── Kết quả ──");
  console.log(`  PT đã có gói, bỏ qua : ${alreadyHad}`);
  console.log(`  Gói ${APPLY ? "đã tạo" : "sẽ tạo"}       : ${created}`);
  console.log(`  PT không sinh được   : ${skipped.length}`);
  for (const s of skipped) {
    console.log(`    ⚠ ${s.ptUserId.slice(0, 8)} — ${s.reason}`);
  }
  if (!APPLY) console.log("\n(chạy thử — thêm --apply để ghi thật)");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
