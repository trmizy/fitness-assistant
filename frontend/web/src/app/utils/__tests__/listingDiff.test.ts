/**
 * Listing Management D1 - the diff builder behind <ListingDiffView/> (server `changes` → display rows).
 * Run: npx tsx --test src/app/utils/__tests__/listingDiff.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGymDiffRows, buildPtDiffRows, formatPackageValue, photoDiff, type DiffRow } from "../listingDiff";
import type { ListingFieldChange } from "../../types";

const pkgField = (rows: DiffRow[], name: string) => rows.find((r) => r.kind === "package" && r.name === name) as Extract<DiffRow, { kind: "package" }>;

describe("PT diff rows", () => {
  const changes: ListingFieldChange[] = [
    { path: "profile.professionalBio", before: "Cũ", after: "Mới" },
    { path: "profile.mainSpecialties", before: ["Tăng cơ", "Yoga"], after: ["Tăng cơ", "HIIT"] },
    { path: "packages[p1].price", before: 2000000, after: 2500000 },
    { path: "packages[p1].isActive", before: true, after: false },
    { path: "packages[+]", before: null, after: { name: "Gói mới", price: 900000, sessionCount: 5, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: null } },
    { path: "packages[p2]", before: { id: "p2", name: "Gói bỏ", price: 300000 }, after: null },
    { path: "photoIds", before: ["a", "b", "c"], after: ["c", "a", "d"] },
    { path: "coverPhotoId", before: "a", after: "c" },
  ];
  const rows = buildPtDiffRows(changes, { packageNameOf: (id) => (id === "p1" ? "Gói 10 buổi" : null) });

  it("a text field becomes a before/after row with the Vietnamese label", () => {
    const r = rows.find((x) => x.kind === "text") as Extract<DiffRow, { kind: "text" }>;
    assert.equal(r.label, "Giới thiệu bản thân");
    assert.deepEqual([r.before, r.after], ["Cũ", "Mới"]);
  });

  it("a chip list becomes added / removed", () => {
    const r = rows.find((x) => x.kind === "list") as Extract<DiffRow, { kind: "list" }>;
    assert.equal(r.label, "Chuyên môn");
    assert.deepEqual(r.added, ["HIIT"]);
    assert.deepEqual(r.removed, ["Yoga"]);
  });

  it("package field changes are grouped under ONE package row, named, with formatted values", () => {
    const r = pkgField(rows, "Gói 10 buổi");
    assert.equal(r.change, "edited");
    assert.equal(r.fields.length, 2);
    assert.deepEqual(r.fields.find((f) => f.label === "Giá"), { label: "Giá", before: "2.000.000 ₫", after: "2.500.000 ₫" });
    assert.deepEqual(r.fields.find((f) => f.label === "Trạng thái bán"), { label: "Trạng thái bán", before: "Đang bán", after: "Tạm ngưng" });
  });

  it("a new package and a removed package are their own rows", () => {
    assert.equal(pkgField(rows, "Gói mới").change, "added");
    assert.equal(pkgField(rows, "Gói bỏ").change, "removed");
  });

  it("photos: added, removed AND reordered are all reported, and the cover change is its own row", () => {
    const p = rows.find((x) => x.kind === "photos") as Extract<DiffRow, { kind: "photos" }>;
    assert.deepEqual(p.added, ["d"]);
    assert.deepEqual(p.removed, ["b"]);
    assert.equal(p.reordered, true);
    const c = rows.find((x) => x.kind === "cover") as Extract<DiffRow, { kind: "cover" }>;
    assert.deepEqual([c.before, c.after], ["a", "c"]);
  });

  it("an unknown package id still gets a neutral name, never the raw id", () => {
    const r = buildPtDiffRows([{ path: "packages[zzz].price", before: 1, after: 2 }]);
    assert.equal((r[0] as any).name, "Gói dịch vụ");
  });

  it("no changes → no rows", () => {
    assert.deepEqual(buildPtDiffRows([]), []);
  });
});

describe("photoDiff", () => {
  it("pure reorder: same set, different order", () => {
    assert.deepEqual(photoDiff(["a", "b"], ["b", "a"]), { added: [], removed: [], reordered: true });
  });
  it("adding at the end is NOT a reorder", () => {
    assert.deepEqual(photoDiff(["a", "b"], ["a", "b", "c"]), { added: ["c"], removed: [], reordered: false });
  });
  it("removing one keeps the order of the rest", () => {
    assert.deepEqual(photoDiff(["a", "b", "c"], ["a", "c"]), { added: [], removed: ["b"], reordered: false });
  });
});

describe("gym diff rows", () => {
  const names: Record<string, string> = { a1: "Hồ bơi", a2: "Wifi miễn phí" };
  const changes: ListingFieldChange[] = [
    { path: "description", before: null, after: "Phòng tập mới" },
    { path: "amenityIds", before: ["a1"], after: ["a2"], added: ["a2"], removed: ["a1"] },
    { path: "proposalIds", before: [], after: ["pr1"], added: ["pr1"], removed: [] },
    { path: "photoIds", before: ["x"], after: ["x", "y"], added: ["y"], removed: [] },
    { path: "coverPhotoId", before: "x", after: "y" },
  ];
  const rows = buildGymDiffRows(changes, { amenityName: (id) => names[id] ?? null, proposalName: (id) => (id === "pr1" ? "Phòng boxing" : null) });

  it("amenities and custom proposals are shown by NAME, in separate rows", () => {
    const am = rows.filter((r) => r.kind === "amenities") as Extract<DiffRow, { kind: "amenities" }>[];
    assert.equal(am.length, 2);
    assert.deepEqual([am[0].label, am[0].added, am[0].removed], ["Tiện ích", ["Wifi miễn phí"], ["Hồ bơi"]]);
    assert.deepEqual([am[1].label, am[1].added], ["Tiện ích tùy chỉnh chờ duyệt", ["Phòng boxing"]]);
  });

  it("description, photos and cover are covered; an unknown amenity id falls back to a neutral word", () => {
    assert.equal(rows.find((r) => r.kind === "text")?.key, "description");
    assert.ok(rows.find((r) => r.kind === "photos"));
    assert.ok(rows.find((r) => r.kind === "cover"));
    const r = buildGymDiffRows([{ path: "amenityIds", before: [], after: ["zz"], added: ["zz"], removed: [] }]);
    assert.deepEqual((r[0] as any).added, ["Tiện ích"]);
  });

  it("derives added/removed itself when the server omitted them", () => {
    const r = buildGymDiffRows([{ path: "amenityIds", before: ["a1"], after: ["a1", "a2"] }], { amenityName: (id) => names[id] ?? null });
    assert.deepEqual((r[0] as any).added, ["Wifi miễn phí"]);
  });
});

describe("formatPackageValue", () => {
  it("formats money, mode, duration, validity and the active flag", () => {
    assert.equal(formatPackageValue("price", 1250000), "1.250.000 ₫");
    assert.equal(formatPackageValue("sessionMode", "ONLINE"), "Online");
    assert.equal(formatPackageValue("sessionMode", "OFFLINE"), "Trực tiếp");
    assert.equal(formatPackageValue("sessionDurationMinutes", 60), "60 phút");
    assert.equal(formatPackageValue("validityDays", null), "Không giới hạn");
    assert.equal(formatPackageValue("validityDays", 90), "90 ngày");
    assert.equal(formatPackageValue("isActive", false), "Tạm ngưng");
    assert.equal(formatPackageValue("description", null), "—");
  });
});
