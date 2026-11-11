const fs = require("fs");
// Summarizes N live-nutrition.ts run logs (jN.log) in a directory.
// Usage: node test/nutrition-invariant-remediation/summarize-live-logs.js <dir> [N]
const DIR = process.argv[2] || ".";
const N = Number(process.argv[3] || 20);
const rows = [];
for (let i = 1; i <= N; i++) {
  const f = `${DIR}/j${i}.log`; if (!fs.existsSync(f)) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  const ev = {}; const repairs = []; let scriptErr = null;
  for (const l of lines) {
    if (l.startsWith('{"id"')) { try { const j = JSON.parse(l); ev[j.id] = j.observed; } catch {} }
    else if (l.includes("[nutrition-repair]")) { try { repairs.push(JSON.parse(l)); } catch {} }
    else if (/^Error|SCRIPT ERROR/.test(l)) scriptErr = l.slice(0, 120);
  }
  const g = ev["generation"] || {}, r = ev["live-revision"] || {}, c = ev["live-confirm-persist"] || {}, rp = ev["live-idempotent-replay"] || {}, x = ev["live-exclusion"] || {}, u = ev["live-unsupported-refusal"] || {}, lat = ev["latency-ms"] || {};
  rows.push({ i, init: g.planStatus, initFail: g.failReason, rev: r.planStatus, revFail: r.failReason, sameAction: r.sameAction, meals: r.mealsInPreview, exclInit: x.excludedFoundCount, exclRev: r.excludedFound, refusal: !!(u.answer && /chưa thể ĐẢM BẢO/.test(u.answer)), saved: /Đã lưu/.test(c.result || ""), programs: c.program, items: c.itemRows, replay: rp.sameResult, replayPrograms: rp.programs, gen: lat.generationMs, total: lat.totalMs, repairs: repairs.map(z => ({ inv: z.repairInvoked, ok: z.repairSucceeded, days: z.repairedDays, failed: z.failedDays, vb: z.violationsBefore, before: z.before && z.before[0], after: z.after && z.after[0], ms: z.repairMs })), scriptErr });
}
console.log(JSON.stringify(rows, null, 0).replace(/\},\{"i"/g, "},\n{\"i\""));
const c = (k, v) => rows.filter(r => r[k] === v).length;
console.log("\nINITIAL   COMPLETED:", c("init", "COMPLETED"), "FAILED:", c("init", "FAILED"), "other:", rows.length - c("init", "COMPLETED") - c("init", "FAILED"));
console.log("REVISION  COMPLETED:", c("rev", "COMPLETED"), "FAILED:", c("rev", "FAILED"), "other:", rows.length - c("rev", "COMPLETED") - c("rev", "FAILED"));
console.log("sameAction:", c("sameAction", true), " meals==3:", rows.filter(r => r.meals === 3).length, " exclInit0:", c("exclInit", 0), " exclRev0:", c("exclRev", 0), " refusal:", c("refusal", true), " saved:", c("saved", true), " replaySame:", c("replay", true), " replayPrograms==1:", rows.filter(r => r.replayPrograms === "1").length);
const rep = rows.flatMap(r => r.repairs.map(z => ({ run: r.i, ...z })));
console.log("repair invoked:", rep.length, " succeeded:", rep.filter(z => z.ok).length, " failed:", rep.filter(z => !z.ok).length, " ms:", rep.map(z => Math.round(z.ms * 100) / 100).join(","));
