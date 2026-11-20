// READ-ONLY BullMQ inventory of the TEST Redis (:56379, container gymcoach-test-redis-test-1).
// Commands used: LRANGE, ZRANGE, HGETALL — nothing that writes. Prints no payload values except job type/name, ids shortened.
const { execFileSync } = require("child_process");
const C = "gymcoach-test-redis-test-1";
const r = (...a) => execFileSync("docker", ["exec", C, "redis-cli", "--raw", ...a], { encoding: "utf8" }).replace(/\r/g, "").split("\n").filter((x) => x !== "");
const iso = (ms) => (ms ? new Date(Number(ms)).toISOString().replace(".000", "") : "-");
const states = { wait: r("LRANGE", "bull:ai-tasks:wait", "0", "-1"), active: r("LRANGE", "bull:ai-tasks:active", "0", "-1"), completed: r("ZRANGE", "bull:ai-tasks:completed", "0", "-1") };
const rows = [];
for (const [state, ids] of Object.entries(states)) for (const id of ids) {
  const flat = r("HGETALL", `bull:ai-tasks:${id}`); const h = {}; for (let i = 0; i < flat.length; i += 2) h[flat[i]] = flat[i + 1];
  let data = {}; try { data = JSON.parse(h.data ?? "{}"); } catch {}
  let opts = {}; try { opts = JSON.parse(h.opts ?? "{}"); } catch {}
  rows.push({ state, id: id.slice(0, 8), name: h.name, created: iso(h.timestamp), processedOn: iso(h.processedOn), finishedOn: iso(h.finishedOn), attempts: h.atm ?? h.attemptsMade ?? "0", maxAttempts: opts.attempts ?? 1,
    dataKeys: Object.keys(data).sort().join(","), type: data.type ?? data.kind ?? data.jobType ?? data.workflowType ?? "-", hasUser: !!(data.userId || data.payload?.userId), lockedBy: h.pb ?? "-" });
}
if (process.argv.includes("--json")) { console.log(JSON.stringify(rows, null, 1)); process.exit(0); }
const by = (k) => rows.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {});
console.log("total", rows.length, JSON.stringify(by("state")), "names", JSON.stringify(by("name")), "types", JSON.stringify(by("type")));
console.log("dataKeys variants", JSON.stringify(by("dataKeys")));
const days = rows.reduce((m, x) => { const d = `${x.state}:${x.created.slice(0, 10)}`; m[d] = (m[d] ?? 0) + 1; return m; }, {}); console.log("created by state/day", JSON.stringify(days));
for (const x of rows.filter((x) => x.state !== "wait").concat(rows.filter((x) => x.state === "wait").slice(0, 3), rows.filter((x) => x.state === "wait").slice(-3))) console.log(x.state.padEnd(9), x.id, x.name, x.type, "created", x.created, "proc", x.processedOn, "fin", x.finishedOn, "atm", x.attempts + "/" + x.maxAttempts, "pb", x.lockedBy);
const w = rows.filter((x) => x.state === "wait").map((x) => x.created).sort(); console.log("wait created range", w[0], "→", w[w.length - 1]);
