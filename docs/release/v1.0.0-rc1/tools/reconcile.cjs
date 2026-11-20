// Per-test reconciliation of the three full service runs + the pre-7-phase DB baseline.
const fs = require("fs"), path = require("path");
const D = __dirname;
const names = (f, mark) => new Set([...fs.readFileSync(f, "utf8").matchAll(new RegExp(`^\\s*${mark} (.+?) \\(\\d+(?:\\.\\d+)?ms\\)\\s*$`, "gmu"))].map((m) => m[1].trim()));
const runs = { rc: "rc-svc.log", f2: "f-svc2.log", v: "v-svc.log" };
const F = {}, P = {};
for (const [k, f] of Object.entries(runs)) { F[k] = names(path.join(D, f), "✖"); P[k] = names(path.join(D, f), "✔"); }
const pre7 = names(path.join(D, "..", "baseline2", "int-db3.log"), "✖");
const all = [...new Set([...F.rc, ...F.f2, ...F.v])].sort();
const st = (k, t) => (F[k].has(t) ? "FAIL" : P[k].has(t) ? "pass" : "-");
for (const t of all) console.log(`${st("rc", t)}/${st("f2", t)}/${st("v", t)} ${pre7.has(t) ? "pre7:FAIL" : "pre7:-   "} ${t.slice(0, 100)}`);
console.log(`count fail rc=${F.rc.size} f2=${F.f2.size} v=${F.v.size}`);
