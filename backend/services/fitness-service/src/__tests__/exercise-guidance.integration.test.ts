import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

/**
 * Exercise guidance foundation (Vietnamese names, how-to, common mistakes, safety notes) — BACKEND INTEGRATION on an isolated *_test Postgres.
 * Rules proven: the data comes from a reviewable source (the project's curated catalog); Exercise ids are never changed; MACHINE_TRANSLATED guidance is
 * never returned as verified; a missing translation falls back to the original English name and is reported as MISSING; the importer is idempotent.
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.FITNESS_DISABLE_REDIS = process.env.FITNESS_DISABLE_REDIS || "true";
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires a *_test DATABASE_URL.", timeout: 120_000 };

const CSV = path.resolve(__dirname, "../../../../../data/catalog/plans/gym_exercises.csv");
const RUN = randomUUID().slice(0, 8);
let prisma: (typeof import("../repositories/prisma"))["prisma"];
let svc: (typeof import("../services/exercise-localization.service"))["exerciseLocalizationService"];
let importer: typeof import("../importers/exerciseGuidanceImporter");
const created: string[] = [];

const mkExercise = async (tag: string) => {
  const id = `guid-${RUN}-${tag}`;
  await prisma.exercise.create({ data: { id, exerciseName: `Guidance Test ${tag}`, typeOfActivity: "STRENGTH", typeOfEquipment: "BARBELL", bodyPart: "UPPER_BODY", type: "PUSH", muscleGroupsActivated: ["chest"], instructions: "English how-to.", status: "PUBLISHED" } as any });
  created.push(id);
  return id;
};

test.before(async () => {
  if (!canUseIntegrationDb) return;
  prisma = (await import("../repositories/prisma")).prisma;
  svc = (await import("../services/exercise-localization.service")).exerciseLocalizationService;
  importer = await import("../importers/exerciseGuidanceImporter");
});
test.after(async () => {
  if (!canUseIntegrationDb) return;
  await prisma.exerciseGuidance.deleteMany({ where: { exerciseId: { in: created } } });
  await prisma.exerciseAlias.deleteMany({ where: { exerciseId: { in: created } } });
  await prisma.exercise.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

test("curated CSV -> guidance fields (pure): name, how-to (setup + steps + breathing), common mistakes, safety notes; empty sections stay empty, nothing is invented", () => {
  const all = importer.readCuratedCatalog(CSV);
  assert.equal(all.length, 205, "the whole curated catalog is read");
  const first = all.find((g) => g.externalId === "EX00001")!;
  assert.equal(first.nameVi, "Đẩy ngực phẳng với tạ đòn");
  assert.match(first.instructionsVi!, /Thiết lập ghế phẳng/); assert.match(first.instructionsVi!, /Hạ tạ có kiểm soát/); assert.match(first.instructionsVi!, /Nhịp thở: Hít vào khi hạ tạ/);
  assert.ok(first.commonMistakesVi.length >= 3 && first.commonMistakesVi.every((x) => x.length > 2));
  const empty = importer.buildGuidanceFromRow({ exercise_id: "X1", exercise_name_vi: "", setup: "", execution_steps: "", breathing: "", common_errors: "", contraindications: "" });
  assert.deepEqual(empty, { externalId: "X1", nameVi: null, instructionsVi: null, commonMistakesVi: [], safetyNotesVi: [] });
  assert.equal(importer.buildGuidanceFromRow({ exercise_id: "" }), null);
});

test("localization: verified guidance wins; a Vietnamese alias is the fallback; no data => original English name flagged MISSING; the id is never changed", skipOpts, async () => {
  const withGuidance = await mkExercise("g"), aliasOnly = await mkExercise("a"), none = await mkExercise("n");
  await prisma.exerciseGuidance.create({ data: { exerciseId: withGuidance, language: "vi", nameVi: "Đẩy ngực thử nghiệm", instructionsVi: "Nằm ngửa, hạ tạ có kiểm soát.", commonMistakesVi: ["Nảy tạ"], safetyNotesVi: ["Có người bảo hộ khi tập nặng"], source: "test", verification: "CURATED" } });
  await prisma.exerciseAlias.create({ data: { exerciseId: aliasOnly, language: "vi", alias: "Tên theo bí danh", aliasNormalized: `ten theo bi danh ${RUN}`, aliasType: "localized_name" } });
  const rows = await svc.getLocalizations([withGuidance, aliasOnly, none, "does-not-exist"], { status: "PUBLISHED" });
  assert.equal(rows.length, 3, "unknown ids are simply absent");
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by[withGuidance].nameViSource, "GUIDANCE"); assert.equal(by[withGuidance].displayName, "Đẩy ngực thử nghiệm"); assert.equal(by[withGuidance].nameEn, `Guidance Test g`);
  assert.equal(by[withGuidance].instructionsVi, "Nằm ngửa, hạ tạ có kiểm soát."); assert.deepEqual(by[withGuidance].commonMistakesVi, ["Nảy tạ"]); assert.deepEqual(by[withGuidance].safetyNotesVi, ["Có người bảo hộ khi tập nặng"]);
  assert.equal(by[withGuidance].guidanceStatus, "VERIFIED"); assert.equal(by[withGuidance].instructionsEn, "English how-to.");
  assert.equal(by[aliasOnly].nameViSource, "ALIAS"); assert.equal(by[aliasOnly].displayName, "Tên theo bí danh"); assert.equal(by[aliasOnly].guidanceStatus, "MISSING"); assert.equal(by[aliasOnly].instructionsVi, null);
  assert.equal(by[none].nameViSource, "MISSING"); assert.equal(by[none].displayName, "Guidance Test n", "falls back to the original name"); assert.equal(by[none].nameVi, null);
  assert.ok((await prisma.exercise.findMany({ where: { id: { in: [withGuidance, aliasOnly, none] } } })).every((e: any) => e.exerciseName.startsWith("Guidance Test")), "exercise rows untouched");
});

test("a MACHINE_TRANSLATED row is NEVER returned as verified (hidden, status says so)", skipOpts, async () => {
  const id = await mkExercise("m");
  await prisma.exerciseGuidance.create({ data: { exerciseId: id, language: "vi", nameVi: "Bản dịch máy", instructionsVi: "Hướng dẫn do máy dịch", source: "mt", verification: "MACHINE_TRANSLATED" } });
  const [row] = await svc.getLocalizations([id], { status: "PUBLISHED" });
  assert.equal(row.guidanceStatus, "HIDDEN_UNVERIFIED"); assert.equal(row.instructionsVi, null); assert.equal(row.nameVi, null); assert.equal(row.displayName, "Guidance Test m");
});

test("importer: only exercises Gate 5 already linked to the curated catalog get guidance; idempotent; Exercise ids/names never change; coverage reflects it", skipOpts, async () => {
  const linkedBefore = await prisma.exerciseSource.count({ where: { sourceName: "curated_vi_exercise_catalog" } });
  if (linkedBefore === 0) return; // an empty catalog DB has nothing to link (the importer is then a no-op by design)
  const idsBefore = (await prisma.exercise.findMany({ select: { id: true, exerciseName: true }, orderBy: { id: "asc" } })).map((e: any) => `${e.id}|${e.exerciseName}`);
  const dry = await importer.importGuidance(false);
  assert.equal(dry.written, 0); assert.ok(dry.linkedToLiveExercises > 0);
  const preexisting = await prisma.exerciseGuidance.count({ where: { source: { startsWith: "curated_vi_exercise_catalog:" } } });
  const a = await importer.importGuidance(true);
  const after1 = await prisma.exerciseGuidance.count({ where: { source: { startsWith: "curated_vi_exercise_catalog:" } } });
  const b = await importer.importGuidance(true);
  const after2 = await prisma.exerciseGuidance.count({ where: { source: { startsWith: "curated_vi_exercise_catalog:" } } });
  assert.equal(a.written, b.written); assert.equal(after1, after2, "second run creates no duplicates");
  assert.equal(after1, a.linkedToLiveExercises);
  const idsAfter = (await prisma.exercise.findMany({ select: { id: true, exerciseName: true }, orderBy: { id: "asc" } })).map((e: any) => `${e.id}|${e.exerciseName}`);
  assert.deepEqual(idsAfter, idsBefore, "no exercise created, renamed or re-id'd");
  const cov = await svc.getCoverage();
  assert.ok(cov.published >= cov.nameVi && cov.englishOnly === cov.published - cov.nameVi, JSON.stringify(cov));
  // leave the DB as found when this test created the rows
  if (preexisting === 0) await prisma.exerciseGuidance.deleteMany({ where: { source: { startsWith: "curated_vi_exercise_catalog:" } } });
});
