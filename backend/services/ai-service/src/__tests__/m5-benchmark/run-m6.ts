/**
 * M6 — Multi-Agent LOCAL RELEASE CANDIDATE: source identity, component inventory, capability matrix (derived from code),
 * gates before/after the recorded adjudication, the 15-item verification matrix and the local RC handoff.
 *   run-m6.ts [--v2-log <file>] [--v1-log <file>] [--tsc-log <file>] [--write]
 * The logs are the outputs of the existing test / typecheck commands (see the handoff §4). --write puts the handoff and
 * the JSON in <worktree>/docs/ai-v2/m6/ (local: the repo hook keeps docs reports out of commits).
 * Offline: no network, DB, Redis or model. LOCAL RC != LIVE VERIFIED != PRODUCTION READY.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { runM51Final, heldoutIntegrity, plannerSha, RUN_FILE, KNOWN_DEFECTS_M51 } from "./run-m51";
import { QUALITY_GATES_M51, evaluateGates } from "./gates";
import { APPROVED_ADJUDICATIONS_M6, resolveFailures } from "./adjudication-m6";
import { ROUTING_CASES_V1 } from "./dataset-v1";
import { ROUTING_CASES_DEV } from "./dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "./dataset-heldout-v2";
import * as trainingAgent from "../../agent-v2/training-agent";
import * as nutritionAgent from "../../agent-v2/nutrition-agent";
import * as recoveryAgent from "../../agent-v2/recovery-agent";
import * as progressAgent from "../../agent-v2/progress-agent";
import * as trainingTools from "../../agent-v2/training-tools";
import * as nutritionTools from "../../agent-v2/nutrition-tools";
import * as recoveryTools from "../../agent-v2/recovery-tools";
import * as progressTools from "../../agent-v2/progress-tools";
import * as supervisor from "../../agent-v2/supervisor";
import * as planner from "../../agent-v2/routing-planner";
import * as bounded from "../../agent-v2/bounded-agent";
import * as registry from "../../agent-v2/tool-registry";
import * as session from "../../agent-v2/session-context";
import * as guards from "../../agent-v2/answer-guards";
import * as minorGate from "../../agent-v2/minor-gate";
import * as turnTrace from "../../agent-v2/turn-trace";
import * as bedrock from "../../agent-v2/bedrock-converse-adapter";
import * as flag from "../../agent-v2/flag";
import type { AgentToolPolicy } from "../../agent-v2/tool-contract";

const HERE = __dirname;
export const WORKTREE = resolve(HERE, "../../../../../..");
const AGENT_V2_DIR = resolve(HERE, "../../agent-v2");
const AI_SRC = "backend/services/ai-service/src";
const sha = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const git = (...args: string[]) => execFileSync("git", args, { cwd: WORKTREE, encoding: "utf8" }).trim();

// ── source identity ──────────────────────────────────────────────────────────────────────────────────────────────────
export function sourceIdentity() {
  const files = readdirSync(AGENT_V2_DIR).filter((f) => f.endsWith(".ts")).sort();
  const manifest = files.map((f) => ({ file: `agent-v2/${f}`, sha256: sha(readFileSync(resolve(AGENT_V2_DIR, f), "utf8")) }));
  const lock = JSON.parse(readFileSync(RUN_FILE, "utf8")) as { plannerSha256: string; heldoutSha256: string };
  const v1Paths = [`${AI_SRC}`, `:(exclude)${AI_SRC}/agent-v2`, `:(exclude)${AI_SRC}/__tests__`, `:(exclude)${AI_SRC}/generated`];
  const hasRc2 = git("tag", "-l", "v1.0.0-rc2") === "v1.0.0-rc2";
  return {
    head: git("rev-parse", "HEAD"), branch: git("branch", "--show-current"),
    agentV2Tree: git("rev-parse", `HEAD:${AI_SRC}/agent-v2`),
    agentV2CleanVsHead: git("status", "--porcelain", "--", `${AI_SRC}/agent-v2`) === "",
    benchmarkCleanVsHead: git("status", "--porcelain", "--", `${AI_SRC}/__tests__`) === "",
    manifest, manifestDigest: sha(manifest.map((m) => `${m.file}:${m.sha256}`).join("\n")),
    plannerSha256: plannerSha(), plannerLockSha256: lock.plannerSha256, plannerLocked: plannerSha() === lock.plannerSha256,
    heldout: heldoutIntegrity(),
    v1RuntimeChangedSinceRc2: hasRc2 ? git("diff", "--name-only", "v1.0.0-rc2", "HEAD", "--", ...v1Paths).split("\n").filter(Boolean) : null,
    otherRepoPathsChangedSinceRc2: hasRc2 ? git("diff", "--name-only", "v1.0.0-rc2", "HEAD", "--", ".", `:(exclude)${AI_SRC}`).split("\n").filter(Boolean) : null,
    v1RuntimeWorkingTreeChanges: git("status", "--porcelain", "--", ...v1Paths).split("\n").filter(Boolean),
    generatedPrismaModified: git("status", "--porcelain", "--", `${AI_SRC}/generated`).split("\n").filter(Boolean).length,
  };
}

// ── capability matrix (from the frozen policies and contracts) ──────────────────────────────────────────────────────
const AGENT_DEFS = [
  { agent: "Training", prefix: "training.", policy: trainingTools.TRAINING_AGENT_PILOT_POLICY, contracts: trainingTools.TRAINING_TOOL_CONTRACTS, personal: trainingAgent.TRAINING_PERSONAL_TOOLS },
  { agent: "Nutrition", prefix: "nutrition.", policy: nutritionTools.NUTRITION_AGENT_PILOT_POLICY, contracts: nutritionTools.NUTRITION_TOOL_CONTRACTS, personal: nutritionAgent.NUTRITION_PERSONAL_TOOLS },
  { agent: "Recovery", prefix: "recovery.", policy: recoveryTools.RECOVERY_AGENT_PILOT_POLICY, contracts: recoveryTools.RECOVERY_TOOL_CONTRACTS, personal: recoveryAgent.RECOVERY_PERSONAL_TOOLS },
  { agent: "Progress", prefix: "progress.", policy: progressTools.PROGRESS_AGENT_PILOT_POLICY, contracts: progressTools.PROGRESS_TOOL_CONTRACTS, personal: progressAgent.PROGRESS_PERSONAL_TOOLS },
] as const;

export function capabilityMatrix() {
  return AGENT_DEFS.map((d) => {
    const kindOf = (id: string) => (d.contracts as ReadonlyArray<{ id: string; kind: string }>).find((c) => c.id === id)?.kind ?? "UNKNOWN";
    const offered = d.policy.allowedTools.map((id) => ({ id, kind: kindOf(id), personal: d.personal.has(id) }));
    const notOffered = (d.contracts as ReadonlyArray<{ id: string; kind: string }>).filter((c) => !d.policy.allowedTools.includes(c.id)).map((c) => ({ id: c.id, kind: c.kind }));
    const policy: AgentToolPolicy = d.policy;
    return {
      agent: d.agent, policyId: policy.agentId, allowDraft: policy.allowDraft, offered, notOffered,
      readOnly: offered.every((t) => t.kind === "READ") && policy.allowDraft === false,
      frozen: Object.isFrozen(policy) && Object.isFrozen(policy.allowedTools),
      namespaced: offered.every((t) => t.id.startsWith(d.prefix)),
    };
  });
}

// ── component inventory ──────────────────────────────────────────────────────────────────────────────────────────────
export function componentChecks(provenanceOk: boolean) {
  const fn = (x: unknown) => typeof x === "function";
  const m = capabilityMatrix();
  const cap = (a: string) => m.find((x) => x.agent === a)!;
  const okAgent = (a: string) => cap(a).readOnly && cap(a).frozen && cap(a).namespaced;
  const B = supervisor.SUPERVISOR_BUDGET;
  return [
    { component: "Training Agent", where: "training-agent.ts, training-tools.ts", ok: fn(trainingAgent.runTrainingAgentTurn) && okAgent("Training") },
    { component: "Nutrition Agent", where: "nutrition-agent.ts, nutrition-tools.ts", ok: fn(nutritionAgent.runNutritionAgentTurn) && okAgent("Nutrition") },
    { component: "Recovery Agent", where: "recovery-agent.ts, recovery-tools.ts", ok: fn(recoveryAgent.runRecoveryAgentTurn) && okAgent("Recovery") },
    { component: "Progress Agent", where: "progress-agent.ts, progress-tools.ts", ok: fn(progressAgent.runProgressAgentTurn) && okAgent("Progress") },
    { component: "Multi-Agent Supervisor", where: "supervisor.ts, multi-agent-contracts.ts", ok: fn(supervisor.runSupervisorTurn) && fn(supervisor.createBoundedAgentRunner) },
    { component: "Intent-v1.1 routing (locked)", where: "routing-planner.ts", ok: planner.createIntentDecisionProvider({ maxAgents: 2 }).name === "intent-v1.1" && plannerSha() === (JSON.parse(readFileSync(RUN_FILE, "utf8")) as { plannerSha256: string }).plannerSha256 },
    { component: "Bounded Agent Engine", where: "bounded-agent.ts", ok: fn(bounded.runBoundedAgentTurn) && bounded.PILOT_LIMITS.maxToolCalls === 4 && bounded.PILOT_LIMITS.maxModelCalls === 5 },
    { component: "Tool Registry + capability isolation", where: "tool-registry.ts, tool-contract.ts", ok: fn(registry.createToolRegistry) && m.every((x) => x.readOnly && x.frozen && x.namespaced) },
    { component: "Session Context (in-memory)", where: "session-context.ts", ok: fn(session.createInMemorySessionStore) && fn(session.reusableContext) && session.MAX_REUSED_ENTRIES === 12 },
    { component: "Evidence provenance", where: "multi-agent-contracts.ts (AgentEvidence), supervisor.ts", ok: provenanceOk },
    { component: "Safety Guards", where: "answer-guards.ts", ok: [guards.checkInputSafety, guards.guardTrainingAnswer, guards.guardNutritionAnswer, guards.guardRecoveryAnswer, guards.guardProgressAnswer].every(fn) },
    { component: "Minor Gate (Gate 1)", where: "minor-gate.ts", ok: fn(minorGate.decideMinorGate) && fn(minorGate.resolveAgeVerdict) },
    { component: "Global Budget", where: "supervisor.ts", ok: fn(supervisor.grantBudget) && supervisor.DEFAULT_EXECUTION_POLICY.maxAgentsPerTurn === 2 && B.maxWallTimeMs === 60_000 && B.maxModelCalls === 8 && B.maxToolCalls === 6 && B.maxInputTokens === 60_000 && B.maxOutputTokens === 6_000 && B.maxCostUsd === 0.08 },
    { component: "Tracing", where: "turn-trace.ts, SupervisorTrace", ok: fn(turnTrace.summarizeTurnTraces) },
    { component: "Bedrock Converse Adapter (not called)", where: "bedrock-converse-adapter.ts", ok: fn(bedrock.createBedrockConverseProvider) && fn(bedrock.buildConverseInput) && fn(bedrock.parseConverseResponse) },
    { component: "Feature flag AI_AGENT_V2 (default OFF)", where: "flag.ts", ok: flag.isAgentV2Enabled({}) === false && flag.isAgentV2Enabled({ AI_AGENT_V2: "on" }) === true },
  ];
}

// ── evaluation: M5.1 gates re-run, then the recorded adjudication applied to G9 ────────────────────────────────────
export async function runM6Evaluation() {
  const r = await runM51Final();
  const before = r.gates;
  const adj = resolveFailures(r.execution.assertions, r.execution.observations, APPROVED_ADJUDICATIONS_M6, ROUTING_CASES_V1);
  const values: Record<string, number> = { ...r.values, "execution.unresolvedFailedAssertions": adj.unresolved.length };
  const after = evaluateGates(values, QUALITY_GATES_M51);
  return { r, before, after, adj, values };
}

// ── test-log parsing (outputs of the existing commands) ────────────────────────────────────────────────────────────
export interface NodeTestLog { tests: number; pass: number; fail: number; todo: number; passed: string[]; todos: string[] }
export function parseNodeTestLog(file: string): NodeTestLog {
  const t = readFileSync(file, "utf8");
  const n = (k: string) => Number((new RegExp(`^ℹ ${k} (\\d+)`, "m").exec(t) ?? [])[1] ?? NaN);
  const lines = t.split(/\r?\n/);
  return { tests: n("tests"), pass: n("pass"), fail: n("fail"), todo: n("todo"), passed: lines.filter((l) => l.startsWith("✔ ")).map((l) => l.slice(2)), todos: [...new Set(lines.filter((l) => l.startsWith("⚠ ")).map((l) => l.slice(2)))] };
}
export function parseTscLog(file: string) {
  const t = readFileSync(file, "utf8");
  return { exit: Number((/TSC_EXIT=(\d+)/.exec(t) ?? [])[1] ?? NaN), errors: (t.match(/error TS\d+/g) ?? []).length };
}

// ── 15-item verification matrix ─────────────────────────────────────────────────────────────────────────────────────
const VERIFY: ReadonlyArray<{ item: string; tests?: string[]; scenarios?: string[]; special?: "v2" | "v1" | "tsc" | "isolation" }> = [
  { item: "1. Full V2 tests", special: "v2" },
  { item: "2. V1 LLM regression", special: "v1" },
  { item: "3. TypeScript typecheck", special: "tsc" },
  { item: "4. Static V1/V2 isolation", special: "isolation", tests: ["no V1 module imports agent-v2", "nothing outside agent-v2 reads AI_AGENT_V2", "agent-v2 registers no routes", "V2 WRITE contracts have no handler"] },
  { item: "5. M5/M5.1 benchmark regression", tests: ["M5-1 ", "M5-2 ", "M5-3 ", "M5-4 ", "M5-5 ", "M5-6 ", "M5-7 ", "M5-8 ", "M51-1 ", "M51-2 ", "M51-3 ", "M51-4 ", "M51-5 ", "M51-6 ", "M51-7 ", "M51-8 ", "M51-9 "] },
  { item: "6. Multi-agent mock end-to-end", tests: ["M4-3 ", "P-3 ", "P-4 "], scenarios: ["X-S1", "X-S2", "X-S3", "X-S4", "X-P1", "X-P2", "X-P3", "X-P4", "X-P5", "X-P6", "X-P7"] },
  { item: "7. Feature flag OFF", tests: ["M4-17 "], scenarios: ["X-SEC8"] },
  { item: "8. Cross-user isolation", tests: ["M4-8 "], scenarios: ["MT06", "MT07", "X-SEC3", "X-SEC4"] },
  { item: "9. No unauthorized WRITE", tests: ["V2 WRITE contracts have no handler"], scenarios: ["X-SEC1", "X-SEC2", "S09"] },
  { item: "10. Context expiry / invalidation", tests: ["M4-7 "], scenarios: ["MT03", "MT04", "MT12"] },
  { item: "11. Forecast vs observation", tests: ["M4-6 ", "P-12 "], scenarios: ["X-E6", "MT05"] },
  { item: "12. Prompt injection", tests: ["M4-9 ", "P-19/P-20 "], scenarios: ["X-SEC5", "MT08", "S09"] },
  { item: "13. Minor safety", tests: ["M4-13 ", "P-17 "], scenarios: ["X-SEC6", "X-SEC7", "MT11", "S02"] },
  { item: "14. Global budget", tests: ["R-16 ", "M4-3 "], scenarios: ["X-B1", "X-B2", "X-B3"] },
  { item: "15. Trace privacy", tests: ["M4-16 ", "R-21 ", "P-24 ", "privacy: no question text"] },
];

export function verificationMatrix(ev: Awaited<ReturnType<typeof runM6Evaluation>>, id: ReturnType<typeof sourceIdentity>, logs: { v2?: NodeTestLog; v1?: NodeTestLog; tsc?: ReturnType<typeof parseTscLog> }) {
  const accepted = new Set(ev.adj.resolved.map((c) => c.key));
  const scenarioStatus = (sid: string) => {
    const xs = ev.r.execution.assertions.filter((a) => a.scenario.split(" ")[0] === sid);
    if (!xs.length) return { sid, status: "MISSING" as const, n: 0 };
    const bad = xs.filter((a) => !a.pass && !accepted.has(`${a.scenario}|${a.name}`));
    const adjudicated = xs.some((a) => !a.pass && accepted.has(`${a.scenario}|${a.name}`));
    return { sid, status: bad.length ? ("FAIL" as const) : adjudicated ? ("PASS_ADJUDICATED" as const) : ("PASS" as const), n: xs.length };
  };
  const testStatus = (prefix: string) => (!logs.v2 ? "NOT_RUN" : logs.v2.passed.some((l) => l.startsWith(prefix)) ? "PASS" : "NOT_FOUND_OR_FAILED");
  return VERIFY.map((v) => {
    const tests = (v.tests ?? []).map((p) => ({ test: p.trim(), status: testStatus(p) }));
    const scenarios = (v.scenarios ?? []).map(scenarioStatus);
    let special: { ok: boolean | null; detail: string } | null = null;
    if (v.special === "v2") special = logs.v2 ? { ok: logs.v2.fail === 0 && logs.v2.tests > 0, detail: `${logs.v2.pass} pass, ${logs.v2.fail} fail, ${logs.v2.todo} todo / ${logs.v2.tests}` } : { ok: null, detail: "log not provided" };
    if (v.special === "v1") special = logs.v1 ? { ok: logs.v1.fail === 0 && logs.v1.tests > 0, detail: `${logs.v1.pass}/${logs.v1.tests} pass, ${logs.v1.fail} fail` } : { ok: null, detail: "log not provided" };
    if (v.special === "tsc") special = logs.tsc ? { ok: logs.tsc.exit === 0 && logs.tsc.errors === 0, detail: `exit ${logs.tsc.exit}, ${logs.tsc.errors} errors` } : { ok: null, detail: "log not provided" };
    if (v.special === "isolation") special = { ok: id.v1RuntimeChangedSinceRc2 !== null && id.v1RuntimeChangedSinceRc2.length === 0 && id.v1RuntimeWorkingTreeChanges.length === 0, detail: `V1 runtime files changed since v1.0.0-rc2: ${id.v1RuntimeChangedSinceRc2 === null ? "tag missing" : id.v1RuntimeChangedSinceRc2.length}; uncommitted V1 runtime changes: ${id.v1RuntimeWorkingTreeChanges.length}` };
    const ok = (special ? special.ok === true : true) && tests.every((t) => t.status === "PASS") && scenarios.every((s) => s.status === "PASS" || s.status === "PASS_ADJUDICATED");
    return { item: v.item, ok, special, tests, scenarios };
  });
}

// ── known issues register ────────────────────────────────────────────────────────────────────────────────────────────
export type IssueClass = "BLOCKER FOR LOCAL RC" | "BLOCKER FOR LIVE EVALUATION" | "BLOCKER FOR AWS DEPLOYMENT" | "ACCEPTED LOCAL LIMITATION";
export interface KnownIssue { id: string; title: string; evidence: string; verifiedBy: string; cls: IssueClass; note: string }
export function knownIssues(ev: Awaited<ReturnType<typeof runM6Evaluation>>): KnownIssue[] {
  const cand = ev.r.heldout.metrics.find((m) => m.config === "intent-v1.1")!;
  const review = (xs: readonly { review?: true }[]) => xs.filter((c) => c.review).length;
  return [
    { id: "P05", title: "Off-topic false positive: 'cuối' → 'cuoi' khớp mẫu 'cưới' của V1 (nhánh bỏ dấu của checkInputSafety V2)", evidence: "M5 P05; M5.1 DEV D-A12; heldout H-N06, H-P05; docs/ai-v2/m5.1/P05-V1-SAFETY-HANDOFF-vi.md", verifiedBy: "CODE AUDIT + OFFLINE BENCHMARK", cls: "BLOCKER FOR AWS DEPLOYMENT", note: "Chặn nhầm câu hợp lệ (thất bại an toàn, sai trải nghiệm). Chưa sửa; cần chủ sở hữu V1 safety quyết định trước khi người dùng có thể chạm tới V2." },
    { id: "KD-1", title: KNOWN_DEFECTS_M51[0].text, evidence: "agent-v2-routing-m51.test.ts M51-6b (todo)", verifiedBy: "VERIFIED BY TEST (todo, đang lỗi)", cls: "ACCEPTED LOCAL LIMITATION", note: "Chọn thừa/sai agent chỉ-đọc; sửa = candidate mới + heldout mới." },
    { id: "KD-2", title: KNOWN_DEFECTS_M51[1].text, evidence: "agent-v2-routing-m51.test.ts M51-6b (todo)", verifiedBy: "VERIFIED BY TEST (todo, đang lỗi)", cls: "ACCEPTED LOCAL LIMITATION", note: "Như KD-1." },
    { id: "R-3RD", title: `Một số nhu cầu thứ ba không được nhận diện nên không được báo hoãn (heldout v2: UNREPORTED_DEFERRED_INTENT = ${cand.errors.UNREPORTED_DEFERRED_INTENT})`, evidence: "Báo cáo M5.1 §13 (thiếu/chồng lấn lexicon, 'lẫn', 'xem' trơn)", verifiedBy: "OFFLINE BENCHMARK", cls: "ACCEPTED LOCAL LIMITATION", note: "Mọi agent HỆ THỐNG hoãn đều được báo (100%); phần router không thấy thì không được báo." },
    { id: "EVAL-AUTHOR", title: "Heldout v2 do cùng tác giả viết heldout, DEV và router (đã đọc heldout trước khi tinh chỉnh DEV)", evidence: "heldout-v2.freeze.json; báo cáo M5.1 §5", verifiedBy: "Ghi nhận quy trình", cls: "ACCEPTED LOCAL LIMITATION", note: "Số liệu heldout v2 không phải đánh giá độc lập đã được chuyên gia thẩm định." },
    { id: "LABEL-REVIEW", title: `Nhãn cần người thứ hai / chuyên gia: heldout v2 ${review(ROUTING_CASES_HELDOUT_V2)} ca, v1 ${review(ROUTING_CASES_V1)} ca, DEV ${review(ROUTING_CASES_DEV)} ca`, evidence: "cờ review trong dataset", verifiedBy: "Dataset", cls: "ACCEPTED LOCAL LIMITATION", note: "Chưa có inter-annotator agreement." },
    { id: "ADJ-OWNER", title: "G9 đạt nhờ phê duyệt kỹ thuật của chủ dự án cho S02/S09 — không phải thẩm định chuyên gia độc lập", evidence: "adjudication-m6.ts", verifiedBy: "Ghi nhận phê duyệt", cls: "ACCEPTED LOCAL LIMITATION", note: "Nhãn gốc và guard không đổi." },
    { id: "SESSION-MEM", title: "Session context chỉ in-memory (Map trong process), chưa persistent", evidence: "session-context.ts createInMemorySessionStore", verifiedBy: "CODE AUDIT", cls: "BLOCKER FOR AWS DEPLOYMENT", note: "Lambda/nhiều instance không chia sẻ bộ nhớ → mất ngữ cảnh nhiều lượt; cần store bền, cô lập theo user, có TTL." },
    { id: "AGE-READER", title: "Chưa có reader tuổi thật 4 trạng thái (PROFILE_OK / AGE_UNKNOWN / PROFILE_ACCESS_DENIED / PROFILE_UNAVAILABLE)", evidence: "chỉ multi-agent-contracts.ts + supervisor.ts định nghĩa; supervisor thiếu reader → PROFILE_UNAVAILABLE (fail closed)", verifiedBy: "CODE AUDIT", cls: "BLOCKER FOR LIVE EVALUATION", note: "Không có reader thật thì mọi yêu cầu cá nhân bị từ chối an toàn; không đánh giá live có ý nghĩa với hồ sơ thật." },
    { id: "RC3-AUTH", title: "RC3 fitness internal-auth chưa xác minh runtime (hotfix fail-closed 14716edf còn local; preflight NO-GO; env/exposure UNKNOWN)", evidence: "báo cáo phiên trước (docs/release/v1.0.0-rc3/*) — KHÔNG kiểm lại trong M6", verifiedBy: "REPORTED EARLIER, NOT RE-VERIFIED", cls: "BLOCKER FOR LIVE EVALUATION", note: "Chặn mọi đánh giá live đọc dữ liệu fitness trên AWS DEV và chặn deploy." },
    { id: "FITNESS-PATH", title: "Đường gọi fitness-service của reader Recovery/Progress chưa xác minh trên AWS", evidence: "services/enterprise-data/{training,workout,body-goal}.reader.ts gọi axios.get(FITNESS_SERVICE_URL…) trực tiếp, trong khi client V1 khác dùng requestService (service-lambda.client)", verifiedBy: "CODE AUDIT", cls: "BLOCKER FOR AWS DEPLOYMENT", note: "Cũng chặn một lần đánh giá live chạy trên AWS." },
    { id: "TZ-UTC", title: "Ngày 'hôm qua' của Recovery và nhãn ngày tính theo UTC, lịch hôm nay của Training theo Asia/Ho_Chi_Minh", evidence: "supervisor.ts:141 (recoveryFacts), recovery-tools.ts:123, progress-tools.ts:48; fitness-agent-tools.ts getTodaySchedule dùng Asia/Ho_Chi_Minh", verifiedBy: "CODE AUDIT", cls: "BLOCKER FOR AWS DEPLOYMENT", note: "00:00–07:00 giờ VN có thể lệch một ngày; đánh giá live cần tránh hoặc gắn cờ khung giờ này." },
    { id: "NOVA", title: "Chưa kiểm chứng Nova Pro thật (mọi kết quả dùng mock model có kịch bản)", evidence: "benchmark M5/M5.1/M6", verifiedBy: "NOT VERIFIED BY LIVE MODEL", cls: "BLOCKER FOR AWS DEPLOYMENT", note: "Là mục tiêu của giai đoạn đánh giá live (cần phê duyệt riêng)." },
    { id: "NOT-WIRED", title: "Chưa nối /ai/ask, không có HTTP boundary; flag mặc định OFF", evidence: "agent-v2-isolation.test.ts; flag.ts", verifiedBy: "VERIFIED BY TEST", cls: "BLOCKER FOR AWS DEPLOYMENT", note: "Đúng thiết kế cho local RC; tích hợp cần thiết kế + phê duyệt riêng." },
    { id: "GOV", title: "Lệch governance: V2/multi-agent xây trên nhánh từ V1 RC (không phải V1 Stable); chưa có tag V1 Stable và rollback drill", evidence: "multi-agent-contracts.ts header; flag.ts; governance §2/§3", verifiedBy: "Ghi nhận", cls: "BLOCKER FOR AWS DEPLOYMENT", note: "Cần V1 Stable + runbook rollback trước khi có traffic." },
    { id: "MOCK-PERF", title: "Token/chi phí/độ trễ là số mock; race thời gian thực (setTimeout) không đo dưới đồng hồ ảo", evidence: "báo cáo M5 §12", verifiedBy: "OFFLINE BENCHMARK", cls: "ACCEPTED LOCAL LIMITATION", note: "" },
    { id: "NO-DB-TESTS", title: "Không chạy test cần DB/Redis (Redis test dùng chung, 50 job BullMQ cũ)", evidence: "ràng buộc phiên", verifiedBy: "Ghi nhận", cls: "ACCEPTED LOCAL LIMITATION", note: "V2 offline-only; reader thật chỉ được mock." },
  ];
}

// ── handoff ──────────────────────────────────────────────────────────────────────────────────────────────────────────
type Ev = Awaited<ReturnType<typeof runM6Evaluation>>;
export function releaseCriteria(ev: Ev, id: ReturnType<typeof sourceIdentity>, logs: { v2?: NodeTestLog; v1?: NodeTestLog; tsc?: ReturnType<typeof parseTscLog> }, handoffWritten: boolean) {
  const G = Object.fromEntries(ev.after.map((g) => [g.id, g]));
  const ex = ev.r.executionSummary;
  return [
    { criterion: "G1–G8 PASS", ok: ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"].every((k) => G[k].pass) },
    { criterion: "G9 PASS (assertions hoặc adjudication đã duyệt)", ok: G.G9.pass },
    { criterion: "G10 PASS", ok: G.G10.pass },
    { criterion: "V2 tests PASS", ok: !!logs.v2 && logs.v2.fail === 0 && logs.v2.tests > 0 },
    { criterion: "V1 LLM regression PASS", ok: !!logs.v1 && logs.v1.fail === 0 && logs.v1.tests > 0 },
    { criterion: "Typecheck PASS", ok: !!logs.tsc && logs.tsc.exit === 0 && logs.tsc.errors === 0 },
    { criterion: "Không thay đổi V1 runtime", ok: id.v1RuntimeChangedSinceRc2 !== null && id.v1RuntimeChangedSinceRc2.length === 0 && id.v1RuntimeWorkingTreeChanges.length === 0 && (id.otherRepoPathsChangedSinceRc2 ?? ["?"]).length === 0 },
    { criterion: "Không gọi live/provider/network", ok: ev.r.execution.counters.netCalls === 0 },
    { criterion: "Không lỗi bảo mật critical", ok: ex.criticalSafetyViolations === 0 && ex.crossUserLeaks === 0 && ev.values["execution.writeCalls"] === 0 },
    { criterion: "Định danh RC sạch (agent-v2 = HEAD, planner khóa, heldout nguyên vẹn)", ok: id.agentV2CleanVsHead && id.plannerLocked && id.heldout.ok },
    { criterion: "Local RC handoff đầy đủ (13 mục)", ok: handoffWritten },
  ];
}

export function buildHandoff(ev: Ev, id: ReturnType<typeof sourceIdentity>, comps: ReturnType<typeof componentChecks>, matrix: ReturnType<typeof capabilityMatrix>, verify: ReturnType<typeof verificationMatrix>, issues: KnownIssue[], criteria: ReturnType<typeof releaseCriteria>, logs: { v2?: NodeTestLog; v1?: NodeTestLog; tsc?: ReturnType<typeof parseTscLog> }): string {
  const L: string[] = [];
  const done = criteria.every((c) => c.ok);
  const Gb = Object.fromEntries(ev.before.map((g) => [g.id, g]));
  const Ga = Object.fromEntries(ev.after.map((g) => [g.id, g]));
  const Mh = Object.fromEntries(ev.r.heldout.metrics.map((m) => [m.config, m]));
  const Md = Object.fromEntries(ev.r.dev.metrics.map((m) => [m.config, m]));
  const Mv = Object.fromEntries(ev.r.v1.metrics.map((m) => [m.config, m]));
  const frac = (o: { n: number; d: number; pct: number | null }) => `${o.n}/${o.d} (${o.pct ?? "—"}%)`;
  const em = ev.r.executionSummary.metrics as Record<string, { pass: number; total: number }>;
  L.push(`# Gymini Multi-Agent — M6 Local Release Candidate (handoff)`, "");
  L.push(`> **LOCAL RC != LIVE VERIFIED != PRODUCTION READY.** Sinh bởi \`run-m6.ts --write\` từ kết quả chạy thật. Nhãn bằng chứng: **VERIFIED BY OFFLINE BENCHMARK**, **VERIFIED BY TEST**, **NOT VERIFIED BY LIVE MODEL**, **NOT VERIFIED BY REAL INFRASTRUCTURE**. Mock end-to-end KHÔNG phải production E2E.`, "");
  L.push(`**Trạng thái: M6 Local RC ${done ? "DONE" : "NOT READY"}.** Commit \`${id.head}\` (nhánh \`${id.branch}\`).`, "");

  L.push(`## 1. Tóm tắt kiến trúc`, "");
  for (const s of [
    "Một lượt (supervisor.ts): flag AI_AGENT_V2 (mặc định OFF) → identity từ request đã xác thực → kiểm tra độ dài → **V1 input safety** (checkInputSafety, câu gốc + bỏ dấu) → nạp session (userId, sessionId) → **routing intent-v1.1** (chỉ đặt tên agent) → supervisor kiểm lại agent hợp lệ, cap 2 agent, ghi phần hoãn → **Gate 1** (một lần đọc hồ sơ 4 trạng thái, minor gate; AGE_UNKNOWN + yêu cầu rủi ro cao → fail closed) → delegation tuần tự, mỗi agent nhận một lát từ ngân sách CÒN LẠI của lượt.",
    "Mỗi agent (bounded-agent.ts): input safety + Gate 1 lặp lại → yêu cầu thay đổi dữ liệu → CONFIRMATION_REQUIRED (không gọi model) → vòng model có giới hạn với tool registry CHỈ ĐỌC (allowlist cố định, kiểm tra identity trong tham số, id provenance, quét cross-user, zod vào/ra) → guard theo domain (fidelity, số liệu, forecast/e1RM/mục tiêu, kcal sàn, chẩn đoán…).",
    "Giữa các agent chỉ truyền **fact có kiểu** (không truyền văn bản agent). Supervisor hòa giải xung đột (lịch vs lời kể, forecast vs số đo, nhân quả), ghép câu trả lời theo phần, nêu phần bị hoãn, thêm dòng 'Cơ sở' theo loại bằng chứng.",
    "Session context: chỉ lưu fact từ tool, lời kể của người dùng, forecast, conflict — không bao giờ lưu văn bản agent; TTL 30 phút (tool) / 6 giờ (lời kể); làm mới thất bại → vô hiệu hóa giá trị cũ.",
    "Trace: chỉ mã/số đếm (không câu hỏi, câu trả lời, user id, token, dữ liệu). Model: interface AgentModelProvider; adapter Bedrock Converse có sẵn nhưng KHÔNG được gọi ở đâu trong M6.",
  ]) L.push(`- ${s}`);
  L.push("");

  L.push(`## 2. Ma trận agent / tool (sinh từ policy + contract)`, "");
  L.push("| Agent | Policy | Tool được cấp (kind, cá nhân?) | Contract KHÔNG cấp | Chỉ đọc | Frozen | Namespaced |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const m of matrix) L.push(`| ${m.agent} (${m.offered.length}) | \`${m.policyId}\`, allowDraft=${m.allowDraft} | ${m.offered.map((t) => `\`${t.id}\` ${t.kind}${t.personal ? " · cá nhân" : ""}`).join("<br>")} | ${m.notOffered.map((t) => `\`${t.id}\` ${t.kind}`).join("<br>") || "—"} | ${m.readOnly ? "có" : "KHÔNG"} | ${m.frozen ? "có" : "KHÔNG"} | ${m.namespaced ? "có" : "KHÔNG"} |`);
  L.push("", `Kiểm kê thành phần:`, "");
  L.push("| Thành phần | Vị trí | Có mặt và đúng cấu hình |", "| --- | --- | --- |");
  for (const c of comps) L.push(`| ${c.component} | ${c.where} | ${c.ok ? "có" : "**KHÔNG**"} |`);
  L.push("");

  L.push(`## 3. Định danh source / artifact`, "");
  L.push(`- Commit: \`${id.head}\` — nhánh \`${id.branch}\`. Không push, không tag, không build artifact (quy trình build hiện có là \`tsc\`; độ biên dịch được xác minh bằng \`tsc --noEmit\`).`);
  L.push(`- Tree \`agent-v2\` tại HEAD: \`${id.agentV2Tree}\`; cây làm việc agent-v2 khớp HEAD: ${id.agentV2CleanVsHead ? "có" : "**KHÔNG**"}; benchmark/test khớp HEAD: ${id.benchmarkCleanVsHead ? "có" : "KHÔNG (có thay đổi chưa commit)"}.`);
  L.push(`- Manifest digest (sha256 các file agent-v2, chuẩn hóa LF): \`${id.manifestDigest}\` (${id.manifest.length} file).`);
  L.push(`- Planner intent-v1.1 sha256 \`${id.plannerSha256}\` = khóa heldout: ${id.plannerLocked ? "có" : "**KHÔNG**"}. Heldout v2 sha256 \`${id.heldout.actual}\` khớp freeze: ${id.heldout.ok ? "có" : "**KHÔNG**"}.`);
  L.push(`- V1 runtime (ai-service src ngoài agent-v2/__tests__/generated) thay đổi từ \`v1.0.0-rc2\`: ${id.v1RuntimeChangedSinceRc2 === null ? "không kiểm được (thiếu tag)" : id.v1RuntimeChangedSinceRc2.length}; đường dẫn khác của repo thay đổi từ rc2: ${id.otherRepoPathsChangedSinceRc2 === null ? "?" : id.otherRepoPathsChangedSinceRc2.length}; thay đổi V1 runtime chưa commit: ${id.v1RuntimeWorkingTreeChanges.length}. File generated/prisma đang modified (không stage, do \`prisma generate\`): ${id.generatedPrismaModified}.`, "");
  L.push("<details><summary>Manifest agent-v2</summary>", "", "| File | sha256 |", "| --- | --- |");
  for (const m of id.manifest) L.push(`| ${m.file} | \`${m.sha256}\` |`);
  L.push("", "</details>", "");

  L.push(`## 4. Lệnh tái lập`, "", "```");
  L.push("cd backend/services/ai-service");
  L.push("FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/agent-v2-*.test.ts            # V2 (gồm isolation, M5, M5.1, M6)");
  L.push("FITNESS_DISABLE_REDIS=true npx tsx --test src/llm/__tests__/*.test.ts                 # V1 LLM regression");
  L.push("npx tsc --noEmit -p tsconfig.json                                                    # typecheck");
  L.push("FITNESS_DISABLE_REDIS=true npx tsx src/__tests__/m5-benchmark/run-m6.ts --v2-log <v2.log> --v1-log <v1.log> --tsc-log <tsc.log> --write");
  L.push("```", "", "Tất cả offline: không mạng, DB, Redis, Docker, AWS hay model thật.", "");

  L.push(`## 5. Kết quả test và ma trận xác minh (15 mục)`, "");
  L.push(`- V2: ${logs.v2 ? `${logs.v2.pass} pass, ${logs.v2.fail} fail, ${logs.v2.todo} todo / ${logs.v2.tests}` : "chưa cung cấp log"}${logs.v2?.todos.length ? ` — todo: ${logs.v2.todos.map((t) => t.replace(/ \(\d.*$/, "")).join("; ")}` : ""}. **VERIFIED BY TEST**`);
  L.push(`- V1 LLM: ${logs.v1 ? `${logs.v1.pass}/${logs.v1.tests} pass, ${logs.v1.fail} fail` : "chưa cung cấp log"}. **VERIFIED BY TEST**`);
  L.push(`- Typecheck: ${logs.tsc ? `exit ${logs.tsc.exit}, ${logs.tsc.errors} lỗi` : "chưa cung cấp log"}.`, "");
  L.push("| Mục | Kết quả | Bằng chứng |", "| --- | --- | --- |");
  for (const v of verify) {
    const parts = [
      ...(v.special ? [v.special.detail] : []),
      ...v.tests.map((t) => `test \`${t.test}\` ${t.status}`),
      ...v.scenarios.map((s) => `kịch bản ${s.sid} ${s.status} (${s.n} assertion)`),
    ];
    L.push(`| ${v.item} | ${v.ok ? "PASS" : "**FAIL**"} | ${parts.join("; ")} |`);
  }
  L.push("", `Mock end-to-end = supervisor + 4 agent + tool registry thật trong một process, model MOCK có kịch bản, dữ liệu tổng hợp theo user. **NOT VERIFIED BY LIVE MODEL / REAL INFRASTRUCTURE.**`, "");

  L.push(`## 6. Kết quả benchmark`, "");
  L.push("| Bộ | Cấu hình | Exact-set ≤2 | Primary coverage | Ghi chú |", "| --- | --- | --- | --- | --- |");
  L.push(`| Heldout v2 (${ROUTING_CASES_HELDOUT_V2.length}) | intent-v1.1 | ${frac(Mh["intent-v1.1"].exactSetLe2)} | ${frac(Mh["intent-v1.1"].primaryCoverage)} | đánh giá gate; cùng tác giả, chưa chuyên gia |`);
  L.push(`| Heldout v2 | intent-v1 (M5) | ${frac(Mh["intent-v1"].exactSetLe2)} | ${frac(Mh["intent-v1"].primaryCoverage)} | so sánh |`);
  L.push(`| Heldout v2 | keyword-v1 | ${frac(Mh["keyword-v1"].exactSetLe2)} | ${frac(Mh["keyword-v1"].primaryCoverage)} | so sánh |`);
  L.push(`| DEV (${ROUTING_CASES_DEV.length}) | intent-v1.1 | ${frac(Md["intent-v1.1"].exactSetLe2)} | ${frac(Md["intent-v1.1"].primaryCoverage)} | đã tinh chỉnh — không dùng cho gate |`);
  L.push(`| M5 v1 (${ROUTING_CASES_V1.length}) | intent-v1.1 | ${frac(Mv["intent-v1.1"].exactSetLe2)} | ${frac(Mv["intent-v1.1"].primaryCoverage)} | lịch sử, đã lộ — không phải heldout |`);
  L.push("", `Execution (mock): ${Object.entries(em).map(([k, v]) => `${k} ${v.pass}/${v.total}`).join(", ")}. Lượt vượt ngân sách: ${ev.r.executionSummary.perf.overrunTurns}. Gọi mạng/provider: ${ev.r.execution.counters.netCalls}. Tất định (2 lần): ${ev.r.identical ? "giống hệt" : "KHÁC"}.`, "");

  L.push(`## 7. Quality gates (cùng định nghĩa/ngưỡng M5.1) và adjudication`, "");
  L.push("| Gate | Mô tả | Trước adjudication (M5.1) | Sau adjudication (M6) |", "| --- | --- | --- | --- |");
  for (const g of ev.after) L.push(`| ${g.id} | ${g.description} | ${Gb[g.id].value} → ${Gb[g.id].pass ? "PASS" : "**FAIL**"} | ${Ga[g.id].value} → ${Ga[g.id].pass ? "PASS" : "**FAIL**"} |`);
  L.push("", `Adjudication đã ghi nhận (adjudication-m6.ts) — khớp CHÍNH XÁC key, không wildcard; nhãn gốc, guard V1/V2 và kết quả lịch sử M5/M5.1 không đổi:`, "");
  L.push("| Ca | Nhãn gốc | Quan sát được phê duyệt | Quyết định | Lý do | Người duyệt / nguồn | Kết quả kiểm |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const a of APPROVED_ADJUDICATIONS_M6) {
    const c = ev.adj.checks.find((x) => x.key === a.key);
    const o = ev.r.execution.observations.find((x) => x.scenario === a.scenario);
    L.push(`| ${a.caseId} | ${a.originalExpected} | ${a.approvedObserved.status} / \`${a.approvedObserved.safetyType}\` (quan sát: ${o ? `${o.status} / ${o.safetyType}; đọc cá nhân ${o.personalReads}, model ${o.modelCalls}, WRITE ${o.writeCalls}, tuyên bố xóa ${o.deletionClaim ? "có" : "không"}, tới routing/Gate 1: ${o.routingReached || o.profileRead !== "NOT_READ" ? "có" : "không"}` : "THIẾU"}) | ${a.decision} | ${a.rationale} | ${a.approvedBy}; ${a.source}; thẩm định chuyên gia độc lập: không | ${c?.accepted ? "chấp nhận" : `**từ chối**: ${c?.reasons.join("; ") ?? "không có failure tương ứng"}`} |`);
  }
  L.push("", `Tiêu chí đóng M6 Local RC:`, "");
  L.push("| Tiêu chí | Kết quả |", "| --- | --- |");
  for (const c of criteria) L.push(`| ${c.criterion} | ${c.ok ? "PASS" : "**FAIL**"} |`);
  L.push("");

  L.push(`## 8. Ranh giới bảo mật`, "");
  for (const s of [
    `Identity chỉ từ context đã xác thực; mọi tool từ chối userId/clientId trong tham số; registry quét dữ liệu của user khác (CROSS_USER_DATA). Cross-user: ${em.cross_user.pass}/${em.cross_user.total} assertion.`,
    `Không WRITE: contract WRITE không có handler, policy pilot chỉ READ, allowDraft=false; tool ngoài allowlist → TOOL_NOT_OFFERED. WRITE: ${ev.values["execution.writeCalls"]}; từ chối tool trái phép ${em.unauthorized_rejected.pass}/${em.unauthorized_rejected.total}.`,
    "Router chỉ đặt tên agent; không cấp tool, ngân sách hay identity (supervisor kiểm lại). Cap 2 agent, ngân sách toàn lượt 60 s / 8 model / 6 tool / 60K / 6K / $0.08.",
    "Session theo (userId, sessionId) đã xác thực; sessionId client chỉ là gợi ý; entry hỏng/ngoại lai/'verified model text' bị loại; văn bản agent không bao giờ thành memory.",
    "Input safety V1 trước routing; Gate 1 trước mọi model/tool; AGE_UNKNOWN + rủi ro cao fail closed; không có reader → PROFILE_UNAVAILABLE.",
    "Trace chỉ mã/số đếm. Không mạng/provider trong benchmark (chặn bedrock send, fetch, axios). Flag mặc định OFF; V1 không import agent-v2.",
  ]) L.push(`- ${s}`);
  L.push("");

  L.push(`## 9. Giới hạn và lỗi đã biết (register)`, "");
  L.push("| ID | Vấn đề | Bằng chứng | Mức xác minh | Phân loại | Ghi chú |", "| --- | --- | --- | --- | --- | --- |");
  for (const k of issues) L.push(`| ${k.id} | ${k.title} | ${k.evidence} | ${k.verifiedBy} | **${k.cls}** | ${k.note} |`);
  const byCls = (c: IssueClass) => issues.filter((k) => k.cls === c).map((k) => k.id).join(", ") || "không có";
  L.push("", `- BLOCKER FOR LOCAL RC: ${byCls("BLOCKER FOR LOCAL RC")}`, `- BLOCKER FOR LIVE EVALUATION: ${byCls("BLOCKER FOR LIVE EVALUATION")}`, `- BLOCKER FOR AWS DEPLOYMENT: ${byCls("BLOCKER FOR AWS DEPLOYMENT")}`, `- ACCEPTED LOCAL LIMITATION: ${byCls("ACCEPTED LOCAL LIMITATION")}`, "");

  L.push(`## 10. Điều kiện trước đánh giá live (chưa bắt đầu)`, "");
  for (const s of [
    "Phê duyệt riêng của chủ dự án cho lời gọi model (chỉ Bedrock Nova Pro theo chính sách hiện hành; không model khác), trần chi phí/lượt và tổng; không dùng judge model khác nếu chưa được duyệt.",
    "Reader tuổi thật 4 trạng thái (AGE-READER).",
    "Nếu đọc dữ liệu AWS DEV: RC3 internal-auth đã xác minh runtime (RC3-AUTH) và đường gọi fitness-service đúng (FITNESS-PATH).",
    "Bộ câu hỏi live mới, độc lập (không dùng v1/DEV/heldout v2 đã lộ), có người gán nhãn thứ hai; tài khoản test được phép (tài khoản test bị chặn trên AWS theo ghi nhận trước).",
    "Quyết định về P05 (để không làm nhiễu kết quả) và gắn cờ khung giờ 00:00–07:00 (TZ-UTC).",
    "Harness live gọi runSupervisorTurn với provider thật, flag bật CHỈ trong harness; không nối /ai/ask.",
  ]) L.push(`- ${s}`);
  L.push("");
  L.push(`## 11. Điều kiện trước deploy AWS (chưa bắt đầu)`, "");
  for (const s of [
    "Kết quả đánh giá live Nova Pro đạt ngưỡng được duyệt (NOVA).",
    "V1 Stable tag + runbook rollback đã diễn tập (GOV).",
    "Session store bền, cô lập theo user, TTL (SESSION-MEM); sửa TZ-UTC; sửa/quyết định P05; KD-1/KD-2 với candidate + heldout mới.",
    "Tích hợp được thiết kế/duyệt (route hoặc cờ theo user, canary nội bộ, không traffic mặc định) (NOT-WIRED); observability + security review.",
    "RC3-AUTH và FITNESS-PATH xác minh trên môi trường thật; image bất biến + manifest + migration (không có) theo governance §3.",
  ]) L.push(`- ${s}`);
  L.push("");
  L.push(`## 12. Chiến lược rollback / cô lập`, "");
  for (const s of [
    "Flag AI_AGENT_V2 mặc định OFF (chỉ bật khi đúng giá trị \"on\"); V1 không import agent-v2 (test isolation); không route, worker, queue, scheduler.",
    "Không schema, không migration, không state bền: không có dữ liệu cần khôi phục khi gỡ.",
    "Code nằm trên nhánh/worktree riêng `feature/ai-v2-agent`, chỉ commit local; rollback = không merge hoặc revert commit; V1 deploy không bị ảnh hưởng (V1 runtime giống hệt v1.0.0-rc2).",
  ]) L.push(`- ${s}`);
  L.push("");
  L.push(`## 13. Lệch governance`, "");
  for (const s of [
    "Governance §2/§13 đặt Multi-Agent (V3) sau một bản V2 đã VERIFIED; M1–M6 được xây trên nhánh V2 thử nghiệm (đồng bộ V1 RC2), offline, theo yêu cầu của chủ dự án — ghi trong multi-agent-contracts.ts.",
    "V2 bắt đầu từ V1 RC (không phải V1 Stable); chưa có tag V1 Stable và chưa diễn tập rollback (quyết định của chủ dự án 2026-11-12) — ghi trong flag.ts.",
    "Hoàn thành M6 Local RC KHÔNG phải phê duyệt chạy cho người dùng, không phải live verified, không phải production ready.",
  ]) L.push(`- ${s}`);
  L.push("");
  return L.join("\n");
}

if (process.argv[1] && /run-m6\.ts$/.test(process.argv[1])) {
  (async () => {
    const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
    const logs = {
      v2: arg("--v2-log") ? parseNodeTestLog(arg("--v2-log")!) : undefined,
      v1: arg("--v1-log") ? parseNodeTestLog(arg("--v1-log")!) : undefined,
      tsc: arg("--tsc-log") ? parseTscLog(arg("--tsc-log")!) : undefined,
    };
    const ev = await runM6Evaluation();
    const id = sourceIdentity();
    const matrix = capabilityMatrix();
    const comps = componentChecks((ev.r.executionSummary.metrics as Record<string, { pass: number; total: number }>).provenance.pass === (ev.r.executionSummary.metrics as Record<string, { pass: number; total: number }>).provenance.total);
    const verify = verificationMatrix(ev, id, logs);
    const issues = knownIssues(ev);
    const write = process.argv.includes("--write");
    const criteria = releaseCriteria(ev, id, logs, write && comps.every((c) => c.ok));
    const done = criteria.every((c) => c.ok);
    console.log(JSON.stringify({ m6: done ? "DONE" : "NOT READY", head: id.head, gatesBefore: ev.before.map((g) => `${g.id}:${g.pass ? "PASS" : "FAIL"}(${g.value})`), gatesAfter: ev.after.map((g) => `${g.id}:${g.pass ? "PASS" : "FAIL"}(${g.value})`), adjudication: ev.adj.checks, failedCriteria: criteria.filter((c) => !c.ok).map((c) => c.criterion), components: comps.filter((c) => !c.ok).map((c) => c.component), verifyFailed: verify.filter((v) => !v.ok).map((v) => v.item) }));
    if (write) {
      const out = resolve(WORKTREE, "docs/ai-v2/m6");
      mkdirSync(out, { recursive: true });
      writeFileSync(resolve(out, "M6-LOCAL-RC-HANDOFF-vi.md"), buildHandoff(ev, id, comps, matrix, verify, issues, criteria, logs));
      writeFileSync(resolve(out, "m6-results.json"), JSON.stringify({ m6: done ? "DONE" : "NOT READY", identity: id, components: comps, capabilityMatrix: matrix, gatesBefore: ev.before, gatesAfter: ev.after, adjudication: { approvals: APPROVED_ADJUDICATIONS_M6, checks: ev.adj.checks, observations: ev.r.execution.observations }, verification: verify, releaseCriteria: criteria, knownIssues: issues, logs: { v2: logs.v2 && { ...logs.v2, passed: logs.v2.passed.length }, v1: logs.v1 && { ...logs.v1, passed: logs.v1.passed.length }, tsc: logs.tsc } }, null, 1));
      console.log(`written: ${out}${existsSync(resolve(out, "M6-LOCAL-RC-HANDOFF-vi.md")) ? "" : " (missing!)"}`);
    }
    process.exit(0);
  })().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
