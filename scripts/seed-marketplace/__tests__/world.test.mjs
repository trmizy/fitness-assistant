import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildWorld, summarize } from "../lib/world/index.mjs";
import { BLOCKED_NAME_PATTERNS, isNaturalName } from "../lib/names.mjs";
import { assetPath, manifest } from "../lib/world/assets.mjs";
import { areas } from "../lib/geo.mjs";
import { isSeedEmail } from "../lib/util.mjs";

const world = buildWorld();
const s = summarize(world);
const branches = world.owners.flatMap((o) => o.branches);

test("deterministic: two builds are identical", () => {
  const again = buildWorld();
  assert.equal(JSON.stringify(again.owners), JSON.stringify(world.owners));
  assert.equal(JSON.stringify(again.pts), JSON.stringify(world.pts));
  assert.equal(JSON.stringify(again.clients.map((c) => [c.profile, c.inbody])), JSON.stringify(world.clients.map((c) => [c.profile, c.inbody])));
});

test("scale: ~1000 clients, 80 PTs, 25 owners, 80 branches", () => {
  assert.equal(s.clients, 1000);
  assert.equal(s.pts, 80);
  assert.equal(s.owners, 25);
  assert.equal(s.branches, 80);
});

test("names are natural and unique; no placeholder patterns", () => {
  const all = [...world.clients, ...world.pts, ...world.owners].map((x) => x.person.full);
  assert.equal(new Set(all).size, all.length, "full names unique");
  for (const n of all) assert.ok(isNaturalName(n), n);
  for (const n of all) for (const re of BLOCKED_NAME_PATTERNS) assert.ok(!re.test(n), `${n} matches ${re}`);
  assert.ok(!all.some((n) => /^Nguyễn Văn [A-Z]$/.test(n)));
  assert.ok(all.includes("Phạm Thu Uyên") && all.includes("Trần Minh Khoa") && all.includes("Nguyễn Trường Thành"));
});

test("emails: <slug>@seed.gymini.test, unique, ASCII", () => {
  const emails = [...world.clients.map((c) => c.profile.email), ...world.pts.map((p) => p.email), ...world.owners.map((o) => o.email)];
  assert.equal(new Set(emails).size, emails.length);
  for (const e of emails) {
    assert.match(e, /^[a-z0-9-]+@seed\.gymini\.test$/);
    assert.ok(isSeedEmail(e));
  }
  assert.ok(!emails.some((e) => /example\.com|gmail\.com/.test(e)), "never a preserved-account domain");
});

test("PT application states: every state present (63 APPROVED)", () => {
  for (const st of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO", "REJECTED", "APPROVED"]) assert.ok(s.ptApplication[st] > 0, st);
  assert.equal(s.ptApplication.APPROVED, 63);
});

test("PT listing states: none/DRAFT/PENDING/CHANGES_REQUESTED/REJECTED/APPROVED/STALE all present", () => {
  for (const k of ["NONE", "DRAFT", "PENDING", "CHANGES_REQUESTED", "REJECTED", "APPROVED", "STALE"]) assert.ok(s.ptListing[k] > 0, k);
});

test("PT flags and photo/package variety", () => {
  assert.ok(s.ptFlags.suspended >= 3 && s.ptFlags.accountRestricted >= 3 && s.ptFlags.contractRestricted >= 3 && s.ptFlags.notAccepting >= 1);
  for (const n of ["0", "1", "3", "5"]) assert.ok(s.ptPhotos[n] > 0, `photo count ${n}`);
  assert.ok(s.ptPackages["0"] > 0 && s.ptPackages["1-3"] > 0 && s.ptPackages["4+"] > 0);
  assert.ok(s.ptInactivePackages > 0);
  for (const p of world.pts) {
    assert.ok(p.photoFiles.length <= 5);
    assert.equal(new Set(p.photoFiles.map((f) => f.id)).size, p.photoFiles.length, "no duplicate photo inside one PT");
    if (p.app.state !== "APPROVED") assert.ok(p.packages.length === 0 && p.photoFiles.length === 0);
  }
});

test("fixed PT matrix rows (P1-P16)", () => {
  const by = Object.fromEntries(world.pts.map((p) => [p.person.full, p]));
  assert.equal(by["Trần Minh Khoa"].photoFiles.length, 5);
  assert.equal(by["Trần Minh Khoa"].packages.length, 4);
  assert.equal(by["Trần Minh Khoa"].packages.filter((k) => !k.isActive).length, 1);
  assert.equal(by["Lê Hoàng Nam"].listing.kind, "PENDING");
  const ten = by["Lê Hoàng Nam"].packages.find((k) => k.sessionCount === 10);
  assert.equal(ten.price, 2000000);
  assert.equal(by["Lê Hoàng Nam"].listing.pendingPriceBump.to, 2500000);
  assert.equal(by["Bùi Thanh Hà"].flags.suspended, true);
  assert.equal(by["Đặng Quốc Bảo"].flags.contractRestricted, true);
  assert.equal(by["Hoàng Thu Trang"].flags.notAccepting, true);
  assert.equal(by["Hoàng Thu Trang"].packages.length, 6);
  assert.equal(by["Châu Ngọc Hân"].listing.kind, "STALE");
  assert.equal(by["Kha Bảo Ngọc"].app.state, "REJECTED");
  assert.equal(by["Đỗ Khánh Linh"].app.state, "DRAFT");
});

test("owners: one brand each, partner states covered", () => {
  const states = new Set(world.owners.map((o) => o.partner.state));
  for (const st of ["ONBOARDING", "UNDER_REVIEW", "CHANGES_REQUESTED", "REJECTED", "ACTIVE", "SUSPENDED"]) assert.ok(states.has(st), st);
  assert.equal(world.owners.filter(o => o.partner.originalState === "APPROVED_PAYOUT_PENDING" && o.partner.state === "ACTIVE").length, 2);
  assert.equal(new Set(world.owners.map((o) => o.brand.name)).size, world.owners.length);
  const amen = world.owners.find((o) => o.partner.state === "CHANGES_REQUESTED" && o.partner.changes.issues.some((i) => i.category === "AMENITIES"));
  assert.ok(amen, "CHANGES_REQUESTED with an AMENITIES issue");
  assert.equal(world.owners.find((o) => o.n === 6).partner.onboardingSections, 6);
  for (const o of world.owners) assert.ok(o.branches.length >= 1);
});

test("branches: all statuses, listing states, 20-photo branch, 0..many amenities", () => {
  const keys = new Set(branches.map((b) => `${b.status}${b.op ? "/" + b.op : ""}`));
  for (const k of ["APPROVED/OPEN", "APPROVED/TEMPORARILY_CLOSED", "APPROVED/PERMANENTLY_CLOSED", "SUSPENDED/OPEN", "DRAFT"]) assert.ok(keys.has(k), k);
  assert.ok(branches.some((b) => b.status === "PENDING_REVIEW"));
  for (const k of ["DRAFT", "PENDING", "CHANGES_REQUESTED", "REJECTED", "APPROVED", "STALE"]) assert.ok(s.branchListing[k] > 0, `branch listing ${k}`);
  assert.equal(s.branchPhotos.exactly20, 1);
  assert.ok(s.branchPhotos.max <= 20);
  assert.ok(branches.some((b) => b.amenities.system.length + b.amenities.custom.length === 0));
  assert.ok(branches.some((b) => b.amenities.system.length + b.amenities.custom.length >= 14));
  const q1 = branches.find((b) => b.name === "Iron District Fitness Quận 1");
  assert.equal(q1.photoFiles.length, 20);
  assert.equal(q1.amenities.system.length + q1.amenities.custom.length, 14);
  for (const b of branches) assert.equal(new Set(b.photoFiles.map((f) => f.id)).size, b.photoFiles.length, `${b.slug}: distinct photos`);
});

test("custom amenity proposals: PENDING / REJECTED / APPROVED / MERGED / REENABLE are all scripted", () => {
  const outcomes = new Set(branches.filter((b) => b.appProposal).map((b) => b.appProposal.outcome));
  assert.ok(outcomes.has("PENDING") && outcomes.has("APPROVED"));
  assert.ok(branches.some((b) => (b.listing.open ?? []).some((t) => t.startsWith("proposal:Phòng boxing"))));
  assert.ok(branches.some((b) => (b.listing.open ?? []).some((t) => t.startsWith("proposal:Phòng karaoke")) && b.listing.finalKind === "REJECTED"));
  assert.equal(world.amenityScenarios.merged.mergeInto, "stretching");
  assert.equal(world.amenityScenarios.reenable.name, "Khăn tập");
});

test("geo: every ward code exists in the vendored reference data", () => {
  const data = JSON.parse(fs.readFileSync(new URL("../../../backend/services/user-service/prisma/data/vietnam_provinces.json", import.meta.url), "utf8"));
  const wards = new Map(data.flatMap((p) => p.wards.map((w) => [w.code, p.code])));
  for (const a of areas()) assert.equal(wards.get(a.wardCode), a.provinceCode);
  for (const b of branches) assert.equal(wards.get(b.area.wardCode), b.area.provinceCode);
  for (const p of world.pts) assert.equal(wards.get(p.area.wardCode), p.area.provinceCode);
});

test("assets: every referenced photo exists on disk and the manifest carries attribution; <= 15 MB", () => {
  const m = manifest();
  assert.ok(m.totalBytes <= 15 * 1024 * 1024);
  const hashes = new Set();
  for (const it of m.items) {
    assert.ok(it.photographer && it.sourceUrl && it.sha256, it.id);
    assert.ok(fs.existsSync(assetPath(it)), it.file);
    assert.ok(!hashes.has(it.sha256), `duplicate image ${it.id}`);
    hashes.add(it.sha256);
  }
  for (const f of [...branches.flatMap((b) => b.photoFiles), ...world.pts.flatMap((p) => p.photoFiles)]) assert.ok(fs.existsSync(assetPath(f)));
});

test("plans: realistic prices, at least one inactive plan somewhere", () => {
  for (const o of world.owners) for (const p of o.plans) assert.ok(p.price >= 200000 && p.price <= 15000000 && p.durationDays >= 30);
  assert.ok(world.owners.some((o) => o.plans.some((p) => p.status === "INACTIVE")));
});

test("clients: profile data consistent (search account present, InBody series monotone in time)", () => {
  assert.equal(world.clients[0].person.full, "Phạm Thu Uyên");
  for (const c of world.clients) {
    const p = c.profile;
    assert.ok(p.heightCm >= 150 && p.heightCm <= 190 && p.currentWeight > 35 && p.currentWeight < 140);
    const dates = c.inbody.map((i) => +i.date);
    assert.deepEqual([...dates].sort((a, b) => a - b), dates);
    for (const i of c.inbody) assert.ok(i.bodyFatPct > 5 && i.bodyFatPct < 50 && i.bmr > 900 && i.bmr < 2600, `${c.slug} inbody`);
  }
  assert.ok(s.clientsWithInbody > 250);
});
