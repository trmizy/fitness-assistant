// For every included RC file (.ts/.mjs), every RELATIVE import must resolve to a file that is either committed at HEAD
// (unchanged) or itself in the manifest's include set — never to a working-tree-only file outside the RC.
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const REPO = "C:/D_Backup/project_personal/fitness-assistant";
const m = JSON.parse(fs.readFileSync(path.join(__dirname, "rc-manifest.json"), "utf8"));
const included = new Set(m.rows.filter((r) => r.include).map((r) => r.file));
const excluded = new Set(m.rows.filter((r) => !r.include).map((r) => r.file));
const headFiles = new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n"));
const dirty = new Set(execFileSync("git", ["diff", "--name-only", "HEAD"], { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean));
const untracked = new Set(execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean));
const exts = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", "/index.ts", "/index.js"];
const problems = []; let edges = 0;
for (const f of included) {
  if (!/\.(ts|mjs|cjs|js)$/.test(f)) continue;
  const src = fs.readFileSync(path.join(REPO, f), "utf8");
  for (const mm of src.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
    edges++;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), mm[1]));
    const hit = exts.map((e) => base + e).find((c) => fs.existsSync(path.join(REPO, c)) && fs.statSync(path.join(REPO, c)).isFile());
    if (!hit) { problems.push(`${f} -> ${mm[1]} : NOT FOUND`); continue; }
    if (included.has(hit)) continue;
    if (untracked.has(hit)) problems.push(`${f} -> ${hit} : UNTRACKED and not in RC`);
    else if (dirty.has(hit)) problems.push(`${f} -> ${hit} : MODIFIED in working tree but not in RC${excluded.has(hit) ? " (explicitly excluded)" : ""}`);
    else if (!headFiles.has(hit)) problems.push(`${f} -> ${hit} : not in HEAD`);
  }
}
console.log(JSON.stringify({ includedFiles: included.size, relativeImportEdges: edges, problems: problems.length }));
problems.forEach((p) => console.log("  " + p));
