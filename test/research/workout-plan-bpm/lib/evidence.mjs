// Append-only evidence helpers: atomic single-line JSONL appends, heartbeat status, and an attempt ledger.
// Nothing here changes product behaviour. Only the run directory is written.
import fs from "node:fs";
import path from "node:path";

export function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // One complete line per write. A crash can at most leave a partial last line, which readJsonl ignores and reports.
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", { encoding: "utf8" });
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return { rows: [], partialTail: false };
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  const rows = [];
  let partialTail = false;
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    try { rows.push(JSON.parse(l)); } catch { if (i === lines.length - 1 || (i === lines.length - 2 && lines[lines.length - 1] === "")) partialTail = true; else throw new Error(`corrupt JSONL line ${i + 1} in ${file}`); }
  });
  return { rows, partialTail };
}

export function writeHeartbeat(file, status) {
  // Atomic replace: write a temp file then rename, so a reader never sees a half-written heartbeat.
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ ...status, heartbeatAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, file);
}
