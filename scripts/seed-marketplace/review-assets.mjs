// Audits scripts/seed-marketplace/assets/manifest.json against C7 targets (PT >= 625, Gym >= 440) and reports shortfalls.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = path.join(here, "assets");
export const MANIFEST_PATH = path.join(ASSETS_DIR, "manifest.json");

/** Target topic allocations scaled from existing Pexels mix / C7 quotas (Gym >= 440, PT >= 625). */
export const C7_GYM_TARGET_BY_TOPIC = {
  "gym-interior": 85,
  "fitness-center": 65,
  "free-weights": 60,
  cardio: 40,
  crossfit: 35,
  functional: 35,
  "yoga-studio": 35,
  boxing: 30,
  exterior: 22,
  pool: 15,
  "locker-room": 10,
  reception: 8,
}; // sums to 440

export const C7_PT_TARGET_BY_TOPIC = {
  "physique-men": 240,
  "physique-women": 240,
  "physique-bodybuilder": 85,
  "physique-trainer": 60,
}; // sums to 625

/** Computes category stats, file integrity, and C7 shortages from manifest + assets directory. */
export function analyzeManifest(manifestPath = MANIFEST_PATH, assetsDir = ASSETS_DIR) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const byCategory = {};
  const byEffectiveCategory = {};
  const missingOnDisk = [];
  const rejected = [];
  const reclassified = [];

  for (const it of manifest.items) {
    const filePath = path.join(assetsDir, ...it.file.split("/"));
    if (!fs.existsSync(filePath)) missingOnDisk.push(it.file);

    const status = it.audit?.status ?? "UNAUDITED";
    const faceless = it.audit ? it.audit.hasVisibleFace === false : null;
    const effCat = it.audit?.reclassifiedCategory || it.category;

    const slot = (byCategory[it.category] ??= {
      kind: it.kind,
      rawCount: 0,
      approved: 0,
      reclassifiedOut: 0,
      reclassifiedIn: 0,
      rejected: 0,
      unaudited: 0,
      usableInOriginalCat: 0,
      facelessUsable: 0,
      visibleFaceUsable: 0,
    });
    slot.rawCount++;
    if (status === "APPROVED") slot.approved++;
    else if (status === "RECLASSIFIED") slot.reclassifiedOut++;
    else if (status === "REJECTED") slot.rejected++;
    else slot.unaudited++;

    if (status === "REJECTED") {
      rejected.push({ id: it.id, file: it.file, category: it.category, reason: it.audit?.reason ?? "" });
      continue;
    }

    const effSlot = (byEffectiveCategory[effCat] ??= {
      kind: it.kind,
      usableTotal: 0,
      facelessUsable: 0,
      visibleFaceUsable: 0,
      maleUsable: 0,
      femaleUsable: 0,
      missingGender: 0,
    });
    effSlot.usableTotal++;
    if (faceless) effSlot.facelessUsable++;
    else effSlot.visibleFaceUsable++;
    if (it.kind === "physique") {
      if (it.audit?.gender === "MALE") effSlot.maleUsable++;
      else if (it.audit?.gender === "FEMALE") effSlot.femaleUsable++;
      else effSlot.missingGender++;
    }

    if (status === "RECLASSIFIED") {
      (byCategory[effCat] ??= {
        kind: it.kind,
        rawCount: 0,
        approved: 0,
        reclassifiedOut: 0,
        reclassifiedIn: 0,
        rejected: 0,
        unaudited: 0,
        usableInOriginalCat: 0,
        facelessUsable: 0,
        visibleFaceUsable: 0,
      }).reclassifiedIn++;
      reclassified.push({ id: it.id, file: it.file, from: it.category, to: effCat, reason: it.audit?.reason ?? "" });
    } else {
      slot.usableInOriginalCat++;
    }
    if (faceless) slot.facelessUsable++;
    else slot.visibleFaceUsable++;
  }

  const gymRows = Object.entries(C7_GYM_TARGET_BY_TOPIC).map(([topic, target]) => {
    const eff = byEffectiveCategory[topic] ?? { usableTotal: 0, facelessUsable: 0, visibleFaceUsable: 0 };
    const orig = byCategory[topic] ?? { rawCount: 0, approved: 0, reclassifiedOut: 0, reclassifiedIn: 0, rejected: 0 };
    return {
      topic,
      rawCount: orig.rawCount,
      approved: orig.approved,
      reclassifiedIn: orig.reclassifiedIn,
      reclassifiedOut: orig.reclassifiedOut,
      rejected: orig.rejected,
      usable: eff.usableTotal,
      faceless: eff.facelessUsable,
      visibleFace: eff.visibleFaceUsable,
      c7Target: target,
      shortageUsable: Math.max(0, target - eff.usableTotal),
    };
  });

  const ptRows = Object.entries(C7_PT_TARGET_BY_TOPIC).map(([topic, target]) => {
    const eff = byEffectiveCategory[topic] ?? {
      usableTotal: 0,
      facelessUsable: 0,
      visibleFaceUsable: 0,
      maleUsable: 0,
      femaleUsable: 0,
      missingGender: 0,
    };
    const orig = byCategory[topic] ?? { rawCount: 0, approved: 0, reclassifiedOut: 0, reclassifiedIn: 0, rejected: 0, unaudited: 0 };
    return {
      topic,
      rawCount: orig.rawCount,
      approved: orig.approved,
      unaudited: orig.unaudited,
      rejected: orig.rejected,
      usableNonRejected: eff.usableTotal,
      maleUsable: eff.maleUsable,
      femaleUsable: eff.femaleUsable,
      missingGender: eff.missingGender,
      ptPoolFacelessOnly: eff.facelessUsable,
      excludedVisibleFace: eff.visibleFaceUsable,
      c7Target: target,
      shortageAllNonRejected: Math.max(0, target - eff.usableTotal),
    };
  });

  const summary = {
    totalItems: manifest.items.length,
    missingOnDisk,
    rejectedCount: rejected.length,
    reclassifiedCount: reclassified.length,
    unauditedCount: Object.values(byCategory).reduce((s, r) => s + (r.unaudited || 0), 0),
    gym: {
      raw: gymRows.reduce((s, r) => s + r.rawCount, 0),
      usable: gymRows.reduce((s, r) => s + r.usable, 0),
      faceless: gymRows.reduce((s, r) => s + r.faceless, 0),
      c7Target: gymRows.reduce((s, r) => s + r.c7Target, 0),
      shortage: gymRows.reduce((s, r) => s + r.shortageUsable, 0),
    },
    pt: {
      raw: ptRows.reduce((s, r) => s + r.rawCount, 0),
      usableNonRejected: ptRows.reduce((s, r) => s + r.usableNonRejected, 0),
      maleUsable: ptRows.reduce((s, r) => s + r.maleUsable, 0),
      femaleUsable: ptRows.reduce((s, r) => s + r.femaleUsable, 0),
      missingGender: ptRows.reduce((s, r) => s + r.missingGender, 0),
      ptPoolFacelessOnly: ptRows.reduce((s, r) => s + r.ptPoolFacelessOnly, 0),
      excludedVisibleFace: ptRows.reduce((s, r) => s + r.excludedVisibleFace, 0),
      c7Target: ptRows.reduce((s, r) => s + r.c7Target, 0),
      shortageAllNonRejected: ptRows.reduce((s, r) => s + r.shortageAllNonRejected, 0),
    },
  };

  return { summary, gymRows, ptRows, rejected, reclassified };
}

function formatMarkdown(report) {
  const lines = [];
  const { summary, gymRows, ptRows, rejected, reclassified } = report;
  lines.push(`# Asset Audit & C7 Shortage Report`);
  lines.push(``);
  lines.push(`- Total items in manifest: **${summary.totalItems}** (missing on disk: ${summary.missingOnDisk.length}, unaudited: ${summary.unauditedCount})`);
  lines.push(`- Rejected: **${summary.rejectedCount}** | Reclassified: **${summary.reclassifiedCount}**`);
  lines.push(`- Gym pool (non-rejected): **${summary.gym.usable}** / C7 target **${summary.gym.c7Target}** -> thiếu **${summary.gym.shortage}** ảnh`);
  lines.push(`- PT pool (non-rejected, strict gender): **${summary.pt.usableNonRejected}** / C7 target **${summary.pt.c7Target}** (MALE: **${summary.pt.maleUsable}**, FEMALE: **${summary.pt.femaleUsable}**, missing gender: ${summary.pt.missingGender}; faceless ref: ${summary.pt.ptPoolFacelessOnly}) -> thiếu **${summary.pt.shortageAllNonRejected}** ảnh`);
  lines.push(``);
  lines.push(`## Gym Categories vs C7 Target (440)`);
  lines.push(`| Topic | Raw | Approved | Reclass +In/-Out | Rejected | Usable | C7 Target | Shortage |`);
  lines.push(`| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |`);
  for (const r of gymRows) {
    lines.push(`| ${r.topic} | ${r.rawCount} | ${r.approved} | +${r.reclassifiedIn}/-${r.reclassifiedOut} | ${r.rejected} | ${r.usable} | ${r.c7Target} | ${r.shortageUsable} |`);
  }
  lines.push(`| **TOTAL** | **${summary.gym.raw}** | **${gymRows.reduce((s, r) => s + r.approved, 0)}** | **+${reclassified.length}/-${reclassified.length}** | **${gymRows.reduce((s, r) => s + r.rejected, 0)}** | **${summary.gym.usable}** | **${summary.gym.c7Target}** | **${summary.gym.shortage}** |`);
  lines.push(``);
  lines.push(`## PT Physique Categories vs C7 Target (625)`);
  lines.push(`| Topic | Raw | Usable | MALE | FEMALE | Rejected | C7 Target | Shortage |`);
  lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |`);
  for (const r of ptRows) {
    lines.push(`| ${r.topic} | ${r.rawCount} | ${r.usableNonRejected} | ${r.maleUsable} | ${r.femaleUsable} | ${r.rejected} | ${r.c7Target} | ${r.shortageAllNonRejected} |`);
  }
  lines.push(`| **TOTAL** | **${summary.pt.raw}** | **${summary.pt.usableNonRejected}** | **${summary.pt.maleUsable}** | **${summary.pt.femaleUsable}** | **${ptRows.reduce((s, r) => s + r.rejected, 0)}** | **${summary.pt.c7Target}** | **${summary.pt.shortageAllNonRejected}** |`);
  lines.push(``);
  lines.push(`## Rejected (${rejected.length})`);
  for (const x of rejected) lines.push(`- \`${x.file}\` (${x.id}): ${x.reason}`);
  lines.push(``);
  lines.push(`## Reclassified (${reclassified.length})`);
  for (const x of reclassified) lines.push(`- \`${x.file}\` (${x.from} -> ${x.to}): ${x.reason}`);
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const report = analyzeManifest();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatMarkdown(report));
  }
  if (report.summary.missingOnDisk.length) process.exitCode = 1;
}

