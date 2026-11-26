/**
 * Recommended PT order ("Đề xuất cho bạn") interleaves NEW trainers (approved within 30 days) with established ones:
 * positions 1-4 established, position 5 new, repeating; either stream fills in when the other runs out.
 *
 * Evidence label: BACKEND INTEGRATION (real user-service Express app + real PostgreSQL *_test DB; auth identity = TEST FIXTURE token).
 * All rows are TEST FIXTURE rows tagged with a per-run prefix and a unique name token, so every query below filters on that
 * token (`q`) and never depends on whatever else sits in the test DB.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { buildDiscoveryStatsEpoch } from "../services/pt-discovery-stats.service";
import { findDiscoveryPtPageIds, searchDiscoveryPtPageIds } from "../services/pt-discovery.query";
import { NEW_TRAINER_SLOT_EVERY, NEW_TRAINER_WINDOW_DAYS, isNewTrainerApprovedAt } from "../services/pt-new-trainer";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";

const DAY = 86_400_000;
const tag = randomUUID().replace(/-/g, "").slice(0, 6);
const prefix = `ilv_${tag}_`;
const viewerId = `${prefix}viewer`;
const suiteStartedAt = new Date();

const EST_ACC = 40; // established, accepting
const NEW_ACC = 10; // new, accepting
const EST_OFF = 3; // established, NOT accepting
const NEW_OFF = 2; // new, NOT accepting
const specAll = `SPALL${tag}`;
const specEstOnly = `SPEST${tag}`;
const specNewOnly = `SPNEW${tag}`;
const specMixed = `SPMIX${tag}`;

type Pt = {
  userId: string;
  firstName: string;
  accepting: boolean;
  isNew: boolean;
  approvedAt: Date;
  specialties: string[];
  price: number;
};

const pts: Pt[] = [];
let app: App;
let viewerToken: string;
let nowAtBuild = Date.now();

function addPt(key: string, o: { accepting: boolean; ageDays: number; specialties: string[]; price: number; bio?: boolean }) {
  const approvedAt = new Date(nowAtBuild - o.ageDays * DAY);
  const pt: Pt = {
    userId: `${prefix}${key}`,
    firstName: `${tag}pt${key}`,
    accepting: o.accepting,
    isNew: isNewTrainerApprovedAt(approvedAt, new Date(nowAtBuild)),
    approvedAt,
    specialties: o.specialties,
    price: o.price,
  };
  pts.push(pt);
  return { pt, bio: o.bio ?? false };
}

const bioFlags = new Map<string, boolean>();

function buildDataset() {
  nowAtBuild = Date.now();
  let price = 100_000;
  const nextPrice = () => (price += 10_000);
  // Price order is interleaved across the two streams on purpose: if the interleave leaked into priceAsc it would show.
  const plan: Array<{ key: string; accepting: boolean; ageDays: number; spec: string[] }> = [];
  for (let i = 0; i < EST_ACC; i++) {
    plan.push({ key: `ea${String(i).padStart(2, "0")}`, accepting: true, ageDays: 31 + i * 3, spec: [specAll, specEstOnly, ...(i < 20 ? [specMixed] : [])] });
  }
  for (let i = 0; i < NEW_ACC; i++) {
    // 0.5 .. 28 days: all new. Mixed specialty on the first 5 so the combined filter has 20 est + 5 new.
    plan.push({ key: `na${String(i).padStart(2, "0")}`, accepting: true, ageDays: 0.5 + i * 3, spec: [specAll, specNewOnly, ...(i < 5 ? [specMixed] : [])] });
  }
  for (let i = 0; i < EST_OFF; i++) plan.push({ key: `eo${i}`, accepting: false, ageDays: 40 + i, spec: [specAll, specEstOnly] });
  for (let i = 0; i < NEW_OFF; i++) plan.push({ key: `no${i}`, accepting: false, ageDays: 2 + i, spec: [specAll, specNewOnly] });
  // Shuffle-ish price assignment by a fixed permutation so est/new prices alternate.
  const order = plan.map((_, i) => i).sort((a, b) => ((a * 37) % 101) - ((b * 37) % 101));
  const priceByKey = new Map<string, number>();
  for (const i of order) priceByKey.set(plan[i].key, nextPrice());
  plan.forEach((p, i) => {
    const { bio } = addPt(p.key, { accepting: p.accepting, ageDays: p.ageDays, specialties: p.spec, price: priceByKey.get(p.key)!, bio: i % 2 === 0 });
    bioFlags.set(`${prefix}${p.key}`, bio);
  });
}

async function cleanup() {
  await prisma.ptDiscoveryEpoch.deleteMany({ where: { createdAt: { gte: suiteStartedAt } } }).catch(() => {});
  await prisma.pTServicePackage.deleteMany({ where: { ptUserId: { startsWith: prefix } } });
  await prisma.pTApplication.deleteMany({ where: { id: { startsWith: prefix } } });
  await prisma.userProfile.deleteMany({ where: { userId: { startsWith: prefix } } });
}

async function insertPt(pt: Pt, bio: boolean) {
  await prisma.userProfile.create({
    data: {
      id: `${prefix}p_${pt.userId.slice(prefix.length)}`,
      userId: pt.userId,
      email: `${pt.userId}@interleave.test.local`,
      firstName: pt.firstName,
      lastName: "Coach",
      firstNameNormalized: pt.firstName.toLowerCase(),
      lastNameNormalized: "coach",
      isPT: true,
      isAcceptingClients: pt.accepting,
      specialties: pt.specialties,
    },
  });
  await prisma.pTApplication.create({
    data: {
      id: `${prefix}a_${pt.userId.slice(prefix.length)}`,
      userProfileId: `${prefix}p_${pt.userId.slice(prefix.length)}`,
      status: "APPROVED",
      serviceMode: "ONLINE",
      approvedAt: pt.approvedAt,
      professionalBio: bio ? "x".repeat(60) : null,
    },
  });
  await prisma.pTServicePackage.create({
    data: {
      id: `${prefix}k_${pt.userId.slice(prefix.length)}`,
      ptUserId: pt.userId,
      name: "Gói ONLINE",
      sessionCount: 1,
      price: pt.price,
      sessionMode: "ONLINE",
      sessionDurationMinutes: 60,
      isActive: true,
    },
  });
}

test.before(async () => {
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.PT_DISCOVERY_CURSOR_SECRET = process.env.PT_DISCOVERY_CURSOR_SECRET || "interleave-test-cursor-secret-32ch!";
  await cleanup();
  buildDataset();
  await prisma.userProfile.create({ data: { id: `${prefix}viewer_p`, userId: viewerId, email: `${viewerId}@interleave.test.local` } });
  for (const pt of pts) await insertPt(pt, bioFlags.get(pt.userId)!);
  // Build a READY epoch (stats for every PT, including the other fixtures in this DB).
  const built = await buildDiscoveryStatsEpoch();
  assert.equal(built.built, true);
  app = await startApp();
  viewerToken = tokenFor(viewerId, "CUSTOMER");
});

test.after(async () => {
  if (app) await app.close();
  await cleanup();
});

async function qualityMap(): Promise<Map<string, number>> {
  const cur = await prisma.ptDiscoveryEpoch.findFirstOrThrow({ where: { isCurrent: true, status: "READY" } });
  const rows = await prisma.ptDiscoveryStat.findMany({ where: { epoch: cur.epoch, ptUserId: { startsWith: prefix } } });
  return new Map(rows.map((r) => [r.ptUserId, r.quality]));
}

/** Independent reference: accepting first; inside, 4 established then 1 new, repeat; a dry stream is filled from the other. */
function referenceOrder(list: Pt[], quality: Map<string, number>): Pt[] {
  const byStream = (a: Pt, b: Pt) => (quality.get(b.userId) ?? -1) - (quality.get(a.userId) ?? -1) || (a.userId < b.userId ? -1 : 1);
  const out: Pt[] = [];
  for (const accepting of [true, false]) {
    const g = list.filter((p) => p.accepting === accepting);
    const est = g.filter((p) => !p.isNew).sort(byStream);
    const neu = g.filter((p) => p.isNew).sort(byStream);
    let e = 0;
    let n = 0;
    while (e < est.length || n < neu.length) {
      for (let k = 0; k < NEW_TRAINER_SLOT_EVERY - 1; k++) {
        if (e < est.length) out.push(est[e++]);
        else if (n < neu.length) out.push(neu[n++]);
      }
      if (n < neu.length) out.push(neu[n++]);
      else if (e < est.length) out.push(est[e++]);
    }
  }
  return out;
}

async function walkSearch(input: Record<string, unknown>, limit: number): Promise<{ ids: string[]; flags: boolean[]; pages: number }> {
  const ids: string[] = [];
  const flags: boolean[] = [];
  let cursor: string | undefined;
  let pages = 0;
  for (;;) {
    const r = await searchDiscoveryPtPageIds({ q: tag, mode: "ANY", limit, cursor, ...input } as any);
    pages++;
    for (const it of r.items) {
      ids.push(it.userId);
      flags.push(it.isNewTrainer);
    }
    if (!r.hasMore) break;
    assert.ok(r.nextCursor, "hasMore implies a cursor");
    cursor = r.nextCursor!;
    assert.ok(pages < 200, "pagination terminates");
  }
  return { ids, flags, pages };
}

test("1. 30-day rule: constant is 30, boundary 29d23h is new, 30d+1h is established", () => {
  assert.equal(NEW_TRAINER_WINDOW_DAYS, 30);
  assert.equal(NEW_TRAINER_SLOT_EVERY, 5);
  const now = new Date("2026-11-26T12:00:00.000Z");
  assert.equal(isNewTrainerApprovedAt(new Date(now.getTime() - (30 * DAY - 3_600_000)), now), true);
  assert.equal(isNewTrainerApprovedAt(new Date(now.getTime() - (30 * DAY + 3_600_000)), now), false);
  assert.equal(isNewTrainerApprovedAt(new Date(now.getTime() - 30 * DAY), now), false, "exactly 30 days is established");
  assert.equal(isNewTrainerApprovedAt(null, now), false);
  assert.equal(isNewTrainerApprovedAt(now, now), true);
});

test("2. default search: exact 4+1 pattern, accepting block first, equals independent reference (page size 7, not a multiple of 5)", async () => {
  const q = await qualityMap();
  const expected = referenceOrder(pts, q);
  const { ids, flags, pages } = await walkSearch({}, 7);
  assert.equal(new Set(ids).size, ids.length, "no duplicates across pages");
  assert.equal(ids.length, pts.length, "no gaps: every visible PT appears exactly once");
  assert.deepEqual(ids, expected.map((p) => p.userId));
  assert.ok(pages >= 8, `paged over several pages (${pages})`);

  // The pattern itself, read off the flags of the accepting block (50 PTs = 10 x (4 established + 1 new)).
  const acceptingCount = EST_ACC + NEW_ACC;
  for (let i = 0; i < acceptingCount; i++) {
    assert.equal(flags[i], (i + 1) % NEW_TRAINER_SLOT_EVERY === 0, `position ${i + 1}: new only at every ${NEW_TRAINER_SLOT_EVERY}th`);
  }
  // Non-accepting block starts after every accepting PT (is_accepting_clients still dominates).
  const acceptingSet = new Set(pts.filter((p) => p.accepting).map((p) => p.userId));
  assert.ok(ids.slice(0, acceptingCount).every((id) => acceptingSet.has(id)));
  assert.ok(ids.slice(acceptingCount).every((id) => !acceptingSet.has(id)));
});

test("3. page size sweep (1, 4, 5, 6, 11, 50): same order, no duplicates, no gaps", async () => {
  const baseline = (await walkSearch({}, 50)).ids;
  for (const size of [1, 4, 5, 6, 11]) {
    const { ids } = await walkSearch({}, size);
    assert.deepEqual(ids, baseline, `page size ${size} yields the identical order`);
  }
});

test("4. stream exhaustion: only-new filter, only-established filter, and a mixed filter keep the pattern", async () => {
  const q = await qualityMap();
  for (const [spec, label] of [
    [specNewOnly, "new stream only"],
    [specEstOnly, "established stream only"],
    [specMixed, "20 established + 5 new (filters combined with interleave)"],
  ] as const) {
    const subset = pts.filter((p) => p.specialties.includes(spec));
    const expected = referenceOrder(subset, q).map((p) => p.userId);
    const { ids } = await walkSearch({ specialties: [spec] }, 6);
    assert.deepEqual(ids, expected, label);
    assert.equal(new Set(ids).size, subset.length, `${label}: filter applied exactly (no extra, no missing)`);
  }
  // Mixed: 20 est + 5 new accepting => positions 5,10,15,20,25 are new.
  const mixed = await walkSearch({ specialties: [specMixed] }, 25);
  assert.deepEqual(
    mixed.flags.map((f, i) => (f ? i + 1 : 0)).filter(Boolean),
    [5, 10, 15, 20, 25],
  );
  // A new stream larger than the established one: after established runs dry the remaining new fill in (no gap).
  const onlyNewAndFew = pts.filter((p) => p.specialties.includes(specNewOnly)).length;
  assert.equal((await walkSearch({ specialties: [specNewOnly] }, 3)).ids.length, onlyNewAndFew);
});

test("5. price filter + online mode + interleave: members equal the filtered set", async () => {
  const sorted = [...pts].map((p) => p.price).sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const subset = pts.filter((p) => p.price >= mid);
  const { ids } = await walkSearch({ minPrice: mid, mode: "ONLINE" }, 9);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(new Set(ids), new Set(subset.map((p) => p.userId)));
  assert.deepEqual(ids, referenceOrder(subset, await qualityMap()).map((p) => p.userId));
});

test("6. GET /profile/pts (offset pagination) uses the same interleave: equals reference, no duplicates", async () => {
  const q = await qualityMap();
  const expected = referenceOrder(pts, q).map((p) => p.userId);
  const got: string[] = [];
  for (let page = 1; page < 50; page++) {
    const r = await findDiscoveryPtPageIds({ q: tag, page, limit: 8 });
    got.push(...r.userIds);
    if (!r.hasMore) break;
  }
  assert.equal(new Set(got).size, got.length);
  // GET breaks quality ties by createdAt DESC, search by userId: compare membership exactly and order through the pattern + accepting groups.
  assert.deepEqual(new Set(got), new Set(expected));
  const isNewById = new Map(pts.map((p) => [p.userId, p.isNew]));
  for (let i = 0; i < EST_ACC + NEW_ACC; i++) {
    assert.equal(isNewById.get(got[i]), (i + 1) % NEW_TRAINER_SLOT_EVERY === 0, `GET position ${i + 1}`);
  }
});

test("7. other sorts unchanged: nameAsc and priceAsc ignore newness entirely", async () => {
  const byName = [...pts].sort((a, b) => (a.firstName < b.firstName ? -1 : a.firstName > b.firstName ? 1 : a.userId < b.userId ? -1 : 1));
  assert.deepEqual((await walkSearch({ sortBy: "nameAsc" }, 8)).ids, byName.map((p) => p.userId));
  const byPrice = [...pts].sort((a, b) => a.price - b.price || (a.userId < b.userId ? -1 : 1));
  assert.deepEqual((await walkSearch({ sortBy: "priceAsc" }, 8)).ids, byPrice.map((p) => p.userId));
  const getByPrice: string[] = [];
  for (let page = 1; page < 50; page++) {
    const r = await findDiscoveryPtPageIds({ q: tag, sortBy: "priceAsc", page, limit: 8 });
    getByPrice.push(...r.userIds);
    if (!r.hasMore) break;
  }
  assert.deepEqual(getByPrice, byPrice.map((p) => p.userId));
});

test("8. isNewTrainer is additive on POST /profile/pts/search and GET /profile/pts/:id, unreviewed new PTs keep ratingCount 0 / no rating", async () => {
  const r = await app.call("POST", "/profile/pts/search", viewerToken, { q: tag, limit: 50 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const byId = new Map<string, any>((r.body.pts as any[]).map((p) => [p.userId, p]));
  assert.equal(byId.size, 50);
  for (const p of pts.filter((x) => byId.has(x.userId))) {
    assert.equal(byId.get(p.userId).isNewTrainer, p.isNew, p.userId);
    assert.equal(byId.get(p.userId).ratingCount, 0);
    assert.equal(byId.get(p.userId).avgRating, null);
    assert.equal("approvedAt" in byId.get(p.userId), false, "the approval date itself is not exposed");
  }
  const firstNew = pts.find((p) => p.isNew)!;
  const firstEst = pts.find((p) => !p.isNew)!;
  const d1 = await app.call("GET", `/profile/pts/${firstNew.userId}`, viewerToken);
  const d2 = await app.call("GET", `/profile/pts/${firstEst.userId}`, viewerToken);
  assert.equal(d1.status, 200);
  assert.equal(d1.body.isNewTrainer, true);
  assert.equal(d2.body.isNewTrainer, false);
  const g = await app.call("GET", `/profile/pts?q=${tag}&limit=50`, viewerToken);
  assert.equal(g.status, 200);
  for (const p of g.body.pts as any[]) assert.equal(p.isNewTrainer, pts.find((x) => x.userId === p.userId)!.isNew);
});

test("9. HTTP cursor round trip over the interleaved default: no overlap, same set, stale cursor without rank is CURSOR_EXPIRED", async () => {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 100; i++) {
    const r = await app.call("POST", "/profile/pts/search", viewerToken, { q: tag, limit: 7, ...(cursor ? { cursor } : {}) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    for (const p of r.body.pts) ids.push(p.userId);
    if (!r.body.hasMore) break;
    cursor = r.body.nextCursor;
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, pts.length);

  // A cursor minted by the previous (pre-interleave) build carries no rank: must ask the client to reload, not mis-page.
  const { encodeDiscoveryCursor, decodeDiscoveryCursor } = await import("../services/pt-discovery-cursor");
  const first = await app.call("POST", "/profile/pts/search", viewerToken, { q: tag, limit: 7 });
  const decoded = decodeDiscoveryCursor(first.body.nextCursor);
  const { rank: _rank, newCutoff: _cut, ...legacy } = decoded;
  const stale = await app.call("POST", "/profile/pts/search", viewerToken, { q: tag, limit: 7, cursor: encodeDiscoveryCursor(legacy as any) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "CURSOR_EXPIRED");
});

test("10. frozen cutoff: a PT that crosses the 30-day line DURING pagination does not hop streams (no duplicate, no gap)", async () => {
  // Approved 30 days minus ~5 s ago: new now, established 5 s later.
  const edge = addPt("edge", { accepting: true, ageDays: 0, specialties: [specAll, specNewOnly], price: 999_000, bio: false });
  edge.pt.approvedAt = new Date(Date.now() - NEW_TRAINER_WINDOW_DAYS * DAY + 5_000);
  edge.pt.isNew = true;
  await insertPt(edge.pt, false);
  try {
    const first = await searchDiscoveryPtPageIds({ q: tag, mode: "ANY", limit: 7 });
    assert.ok(first.nextCursor);
    await new Promise((r) => setTimeout(r, 6_000));
    // Without the frozen cutoff the edge PT would now rank in the established stream and shift every later position.
    const ids = first.items.map((i) => i.userId);
    let cursor: string | undefined = first.nextCursor!;
    for (let i = 0; i < 100 && cursor; i++) {
      const r = await searchDiscoveryPtPageIds({ q: tag, mode: "ANY", limit: 7, cursor });
      ids.push(...r.items.map((it) => it.userId));
      cursor = r.hasMore ? r.nextCursor! : undefined;
    }
    assert.equal(new Set(ids).size, ids.length, "no duplicates");
    assert.equal(ids.length, pts.length, "no gaps");
    // The edge PT has no row in the epoch built before it existed (quality NULL = last of its stream); frozen => still in the new stream.
    const q = await qualityMap();
    const expected = referenceOrder(pts, q).map((p) => p.userId);
    assert.deepEqual(ids, expected);
    // A fresh first page, ranked with a fresh cutoff, now treats it as established.
    const fresh = await walkSearch({}, 50);
    assert.equal(fresh.flags[fresh.ids.indexOf(edge.pt.userId)], false);
  } finally {
    pts.splice(pts.indexOf(edge.pt), 1);
  }
});
