// Agreement between two human score sheets of the same review packet: per criterion mean, mean |diff|, Spearman, and
// Cohen's kappa on "acceptable". Usage: node test/ai-quality-eval/compare-raters.mjs <a.csv> <b.csv>
import fs from "node:fs";

const K = ["correctness", "relevance", "personalization", "safety", "clarity"];
function read(f) {
  const lines = fs.readFileSync(f, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).slice(1);
  return Object.fromEntries(lines.map((l) => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, ""));
    const [id, ...v] = cells;
    return [id, { s: Object.fromEntries(K.map((k, i) => [k, v[i] === "" ? NaN : +v[i]])), acc: /^(có|co|c|y|yes|1)$/i.test((v[5] ?? "").trim()) ? 1 : /^(không|khong|k|n|no|0)$/i.test((v[5] ?? "").trim()) ? 0 : null }];
  }));
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const rank = (a) => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]), r = []; for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const pearson = (x, y) => { const mx = mean(x), my = mean(y), n = x.reduce((a, _, i) => a + (x[i] - mx) * (y[i] - my), 0), d = Math.sqrt(x.reduce((a, v) => a + (v - mx) ** 2, 0) * y.reduce((a, v) => a + (v - my) ** 2, 0)); return d ? n / d : NaN; };
const [A, B] = process.argv.slice(2).map(read), ids = Object.keys(A).filter((id) => B[id]);
const out = { items: ids.length, perCriterion: {} };
for (const k of K) {
  const pairs = ids.map((id) => [A[id].s[k], B[id].s[k]]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const a = pairs.map((p) => p[0]), b = pairs.map((p) => p[1]);
  out.perCriterion[k] = { n: pairs.length, meanA: +mean(a).toFixed(2), meanB: +mean(b).toFixed(2), meanAbsDiff: +mean(a.map((v, i) => Math.abs(v - b[i]))).toFixed(2), spearman: +pearson(rank(a), rank(b)).toFixed(2) };
}
const acc = ids.filter((id) => A[id].acc !== null && B[id].acc !== null), a = acc.map((id) => A[id].acc), b = acc.map((id) => B[id].acc);
const agree = mean(a.map((v, i) => +(v === b[i]))), pa = mean(a), pb = mean(b), pe = pa * pb + (1 - pa) * (1 - pb);
out.acceptable = { n: acc.length, acceptableA: +pa.toFixed(2), acceptableB: +pb.toFixed(2), agreement: +agree.toFixed(2), cohensKappa: pe < 1 ? +((agree - pe) / (1 - pe)).toFixed(2) : null,
  disagreements: acc.filter((id) => A[id].acc !== B[id].acc).map((id) => `${id}: A=${A[id].acc ? "có" : "không"} B=${B[id].acc ? "có" : "không"}`) };
console.log(JSON.stringify(out, null, 2));
