// Simulates the four RC1 commits in a THROWAWAY index (GIT_INDEX_FILE) — never the real index, never the working tree, no
// commit, no ref update (only blob/tree objects are written to the object store). For each step it records the tree id, the
// files changed vs the previous step, and whether every RELATIVE import of a changed .ts/.mjs file resolves inside that tree.
// Usage: node commit-sim.cjs [--write-plan <dir>]
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const REPO = "C:/D_Backup/project_personal/fitness-assistant";
const SP = path.join(__dirname, "..");
const m = JSON.parse(fs.readFileSync(path.join(SP, "r3", "rc-manifest.json"), "utf8"));
const IDX = path.join(os.tmpdir(), `rc1-sim-index-${process.pid}`);
const git = (args, input) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: IDX }, input, maxBuffer: 64 << 20 });
const inc = m.rows.filter((r) => r.include);
const by = (g) => inc.filter((r) => r.group === g).map((r) => r.file);
const B4_PATCHES = ["b4-safety_guard.patch", "b4-intent_router.patch"].map((p) => path.join(SP, "r3", "commit-plan", p));
const COMMITS = [
  { id: "C1", title: "shared contract", add: by("pre-existing dependency") },
  { id: "C2", title: "b4 coach safety", add: by("b4"), patches: B4_PATCHES },
  { id: "C3", title: "AI stabilization (V1 RC1)", add: [...by("V1-RC round (2026-11-12)"), ...by("7-phase / independent-review / stabilization (2026-11-12)"), ...by("MIXED")] },
  { id: "C4", title: "evaluation & test harness", add: [...by("test harness (stack process safety)"), ...by("eval tooling")] },
];
const covered = COMMITS.flatMap((c) => c.add);
if (new Set(covered).size !== inc.length || covered.length !== inc.length) throw new Error(`commit groups cover ${covered.length} (unique ${new Set(covered).size}) of ${inc.length} manifest files`);

function treeFiles(tree) { return new Set(git(["ls-tree", "-r", "--name-only", tree]).split("\n").filter(Boolean)); }
function importProblems(tree, changed) {
  const files = treeFiles(tree), probs = [];
  const exts = ["", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", "/index.ts", "/index.js"];
  for (const f of changed.filter((f) => /\.(ts|mts|mjs|cjs|js)$/.test(f))) {
    const src = git(["cat-file", "-p", `${tree}:${f}`]);
    for (const mm of src.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(f), mm[1]));
      if (!exts.some((e) => files.has(base + e))) probs.push(`${f} -> ${mm[1]}`);
    }
  }
  return probs;
}

git(["read-tree", "HEAD"]);
let prev = git(["write-tree"]).trim();
const out = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim(), steps: [] };
for (const c of COMMITS) {
  for (const p of c.patches ?? []) git(["apply", "--cached", p]);
  git(["add", "--", ...c.add]);
  const tree = git(["write-tree"]).trim();
  const changed = git(["diff", "--name-only", prev, tree]).split("\n").filter(Boolean);
  const unexpected = changed.filter((f) => !c.add.includes(f) && !(c.patches && /intent_router|safety_guard/.test(f)));
  out.steps.push({ id: c.id, title: c.title, tree, files: changed.length, unexpected, importProblems: importProblems(tree, changed) });
  if (c.id === "C2") {
    for (const f of ["safety_guard", "intent_router"]) {
      const staged = git(["cat-file", "-p", `${tree}:backend/services/ai-service/src/llm/${f}.ts`]);
      const b4 = fs.readFileSync(path.join(SP, "r3", "commit-plan", `${f}.B4.ts`), "utf8");
      out.steps.at(-1)[`${f}_equals_HEAD_plus_b4_only`] = staged.replace(/\r\n/g, "\n") === b4.replace(/\r\n/g, "\n");
    }
  }
  prev = tree;
}
// Final tree vs working tree: every manifest file must be byte-identical (modulo line endings) to the working tree.
const final = prev;
const mismatch = inc.map((r) => r.file).filter((f) => git(["cat-file", "-p", `${final}:${f}`]).replace(/\r\n/g, "\n") !== fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n"));
const allChanged = git(["diff", "--name-only", "HEAD", final]).split("\n").filter(Boolean);
out.final = { tree: final, filesChangedVsHead: allChanged.length, notInManifest: allChanged.filter((f) => !covered.includes(f)), manifestFilesDifferingFromWorkingTree: mismatch };
fs.rmSync(IDX, { force: true });
console.log(JSON.stringify(out, null, 1));
const wi = process.argv.indexOf("--write-plan");
if (wi > 0) {
  const dir = process.argv[wi + 1]; fs.mkdirSync(dir, { recursive: true });
  for (const c of COMMITS) fs.writeFileSync(path.join(dir, `${c.id}.files.txt`), c.add.join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "commit-sim-result.json"), JSON.stringify(out, null, 1));
}
