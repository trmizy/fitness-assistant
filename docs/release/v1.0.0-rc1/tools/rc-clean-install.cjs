// Clean-dependency RC1 build check, OFFLINE (no registry access): detached worktree at HEAD + the RC manifest files, then
// `pnpm install --frozen-lockfile --offline` from the local store, then the same build CI runs for ai-service
// (shared build → ai-service tsc). Never touches the main working tree. Usage: node rc-clean-install.cjs setup|build|teardown
const fs = require("fs"), path = require("path"), { execFileSync, spawnSync } = require("child_process");
const REPO = "C:/D_Backup/project_personal/fitness-assistant";
const WT = "C:/Users/ASUS/AppData/Local/Temp/claude/6757a24c7e7edf08/cd8835cd-7191-4d6e-9f6a-d7d9e3cc625a/scratchpad/rc1-cleaninstall";
const MANIFEST = path.join(__dirname, "..", "r3", "rc-manifest.json");
const git = (a, cwd = REPO) => execFileSync("git", a, { cwd, encoding: "utf8" });
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, encoding: "utf8", shell: true, maxBuffer: 64 << 20 }); return { exit: r.status, out: (r.stdout + r.stderr) }; };
const step = process.argv[2];
if (step === "setup") {
  if (fs.existsSync(WT)) throw new Error("worktree exists — teardown first");
  git(["worktree", "add", "--detach", WT, "HEAD"]);
  const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); let n = 0;
  for (const r of m.rows.filter((r) => r.include)) {
    const dst = path.join(WT, r.file); fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, fs.readFileSync(path.join(REPO, r.file), "utf8").replace(/\r\n/g, "\n")); n++;
  }
  const i = run("pnpm", ["install", "--frozen-lockfile", "--offline", "--reporter=append-only"], WT);
  fs.writeFileSync(path.join(__dirname, "clean-install.log"), i.out);
  console.log(JSON.stringify({ copied: n, installExit: i.exit, tail: i.out.split("\n").filter(Boolean).slice(-6) }));
} else if (step === "build") {
  const res = {};
  for (const [k, args, cwd] of [
    ["sharedBuild", ["--filter", "@gym-coach/shared", "run", "build"], WT],
    ["aiPrismaGenerate", ["--filter", "@gym-coach/ai-service", "run", "db:generate"], WT],
    ["aiTsc", ["--filter", "@gym-coach/ai-service", "run", "build"], WT],
  ]) { const r = run("pnpm", args, cwd); res[k] = { exit: r.exit, tail: r.out.split("\n").filter((l) => /error|ERR|Done|exit/i.test(l)).slice(-8) }; fs.writeFileSync(path.join(__dirname, `clean-${k}.log`), r.out); }
  console.log(JSON.stringify(res, null, 1));
} else if (step === "teardown") {
  git(["worktree", "remove", "--force", WT]);
  console.log("worktree removed; main tree untouched");
}
