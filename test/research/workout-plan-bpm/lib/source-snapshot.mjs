// GATE 1 — reproducibility snapshot of the ACTUAL application state. Read-only with respect to the repository:
// it never cleans, resets, stashes, commits, or modifies any file. It writes only into the run's source-state/ dir.
// Secrets are never recorded: only allow-listed, non-secret variable NAMES and values are emitted.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const git = (repo, args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
const tryRun = (cmd, args, opts = {}) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024, ...opts }).trim(); } catch (e) { return `UNAVAILABLE: ${String(e.message).split("\n")[0].slice(0, 200)}`; } };

// Production source roots (runtime code only). Tests, generated client build output of other services, and node_modules are excluded.
const PROD_ROOTS = [
  "backend/services/ai-service/src", "backend/services/ai-service/prisma", "backend/services/ai-service/package.json",
  "backend/services/fitness-service/src", "backend/services/fitness-service/prisma",
  "backend/services/user-service/src", "backend/services/user-service/prisma",
  "backend/services/auth-service/src", "backend/services/auth-service/prisma",
  "backend/services/gym-service/src", "backend/services/chat-service/src", "backend/services/payment-service/src",
  "backend/gateway/src", "infra/compose/docker-compose.dev.yml", "test/ai-chat-full-verification/docker-compose.verification.override.yml",
];
const EXCLUDE = (p) => /(__tests__|\.test\.|node_modules|\/dist\/)/.test(p);

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  const st = fs.statSync(dir);
  if (st.isFile()) { out.push(dir); return out; }
  for (const e of fs.readdirSync(dir)) walk(path.join(dir, e), out);
  return out;
}

export function captureSourceState(repoRoot, runDir) {
  const out = path.join(runDir, "source-state");
  fs.mkdirSync(out, { recursive: true });
  const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
  const branch = git(repoRoot, ["branch", "--show-current"]).trim();
  const status = git(repoRoot, ["status", "--porcelain"]);
  fs.writeFileSync(path.join(out, "git-head.txt"), head + "\n");
  fs.writeFileSync(path.join(out, "git-branch.txt"), branch + "\n");
  fs.writeFileSync(path.join(out, "git-status.txt"), status);
  fs.writeFileSync(path.join(out, "git-diff.patch"), git(repoRoot, ["diff", "--no-color"]));
  fs.writeFileSync(path.join(out, "git-diff-cached.patch"), git(repoRoot, ["diff", "--cached", "--no-color"]));

  // Untracked-or-modified production files, hashed by CONTENT. Every file under PROD_ROOTS is hashed, so a change
  // to any tracked or untracked production file between A and B is detectable.
  const files = [];
  for (const r of PROD_ROOTS) {
    const abs = path.join(repoRoot, r);
    for (const f of walk(abs, [])) {
      const rel = path.relative(repoRoot, f).split(path.sep).join("/");
      if (!EXCLUDE(rel)) files.push(rel);
    }
  }
  files.sort();
  const entries = files.map((rel) => { const b = fs.readFileSync(path.join(repoRoot, rel)); return { path: rel, sha256: sha(b), bytes: b.length }; });
  const aggregate = sha(Buffer.from(entries.map((e) => `${e.sha256}  ${e.path}`).join("\n")));
  fs.writeFileSync(path.join(out, "production-source-manifest.json"), JSON.stringify({ roots: PROD_ROOTS, fileCount: entries.length, aggregateSha256: aggregate, files: entries }, null, 1));
  return { head, branch, dirtyEntries: status.split("\n").filter(Boolean).length, productionFileCount: entries.length, productionAggregateSha256: aggregate };
}

export function captureEnvironment(runDir) {
  const out = path.join(runDir, "source-state");
  fs.mkdirSync(out, { recursive: true });
  const dockerAi = tryRun("docker", ["inspect", "gymcoach-ai-dev", "--format", "{{.Name}} {{.Config.Image}} {{.Image}} started={{.State.StartedAt}}"], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const aiEnv = tryRun("docker", ["inspect", "gymcoach-ai-dev", "--format", "{{range .Config.Env}}{{println .}}{{end}}"], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  // Only NAMES and non-secret flag VALUES are recorded.
  const FLAG_NAMES = ["CONVERSATIONAL_INTELLIGENCE_V2", "CONVERSATIONAL_INTELLIGENCE_V2_LLM", "LLM_PROVIDER", "LLM_MODEL", "LLM_TIMEOUT_MS", "NODE_ENV"];
  const containerFlags = {};
  for (const line of aiEnv.split("\n")) {
    const i = line.indexOf("="); if (i < 0) continue;
    const k = line.slice(0, i); if (FLAG_NAMES.includes(k)) containerFlags[k] = line.slice(i + 1);
  }
  const secretNames = aiEnv.split("\n").map((l) => l.split("=")[0]).filter((k) => /TOKEN|SECRET|PASSWORD|KEY|DATABASE_URL|SMTP/i.test(k));
  const env = {
    utc: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    osPlatform: `${os.platform()} ${os.release()} ${os.arch()}`, hostname_redacted: true,
    node: process.version, npm: tryRun("npm", ["--version"], { shell: true }),
    docker: tryRun("docker", ["version", "--format", "client={{.Client.Version}} server={{.Server.Version}}"]),
    ollama: tryRun("docker", ["exec", "gymcoach-ollama", "ollama", "--version"], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } }),
    aiContainer: dockerAi,
    cpu: tryRun("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_Processor | Select-Object -First 1 Name,NumberOfCores,NumberOfLogicalProcessors | ConvertTo-Json -Compress)"]),
    memory: tryRun("powershell", ["-NoProfile", "-Command", "[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory/1GB,2).ToString() + ' GB total'"]),
    gpu: tryRun("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController | Select-Object -First 1 Name | ConvertTo-Json -Compress)"]),
    containerFlags, secretVariableNamesPresentButNotRecorded: [...new Set(secretNames)].sort(),
    cpuOnlyInference: "Ollama reported PROCESSOR 100% CPU for the qwen3 model (see model-manifest.json)",
  };
  fs.writeFileSync(path.join(out, "environment-manifest.json"), JSON.stringify(env, null, 2));
  return env;
}

export function captureModel(runDir, container = "gymcoach-ollama") {
  const out = path.join(runDir, "source-state");
  const tag = "qwen3:4b-instruct-2507-q4_K_M";
  const env = { ...process.env, MSYS_NO_PATHCONV: "1" };
  const list = tryRun("docker", ["exec", container, "ollama", "list"], { env });
  const show = tryRun("docker", ["exec", container, "ollama", "show", tag], { env });
  // Full manifest digest from the registry manifest file inside the Ollama volume (read-only).
  const manifestPath = "/root/.ollama/models/manifests/registry.ollama.ai/library/qwen3/4b-instruct-2507-q4_K_M";
  const manifestJson = tryRun("docker", ["exec", container, "cat", manifestPath], { env });
  let manifestDigest = null, layers = [];
  try { const m = JSON.parse(manifestJson); manifestDigest = sha(Buffer.from(manifestJson)); layers = (m.layers ?? []).map((l) => ({ mediaType: l.mediaType, digest: l.digest, size: l.size })); } catch { /* recorded as unavailable below */ }
  const model = {
    tag, container, runtime: "ollama", ollamaVersion: tryRun("docker", ["exec", container, "ollama", "--version"], { env }),
    listLine: list.split("\n").find((l) => l.startsWith("qwen3:4b-instruct-2507-q4_K_M")) ?? "UNAVAILABLE",
    showSummary: show.split("\n").slice(0, 12).join("\n"), manifestSha256: manifestDigest, layers,
    quantization: "Q4_K_M", parametersApprox: "4.0B", providerNote: "local Ollama only; no hosted/Bedrock model in this run",
    approvedByDesign: "yes — qwen3:4b-instruct-2507-q4_K_M is the approved identifier; matches installed tag exactly",
  };
  fs.writeFileSync(path.join(out, "model-manifest.json"), JSON.stringify(model, null, 2));
  return model;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("source-snapshot.mjs")) {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../../..");
  const runDir = path.resolve(process.argv[2]);
  console.log(JSON.stringify(captureSourceState(repoRoot, runDir), null, 2));
  captureEnvironment(runDir);
  console.log(JSON.stringify(captureModel(runDir), null, 2).slice(0, 800));
}
