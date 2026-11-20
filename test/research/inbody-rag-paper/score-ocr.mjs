// Scores every vision-language model against the reference labels of the InBody extraction experiment.
// Usage: node test/research/inbody-rag-paper/score-ocr.mjs --run-id 20261108
//
// Reference-label protocol (v2, stated in the paper):
//  * ALL 24 printouts were transcribed by hand (results/ocr-<run>/manual-labels.jsonl): 9 core fields + 10 segmental values.
//    Every manual label satisfies the identities printed on the report: FFM = W - BFM (+-0.15 kg),
//    BMR = 370 + 21.6 FFM (+-3 kcal), PBF = 100 BFM / W (+-0.3). Dates follow the printed DD.MM.YYYY / YYYY.MM.DD order.
//  * The earlier v1 reference (majority vote of the four models, accepted only if it satisfied the identities) is kept as a
//    check: we report how often the vote agreed with the manual transcription.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { flatten, FIELDS, SCALAR, SEGS } from "./lib/ocr-fields.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const RUN = args.includes("--run-id") ? args[args.indexOf("--run-id") + 1] : "20261108";
const dir = path.join(here, "results", `ocr-${RUN}`);
const rows = fs.readFileSync(path.join(dir, "raw.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.rep === 1);
const manual = Object.fromEntries(fs.readFileSync(path.join(dir, "manual-labels.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((m) => [m.img, m]));

// lean/fat arrays in manual-labels.jsonl are ordered [left_arm, right_arm, trunk, left_leg, right_leg]
const ORDER = ["left_arm", "right_arm", "trunk", "left_leg", "right_leg"];
const ref = {};
for (const [img, m] of Object.entries(manual)) {
  const r = {}; for (const f of SCALAR) r[f] = m[f];
  ORDER.forEach((s, i) => { r[`lean_${s}`] = m.lean[i]; r[`fat_${s}`] = m.fat[i]; });
  const ok = Math.abs(r.weight - r.body_fat_mass - r.fat_free_mass) <= 0.15 && Math.abs(370 + 21.6 * r.fat_free_mass - r.basal_metabolic_rate) <= 3 && Math.abs((100 * r.body_fat_mass) / r.weight - r.percent_body_fat) <= 0.3;
  if (!ok) throw new Error(`manual label for ${img} violates printed identities`);
  ref[img] = { labels: r, layout: m.layout, source: "manual transcription (all fields)" };
}
fs.writeFileSync(path.join(dir, "reference-labels.json"), JSON.stringify(ref, null, 2));

const short = (m) => (m.includes("sonnet") ? "Claude Sonnet 4.6" : m.includes("haiku") ? "Claude Haiku 4.5" : m.includes("nova-pro") ? "Nova Pro" : m.includes("nova-lite") ? "Nova Lite" : m);
const byImg = {};
for (const r of rows) (byImg[r.image] ??= {})[short(r.model)] = { f: flatten(r.output), r };
const missing = Object.keys(byImg).filter((i) => !ref[i]);
if (missing.length) throw new Error(`no manual label for ${missing.join(", ")}`);

const tol = (f) => (f === "basal_metabolic_rate" ? 0.5 : f === "visceral_fat_level" ? 0 : f.startsWith("lean_") ? 0.005 : 0.05);
const correct = (f, pred, gold) => {
  if (gold === null || gold === undefined) return pred === null || pred === undefined; // must abstain when nothing is printed
  if (f === "measurement_date") return pred === gold;
  return typeof pred === "number" && Math.abs(pred - gold) <= tol(f) + 1e-9;
};

// ---- v1 majority-vote reference vs manual (validates the earlier protocol)
let voteN = 0, voteOk = 0; const voteMiss = [];
for (const [img, ms] of Object.entries(byImg)) for (const f of SCALAR) {
  const cnt = new Map();
  for (const m of Object.values(ms)) { const v = m.f?.[f] ?? null; cnt.set(JSON.stringify(v), (cnt.get(JSON.stringify(v)) ?? 0) + 1); }
  const vote = JSON.parse([...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  voteN += 1; if (correct(f, vote, ref[img].labels[f])) voteOk += 1; else voteMiss.push(`${img}:${f}=${vote} (manual ${ref[img].labels[f]})`);
}

const ALL = Object.keys(ref);
const groups = {
  "Nutrition-critical (W, BFM, FFM, BMR)": { fields: ["weight", "body_fat_mass", "fat_free_mass", "basal_metabolic_rate"], imgs: ALL },
  "Core scalar fields (n=24 sheets)": { fields: SCALAR, imgs: ALL },
  "Measurement date": { fields: ["measurement_date"], imgs: ALL },
  "Segmental (n=24 sheets)": { fields: FIELDS.filter((f) => f.startsWith("lean_") || f.startsWith("fat_")), imgs: ALL },
};
const models = ["Claude Sonnet 4.6", "Claude Haiku 4.5", "Nova Pro", "Nova Lite"];
const summary = {
  run: RUN, images: ALL.length, layouts: ALL.reduce((a, i) => ((a[ref[i].layout] = (a[ref[i].layout] ?? 0) + 1), a), {}),
  referenceProtocol: "manual transcription of all 24 printouts, identity-checked",
  voteVsManual: { fields: voteN, agree: voteOk, agreementPct: Math.round((1000 * voteOk) / voteN) / 10, disagreements: voteMiss },
  models: {}, groups: Object.keys(groups),
};
for (const m of models) {
  const res = { groups: {}, perField: {}, lrSwaps: 0, fabricatedSegmental: 0, bmrAbsErr: [] };
  const rs = Object.values(byImg).map((x) => x[m]).filter(Boolean);
  res.latencyMsMean = Math.round(rs.reduce((s, x) => s + x.r.ms, 0) / rs.length);
  res.inTokMean = Math.round(rs.reduce((s, x) => s + x.r.inTok, 0) / rs.length);
  res.outTokMean = Math.round(rs.reduce((s, x) => s + x.r.outTok, 0) / rs.length);
  for (const [g, { fields, imgs }] of Object.entries(groups)) {
    let n = 0, ok = 0;
    for (const img of imgs) for (const f of fields) {
      const c = correct(f, byImg[img][m]?.f?.[f], ref[img].labels[f]); n += 1; ok += c ? 1 : 0;
      if (g === "Core scalar fields (n=24 sheets)") { (res.perField[f] ??= { n: 0, ok: 0 }); res.perField[f].n += 1; res.perField[f].ok += c ? 1 : 0; }
    }
    res.groups[g] = { n, correct: ok, accuracy: Math.round((1000 * ok) / n) / 10 };
  }
  for (const img of ALL) {
    const pred = byImg[img][m]?.f, gold = ref[img].labels;
    if (typeof pred?.basal_metabolic_rate === "number") res.bmrAbsErr.push(Math.abs(pred.basal_metabolic_rate - gold.basal_metabolic_rate));
    for (const k of ["lean", "fat"]) {
      if (gold[`${k}_left_arm`] === null) { if (SEGS.some((s) => pred?.[`${k}_${s}`] !== null && pred?.[`${k}_${s}`] !== undefined)) res.fabricatedSegmental += 1; continue; }
      for (const [L, R] of [["left_arm", "right_arm"], ["left_leg", "right_leg"]]) {
        const gl = gold[`${k}_${L}`], gr = gold[`${k}_${R}`];
        if (gl !== gr && pred?.[`${k}_${L}`] === gr && pred?.[`${k}_${R}`] === gl) res.lrSwaps += 1;
      }
    }
  }
  res.bmrMaeKcal = res.bmrAbsErr.length ? Math.round((10 * res.bmrAbsErr.reduce((a, b) => a + b, 0)) / res.bmrAbsErr.length) / 10 : null;
  res.bmrMaxErrKcal = res.bmrAbsErr.length ? Math.max(...res.bmrAbsErr) : null;
  delete res.bmrAbsErr;
  summary.models[m] = res;
}
summary.productionSchemaCoverage = { weight: true, height: true, skeletal_muscle_mass: true, body_fat_mass: true, percent_body_fat: "derived (BFM/W)", fat_free_mass: false, basal_metabolic_rate: false, visceral_fat_level: false, measurement_date: true };
fs.writeFileSync(path.join(dir, "ocr-summary.json"), JSON.stringify(summary, null, 2));

console.log(`images ${summary.images} ${JSON.stringify(summary.layouts)}; v1 vote vs manual: ${voteOk}/${voteN} (${summary.voteVsManual.agreementPct}%)`, voteMiss.slice(0, 5));
console.log("model".padEnd(20) + Object.keys(groups).map((g) => g.slice(0, 22).padEnd(24)).join("") + "BMR MAE  L/R-swap  fabricated");
for (const m of models) {
  const r = summary.models[m];
  console.log(m.padEnd(20) + Object.values(r.groups).map((g) => `${g.accuracy}% (${g.correct}/${g.n})`.padEnd(24)).join("") + `${r.bmrMaeKcal}`.padEnd(9) + `${r.lrSwaps}`.padEnd(10) + `${r.fabricatedSegmental}`);
}
