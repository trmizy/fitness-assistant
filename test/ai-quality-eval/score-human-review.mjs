// Compares a filled human-review CSV with the machine verdicts kept in <packet>.key.json:
// - per criterion: human mean vs LLM-judge mean, mean absolute difference, and Spearman rank correlation;
// - deterministic checks vs human "acceptable": agreement and Cohen's kappa.
// Usage: node test/ai-quality-eval/score-human-review.mjs test/ai-quality-eval/human-review/nutrition
import fs from "node:fs";

const base = process.argv[2];
const key = JSON.parse(fs.readFileSync(`${base}.key.json`, "utf8"));
const lines = fs.readFileSync(`${base}.csv`, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).slice(1);
const human = Object.fromEntries(lines.map((l) => { const [id, ...v] = l.split(","); return [id, v]; }));
const K = ["correctness", "relevance", "personalization", "safety", "clarity"];
const rows = key.map((k) => { const v = human[k.hid] ?? []; return { ...k, h: Object.fromEntries(K.map((c, i) => [c, v[i] === "" || v[i] == null ? NaN : +v[i]])), acceptable: /^(c|có|co|y|yes|1|true)$/i.test((v[5] ?? "").trim()) ? 1 : /^(k|không|khong|n|no|0|false)$/i.test((v[5] ?? "").trim()) ? 0 : null }; })
  .filter((r) => K.some((c) => Number.isFinite(r.h[c])));
if (!rows.length) { console.log("no scored rows yet in", `${base}.csv`); process.exit(0); }
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const rank = (a) => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = []; for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const pearson = (x, y) => { const mx = mean(x), my = mean(y); const n = x.reduce((a, _, i) => a + (x[i] - mx) * (y[i] - my), 0); const d = Math.sqrt(x.reduce((a, v) => a + (v - mx) ** 2, 0) * y.reduce((a, v) => a + (v - my) ** 2, 0)); return d ? n / d : NaN; };
const out = { scored: rows.length, perCriterion: {} };
for (const c of K) {
  const pr = rows.filter((r) => Number.isFinite(r.h[c]) && Number.isFinite(r.judge?.[c]));
  if (!pr.length) continue;
  const h = pr.map((r) => r.h[c]), j = pr.map((r) => r.judge[c]);
  out.perCriterion[c] = { n: pr.length, humanMean: +mean(h).toFixed(2), judgeMean: +mean(j).toFixed(2), meanAbsDiff: +mean(h.map((v, i) => Math.abs(v - j[i]))).toFixed(2), spearman: +pearson(rank(h), rank(j)).toFixed(2) };
}
const acc = rows.filter((r) => r.acceptable !== null);
if (acc.length) {
  const a = acc.map((r) => r.acceptable), m = acc.map((r) => +r.casePass), agree = mean(a.map((v, i) => +(v === m[i])));
  const pa = mean(a), pm = mean(m), pe = pa * pm + (1 - pa) * (1 - pm);
  out.acceptableVsChecks = { n: acc.length, humanAcceptableRate: +pa.toFixed(2), machinePassRate: +pm.toFixed(2), agreement: +agree.toFixed(2), cohensKappa: pe < 1 ? +((agree - pe) / (1 - pe)).toFixed(2) : null,
    disagreements: acc.filter((r) => r.acceptable !== +r.casePass).map((r) => `${r.hid} ${r.id}: human=${r.acceptable ? "ok" : "not ok"} checks=${r.casePass ? "pass" : "fail"} ${r.failed.join(",")}`) };
}
console.log(JSON.stringify(out, null, 2));
