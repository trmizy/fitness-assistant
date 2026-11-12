/**
 * M5.1 routing-remediation benchmark runner.
 *   --dev            DEV set only (tunable; prints failures). Never touches heldout v2.
 *   --final [--write] DEV + HELDOUT v2 + historical v1 + execution benchmark, twice (determinism), M5.1 gates.
 *                    Heldout protocol: the file hash must match heldout-v2.freeze.json, and heldout v2 may be scored by ONE
 *                    candidate only — the first final run records the planner hash in heldout-v2.run.json; a later run with
 *                    a different planner is refused (re-runs of the same candidate only re-check determinism).
 * --write puts the JSON + report in <worktree>/docs/ai-v2/m5.1/ (local; the repo hook keeps docs reports out of commits).
 * Offline: no network, DB, Redis or model.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { ROUTING_CASES_V1, type RoutingCase } from "./dataset-v1";
import { ROUTING_CASES_DEV } from "./dataset-dev";
import { ROUTING_CASES_HELDOUT_V2 } from "./dataset-heldout-v2";
import { runRoutingBenchmark, ROUTING_CONFIGS, ROUTING_ERRORS, type RoutingMetrics, type RoutingOutcome } from "./routing-eval";
import { runExecutionBenchmark, executionMetrics } from "./execution-eval";
import { QUALITY_GATES_M51, evaluateGates } from "./gates";
import { ADJUDICATIONS_M51 } from "./adjudication-m51";

const HERE = __dirname;
const sha = (p: string) => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n")).digest("hex");
export const HELDOUT_FILE = resolve(HERE, "dataset-heldout-v2.ts");
export const FREEZE_FILE = resolve(HERE, "heldout-v2.freeze.json");
export const RUN_FILE = resolve(HERE, "heldout-v2.run.json");
export const PLANNER_FILE = resolve(HERE, "../../agent-v2/routing-planner.ts");

export function heldoutIntegrity() {
  const freeze = JSON.parse(readFileSync(FREEZE_FILE, "utf8")) as { sha256: string; cases: number };
  return { expected: freeze.sha256, actual: sha(HELDOUT_FILE), ok: freeze.sha256 === sha(HELDOUT_FILE) && freeze.cases === ROUTING_CASES_HELDOUT_V2.length };
}
export const plannerSha = () => sha(PLANNER_FILE);

/** M5 v1 intent-v1 failures, classified by hand into the M5.1 taxonomy (Task A). */
export const V1_FAILURE_TAXONOMY: Readonly<Record<string, "A" | "B" | "C" | "D" | "E" | "F" | "G">> = Object.freeze({
  T06: "A", T07: "A", T10: "A", R02: "A", R04: "A", R06: "A", R08: "A", P02: "A", P07: "A", P09: "A", TR3: "A", NR2: "A",
  N02: "B", N03: "B", N08: "B", P03: "B", PT2: "B", NR1: "B", M07: "B",
  TN2: "C", TR4: "C", M06: "C", M15: "C",
  R09: "D", TN3: "D", TR5: "D", PR3: "D", PN2: "D", M09: "D", M12: "D",
  PN3: "E", M03: "E", M04: "E", M05: "E", M13: "E",
  O06: "F", O09: "F",
  P05: "G",
});
export const TAXONOMY_NAMES = { A: "Synonym / paraphrase missed", B: "Context taken as an independent intent", C: "Compound request not decomposed", D: "Primary-intent ranking", E: "Wrong / missing supporting agent", F: "Out-of-scope / ambiguous", G: "Safety pre-routing false positive" } as const;

/**
 * Post-hoc analysis of the candidate's heldout-v2 failures — written AFTER the one-shot scoring, used for the report only,
 * NEVER for tuning (fixing any of these is a new candidate that needs a new heldout set). Rendered only for cases that
 * actually failed; an unlisted failure is shown as "not analysed".
 */
export const HELDOUT_V2_POSTHOC: Readonly<Record<string, { group: keyof typeof TAXONOMY_NAMES; cause: string }>> = Object.freeze({
  "H-N06": { group: "G", cause: "V2 checkInputSafety (folded) — 'cuối' → 'cuoi' matches the V1 off-topic 'cưới' pattern (P05 class)." },
  "H-P05": { group: "G", cause: "Same as H-N06 ('cuối tháng')." },
  "H-TR4": { group: "E", cause: "The day-anchored TODAY_TRAINING span ('tuần này … buổi') is longer and swallows the overlapping load term 'tập dồn' → no Recovery support." },
  "H-M10": { group: "E", cause: "Same overlap: 'tuần này tôi tập' (TODAY_TRAINING) swallows 'tập quá sức' → Recovery neither selected nor deferred." },
  "H-PN3": { group: "E", cause: "'tốc độ giảm cân hiện tại' is not in the body-change lexicon → Progress support not detected." },
  "H-M06": { group: "A", cause: "'nghỉ bao nhiêu' is not in the rest lexicon (only 'nghỉ bao lâu') → the third ask is missed, so it is not disclosed." },
  "H-M09": { group: "A", cause: "'theo dõi cân ra sao' is not in the body lexicon → the third ask is missed, so it is not disclosed." },
  "H-M04": { group: "C", cause: "'chỉnh cả thực đơn lẫn lịch tập': 'lẫn' is not a clause separator; one program-change span swallows 'thực đơn' → Nutrition ask lost." },
  "H-M13": { group: "D", cause: "Bare imperative 'xem tiến độ' (no 'giúp/qua/lại') is not a request marker → Progress treated as background; primary becomes Nutrition." },
});

/** Defects found by the M5.1 contract tests AFTER heldout v2 was scored (not fixed in M5.1, see agent-v2-routing-m51.test.ts). */
export const KNOWN_DEFECTS_M51 = Object.freeze([
  { id: "KD-1", text: "'mọi người' folds to 'moi nguoi' = 'mỏi người' (sore body) → Recovery taken as an asked need." },
  { id: "KD-2", text: "'hay' meaning 'often' is read as 'or' by the alternative-question rule → a second agent is asked." },
]);

const TIMING = new Set(["routingLatencyUs", "wallLatencyMs"]);
const scrub = (x: unknown) => JSON.stringify(x, (k, v) => (TIMING.has(k) ? undefined : v));

async function once() {
  const dev = await runRoutingBenchmark(ROUTING_CASES_DEV);
  const heldout = await runRoutingBenchmark(ROUTING_CASES_HELDOUT_V2);
  const v1 = await runRoutingBenchmark(ROUTING_CASES_V1);
  const execution = await runExecutionBenchmark();
  return { dev, heldout, v1, execution, executionSummary: executionMetrics(execution) };
}

export async function runM51Final() {
  const integrity = heldoutIntegrity();
  if (!integrity.ok) throw new Error(`HELDOUT_V2_MODIFIED: ${integrity.actual} != ${integrity.expected}`);
  const candidate = plannerSha();
  const prior = existsSync(RUN_FILE) ? JSON.parse(readFileSync(RUN_FILE, "utf8")) as { plannerSha256: string } : null;
  if (prior && prior.plannerSha256 !== candidate) throw new Error(`HELDOUT_V2_ALREADY_SCORED_BY_ANOTHER_CANDIDATE (${prior.plannerSha256.slice(0, 12)}); create a new heldout set for a new candidate`);
  const a = await once();
  const b = await once();
  const key = (r: Awaited<ReturnType<typeof once>>) => scrub({ d: r.dev.outcomes, h: r.heldout.outcomes, v: r.v1.outcomes, e: r.execution.assertions, t: r.execution.turns });
  const identical = key(a) === key(b);
  const cand = a.heldout.metrics.find((m) => m.config === "intent-v1.1")!;
  const ex = a.executionSummary;
  const approved = new Set(ADJUDICATIONS_M51.filter((x) => x.approved).map((x) => x.key));
  const unresolved = ex.failed.filter((f) => !approved.has(`${f.scenario}|${f.name}`));
  const values: Record<string, number> = {
    "execution.crossUserLeaks": ex.crossUserLeaks,
    "execution.writeCalls": a.execution.counters.writeCalls + ex.failed.filter((f) => f.metric === "write").length,
    "execution.criticalSafetyViolations": ex.criticalSafetyViolations,
    "execution.forecastPromoted": a.execution.counters.forecastPromoted + ex.failed.filter((f) => f.metric === "forecast_promotion" && f.critical).length,
    "execution.agentOutputPromoted": a.execution.counters.agentOutputPromoted + ex.failed.filter((f) => f.metric === "memory_promotion" && f.critical).length,
    "routing.disclosurePctMin": Math.min(...[a.dev, a.heldout, a.v1].flatMap((x) => x.metrics.map((m) => m.disclosure.pct ?? 100))),
    "heldout.candidate.primaryCoveragePct": cand.primaryCoverage.pct ?? 0,
    "heldout.candidate.exactSetLe2Pct": cand.exactSetLe2.pct ?? 0,
    "execution.unresolvedFailedAssertions": unresolved.length,
    "determinism.identical": identical ? 1 : 0,
  };
  const gates = evaluateGates(values, QUALITY_GATES_M51);
  const routingGatesPass = gates.filter((g) => g.id === "G7" || g.id === "G8").every((g) => g.pass);
  return { ...a, integrity, candidate, prior, identical, values, gates, routingGatesPass, m6Ready: gates.every((g) => g.pass), unresolved };
}

// ── report ───────────────────────────────────────────────────────────────────────────────────────────────────────────
type Final = Awaited<ReturnType<typeof runM51Final>>;
const p = (x: number | null | undefined) => (x === null || x === undefined ? "—" : `${x}%`);
const f = (x: number | null | undefined) => (x === null || x === undefined ? "—" : String(x));
const frac = (o: { n: number; d: number; pct: number | null }) => `${o.n}/${o.d} (${p(o.pct)})`;
const ag = (xs: readonly string[]) => (xs.length ? xs.map((a) => a[0].toUpperCase()).join("+") : "∅");

function routingTable(L: string[], M: Record<string, RoutingMetrics>) {
  const row = (...c: Array<string | number>) => L.push(`| ${c.join(" | ")} |`);
  row("Chỉ số", ...ROUTING_CONFIGS); row(...Array(ROUTING_CONFIGS.length + 1).fill("---"));
  row("Exact agent-set ≤2 agent", ...ROUTING_CONFIGS.map((c) => frac(M[c].exactSetLe2)));
  row("Exact agent-set (tất cả)", ...ROUTING_CONFIGS.map((c) => frac(M[c].exactSetAll)));
  row("Exact agent-set ca ≥3 domain", ...ROUTING_CONFIGS.map((c) => frac(M[c].exactSetMulti)));
  row("Primary intent coverage", ...ROUTING_CONFIGS.map((c) => frac(M[c].primaryCoverage)));
  row("Macro F1 / micro F1", ...ROUTING_CONFIGS.map((c) => `${f(M[c].macroF1)} / ${f(M[c].microF1)}`));
  row("Correct deferral (≥3 domain)", ...ROUTING_CONFIGS.map((c) => frac(M[c].correctDeferral)));
  row("Agent thừa (false positive)", ...ROUTING_CONFIGS.map((c) => String(M[c].falsePositiveInvocations.count)));
  row("OOS detection / in-scope bị coi OOS", ...ROUTING_CONFIGS.map((c) => `${p(M[c].oos.detectionPct)} / ${M[c].oos.fp}`));
  row("PARTIAL khớp nhãn coverage", ...ROUTING_CONFIGS.map((c) => `${M[c].partial.labelAgree}/${M[c].partial.d}`));
  row("Công bố hoãn (lượt có hoãn)", ...ROUTING_CONFIGS.map((c) => `${p(M[c].disclosure.pct)} (${M[c].disclosure.deferredRuns})`));
  L.push("");
  row("Mã lỗi", ...ROUTING_CONFIGS); row(...Array(ROUTING_CONFIGS.length + 1).fill("---"));
  for (const e of ROUTING_ERRORS) row(e, ...ROUTING_CONFIGS.map((c) => M[c].errors[e]));
  L.push("");
}

function failTable(L: string[], cases: readonly RoutingCase[], outs: readonly RoutingOutcome[], cfg: string) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = outs.filter((o) => o.config === cfg && (!o.exactSet || o.errors.length));
  if (!rows.length) { L.push("Không có.", ""); return; }
  L.push("| Ca | Câu hỏi | Chấp nhận | Chọn | Hoãn | Trạng thái | Lỗi |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const o of rows) { const c = byId.get(o.caseId)!; L.push(`| ${o.caseId}${c.review ? " ⚑" : ""} | ${c.q.replace(/\|/g, "/")} | ${c.acceptable.map(ag).join(" / ")} | ${ag(o.selected)} | ${ag(o.deferred)} | ${o.status} | ${o.errors.join(", ") || "(sai tập)"} |`); }
  L.push("");
}

export function buildM51Report(r: Final, meta: { head: string }): string {
  const L: string[] = [];
  const Mh = Object.fromEntries(r.heldout.metrics.map((m) => [m.config, m])) as Record<string, RoutingMetrics>;
  const Md = Object.fromEntries(r.dev.metrics.map((m) => [m.config, m])) as Record<string, RoutingMetrics>;
  const Mv = Object.fromEntries(r.v1.metrics.map((m) => [m.config, m])) as Record<string, RoutingMetrics>;
  const G = Object.fromEntries(r.gates.map((g) => [g.id, g]));
  const ex = r.executionSummary;
  L.push(`# Gymini Multi-Agent — M5.1 Routing Quality Remediation`, "");
  L.push(`> Sinh tự động bởi \`run-m51.ts --final --write\` (base HEAD \`${meta.head}\` + cây làm việc M5.1). Candidate = \`intent-v1.1\`, planner sha256 \`${r.candidate.slice(0, 16)}…\`. Heldout v2 sha256 \`${r.integrity.actual.slice(0, 16)}…\` (khớp freeze: ${r.integrity.ok ? "có" : "KHÔNG"}).`);
  L.push(`> **VERIFIED BY OFFLINE BENCHMARK** (supervisor thật + runner giả cho routing; agent/tool thật + mock model cho execution). **NOT VERIFIED BY LIVE MODEL. NOT VERIFIED BY REAL INFRASTRUCTURE.**`, "");
  L.push(`## Tóm tắt`, "");
  L.push("| Hạng mục | Kết quả | Gate |", "| --- | --- | --- |");
  L.push(`| Heldout v2 — exact-set ≤2 (intent-v1.1) | ${frac(Mh["intent-v1.1"].exactSetLe2)} | G8 ≥85% → **${G.G8.pass ? "PASS" : "FAIL"}** |`);
  L.push(`| Heldout v2 — primary coverage (intent-v1.1) | ${frac(Mh["intent-v1.1"].primaryCoverage)} | G7 ≥90% → **${G.G7.pass ? "PASS" : "FAIL"}** |`);
  L.push(`| Heldout v2 — cùng chỉ số, intent-v1 (M5) | ${frac(Mh["intent-v1"].exactSetLe2)} · ${frac(Mh["intent-v1"].primaryCoverage)} | — |`);
  L.push(`| DEV (được tinh chỉnh) — exact-set ≤2 / primary (intent-v1.1) | ${frac(Md["intent-v1.1"].exactSetLe2)} · ${frac(Md["intent-v1.1"].primaryCoverage)} | không dùng cho gate |`);
  L.push(`| M5 v1 lịch sử (regression, KHÔNG phải heldout) — intent-v1.1 | ${frac(Mv["intent-v1.1"].exactSetLe2)} · ${frac(Mv["intent-v1.1"].primaryCoverage)} | không dùng cho gate |`);
  for (const id of ["G1", "G2", "G3", "G4", "G5", "G6", "G9", "G10"]) L.push(`| ${G[id].description} | ${f(G[id].value)} | ${id} → **${G[id].pass ? "PASS" : "FAIL"}** |`);
  L.push(`| Quyết định | **M6 ${r.m6Ready ? "READY" : "NOT READY"}** | mọi gate phải PASS |`, "");

  L.push(`## 1. Nguyên nhân lỗi routing (Task A — 39 ca intent-v1 sai trên M5 v1)`, "");
  const counts: Record<string, string[]> = {};
  for (const [id, g] of Object.entries(V1_FAILURE_TAXONOMY)) (counts[g] ??= []).push(id);
  L.push("| Nhóm | Mô tả | Số ca | Ca |", "| --- | --- | --- | --- |");
  for (const g of ["A", "B", "C", "D", "E", "F", "G"] as const) L.push(`| ${g} | ${TAXONOMY_NAMES[g]} | ${counts[g]?.length ?? 0} | ${(counts[g] ?? []).join(", ")} |`);
  L.push("", `Nguyên nhân gốc trong code M4: (1) mọi từ domain cộng +1 relevance nên bối cảnh ("trước buổi tập") kéo thêm agent; (2) chỉ một "request span" cuối câu → mất yêu cầu đầu trong câu ghép; (3) chữ bỏ dấu đụng nhau: "giáo án"→"giao an" khớp "ăn", "uể/uống oải"→"uong", "mới/mọi"→"moi"; (4) bảng quy tắc thiếu đồng nghĩa (buổi mai, lên phòng, xuống ký, ngủ ít, đánh giá chu kỳ…); (5) regex khớp vượt ranh giới mệnh đề.`, "");
  L.push(`## 2–3. Thay đổi intent extraction và agent selection`, "");
  for (const s of [
    "Tách mệnh đề (dấu câu, \"và / nhưng / mà / rồi\"); vai trò REQUEST (từ hỏi, \"nên / có cần\", mệnh lệnh \"xem giúp / kiểm tra / cho tôi biết\", \"không/chưa\" cuối mệnh đề, \"?\") hoặc CONTEXT (câu kể = tự báo cáo). Mục liệt kê ngắn ngay sau một yêu cầu được kế thừa vai trò REQUEST.",
    "Term khớp THEO TỪNG MỆNH ĐỀ, khớp dài nhất thắng; một hàng lexicon cho mỗi khái niệm (need, agent sở hữu, trọng số, cờ entity / observation / anchoredOnly).",
    "Từ đứng sau khung bối cảnh (\"trước / sau / khi / để / vì / theo…\", \"… thì\" đầu mệnh đề) là BACKGROUND, không phải yêu cầu.",
    "Yêu cầu = term không bị khung đầu tiên của mỗi mệnh đề REQUEST (tên bài tập / \"tập\" trơn chỉ là yêu cầu khi không còn khái niệm nào khác); câu lựa chọn \"X hay Y\" → cả hai là yêu cầu. Không có yêu cầu nhưng có term → term bối cảnh trở thành yêu cầu (câu kể trơn, \"hai cái có liên quan không?\").",
    "Chọn agent: các agent được HỎI theo thứ tự xuất hiện (primary = đầu tiên), tối đa 2; slot trống chỉ dành cho agent HỖ TRỢ khi cần dữ liệu của chính người dùng: tự báo cáo (câu kể / khung) hoặc quan sát cá nhân (mệt, ngủ, lịch sử tập, sức mạnh, cơ thể); lịch tập chỉ khi gắn với ngày (\"hôm nay\", \"vậy…\" nối tiếp). Từ nhắc trơn không bao giờ thêm agent. Hòa → bảng ưu tiên theo primary.",
    "Phần cần mà không chạy → deferred MAX_AGENTS (được công bố) hoặc SATISFIED_FROM_SESSION; câu mua sắm → ngoài phạm vi. Không đổi maxAgentsPerTurn, ngân sách, tool, identity.",
    "Supervisor: chỉ need được HỎI mới tính là \"own need\" (agent chỉ cung cấp dữ liệu mà đọc thất bại thì bị giữ lại — an toàn hơn).",
  ]) L.push(`- ${s}`);
  L.push("");
  L.push(`## 4. DEV (${ROUTING_CASES_DEV.length} ca, được tinh chỉnh — không gộp với heldout)`, "");
  routingTable(L, Md); L.push(`### Ca DEV intent-v1.1 sai`, ""); failTable(L, ROUTING_CASES_DEV, r.dev.outcomes, "intent-v1.1");
  L.push(`## 5. Đặc tả heldout v2`, "");
  const cat = (c: string) => ROUTING_CASES_HELDOUT_V2.filter((x) => x.category === c).length;
  L.push(`${ROUTING_CASES_HELDOUT_V2.length} ca (một domain ${cat("SINGLE")}, hai domain ${cat("TWO")}, ≥3 domain ${cat("MULTI")}, OOS/mơ hồ ${cat("OOS_AMBIGUOUS")}); ${ROUTING_CASES_HELDOUT_V2.filter((x) => x.review).length} ca ⚑ cần xem lại. Viết và đóng băng (sha256 trong \`heldout-v2.freeze.json\`) TRƯỚC mọi thay đổi router và trước khi có DEV. Giao thức một-lần: \`heldout-v2.run.json\` ghi sha256 planner của lần chấm; candidate khác bị từ chối. **Giới hạn độc lập:** cùng một tác giả viết heldout, DEV và router; tác giả đã đọc các câu heldout trước khi tinh chỉnh trên DEV, nên không thể khẳng định heldout hoàn toàn không thiên lệch. Không có người gán nhãn thứ hai / chuyên gia.`, "");
  L.push(`## 6–7. Heldout v2 — chỉ số và so sánh`, "");
  routingTable(L, Mh); L.push(`### Ca heldout v2 intent-v1.1 sai (công bố đầy đủ, không sửa nhãn, không tinh chỉnh lại)`, ""); failTable(L, ROUTING_CASES_HELDOUT_V2, r.heldout.outcomes, "intent-v1.1");
  L.push(`## 8. M5 v1 lịch sử (regression — đã lộ kết quả, KHÔNG phải heldout)`, "");
  routingTable(L, Mv);
  L.push(`## 9. Adjudication nhãn an toàn S02/S09 (Task F)`, "");
  L.push("| Ca | Bất biến bảo mật | Đạt | Nhãn | Thực tế | Cơ sở chính sách | Đúng chính sách | Quyết định |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const a of ADJUDICATIONS_M51) L.push(`| ${a.caseId} | ${a.securityInvariant} | ${a.invariantMet ? "có" : "KHÔNG"} | ${a.labelledBehaviour} | ${a.actualBehaviour} | ${a.policyBasis} | ${a.policyCompliant ? "có" : "không"} | **${a.decision}** (chưa duyệt) |`);
  L.push("", `Nhãn và guard không đổi. Hai mismatch vẫn tính là FAIL chưa giải quyết cho G9 tới khi có người phê duyệt. Kết quả lịch sử M5 giữ nguyên.`, "");
  L.push(`## 10. V1 safety false positive P05`, "");
  const sb = r.heldout.outcomes.filter((o) => o.config === "intent-v1.1" && o.errors.includes("INPUT_SAFETY_FALSE_POSITIVE")).map((o) => o.caseId);
  const sbd = r.dev.outcomes.filter((o) => o.config === "intent-v1.1" && o.errors.includes("INPUT_SAFETY_FALSE_POSITIVE")).map((o) => o.caseId);
  L.push(`Xem \`P05-V1-SAFETY-HANDOFF-vi.md\`. Cùng nguyên nhân xuất hiện ở heldout v2: ${sb.join(", ") || "—"}; DEV: ${sbd.join(", ") || "—"}. Không sửa trong M5.1, không tính lại là đúng.`, "");
  L.push(`## 11. Bất biến bảo mật (execution benchmark với router mới)`, "");
  const em = ex.metrics as Record<string, { pass: number; total: number }>;
  L.push(`cross_user ${em.cross_user.pass}/${em.cross_user.total}; write ${em.write.pass}/${em.write.total}; safety ${em.safety.pass}/${em.safety.total}; forecast ${em.forecast_promotion.pass}/${em.forecast_promotion.total}; memory ${em.memory_promotion.pass}/${em.memory_promotion.total}; unauthorized ${em.unauthorized_rejected.pass}/${em.unauthorized_rejected.total}; handoff ${em.handoff.pass}/${em.handoff.total}; budget ${em.budget.pass}/${em.budget.total}; flag ${em.flag.pass}/${em.flag.total}; network ${em.network.pass}/${em.network.total}. Assertion fail: ${ex.failed.map((x) => `${x.scenario} (${x.critical ? "critical" : "không critical"})`).join("; ") || "không"}. Lượt vượt ngân sách: ${ex.perf.overrunTurns}. Tất định (2 lần, mọi bộ): ${r.identical ? "giống hệt" : "KHÁC"}.`, "");
  L.push(`## 12. Gate M5.1`, "");
  L.push("| Gate | Loại | Mô tả | Giá trị | Kết quả |", "| --- | --- | --- | --- | --- |");
  for (const g of r.gates) L.push(`| ${g.id} | ${g.kind} | ${g.description} | ${f(g.value)} | ${g.pass ? "PASS" : "**FAIL**"} |`);
  L.push("", `**M6 ${r.m6Ready ? "READY" : "NOT READY"}.** ${r.routingGatesPass ? "Routing gate G7/G8 đạt trên heldout v2." : "Routing gate G7/G8 chưa đạt trên heldout v2."} ${G.G9.pass ? "" : "G9 chưa đạt: hai nhãn an toàn còn LABEL_REVIEW_REQUIRED."}`, "");
  L.push(`## 13. Phân tích lỗi heldout v2 SAU khi chấm (chỉ để báo cáo — không dùng để tinh chỉnh)`, "");
  const hf = r.heldout.outcomes.filter((o) => o.config === "intent-v1.1" && (!o.exactSet || o.errors.length)).map((o) => o.caseId);
  const byGroup: Record<string, string[]> = {};
  L.push("| Ca | Nhóm | Nguyên nhân |", "| --- | --- | --- |");
  for (const id of hf) { const a = HELDOUT_V2_POSTHOC[id]; (byGroup[a?.group ?? "?"] ??= []).push(id); L.push(`| ${id} | ${a ? `${a.group} — ${TAXONOMY_NAMES[a.group]}` : "?"} | ${a?.cause ?? "chưa phân tích"} |`); }
  L.push("", `Phân bố: ${Object.entries(byGroup).map(([g, ids]) => `${g} ${ids.length}`).join(", ")}. Nhóm lớn nhất là thiếu/chồng lấn lexicon khiến nhu cầu thứ ba hoặc agent hỗ trợ KHÔNG được nhận diện — nên cũng không được báo hoãn (\`UNREPORTED_DEFERRED_INTENT\`). Sửa bất kỳ lỗi nào ở đây = candidate mới, cần heldout mới.`, "");
  L.push(`## 14. Lỗi đã biết phát hiện SAU khi khóa heldout (không sửa trong M5.1)`, "");
  for (const k of KNOWN_DEFECTS_M51) L.push(`- **${k.id}**: ${k.text}`);
  L.push("", `Ghi trong \`agent-v2-routing-m51.test.ts\` dưới dạng test \`todo\` (hiển thị, không che giấu). Không ảnh hưởng tới số liệu đã đo (rà soát dataset + code): không câu nào trong v1/DEV/heldout chứa "mọi người"; "hay" = "thường" chỉ có ở v1 NR2, M03 và heldout H-M04, đều nằm trong mệnh đề bối cảnh, nơi quy tắc câu lựa chọn không chạy. Tuy vậy đây là lỗi routing thật với câu tự nhiên.`, "");
  return L.join("\n");
}

function p05Handoff(): string {
  return [
    "# Handoff — V1 safety false positive (P05) phát hiện trong M5/M5.1", "",
    "**Không sửa trong M5.1. Không sửa V1. Đây là bàn giao để chủ sở hữu V1 safety quyết định.**", "",
    "## Hiện tượng",
    "- Câu hợp lệ \"Ứng dụng dự báo cuối giai đoạn mình nặng bao nhiêu?\" bị chặn `off_topic` trước routing (V2 `checkInputSafety`).",
    "- Cùng mẫu với các câu chứa \"cuối\" (cuối tuần, cuối giai đoạn, cuối tháng) không có tín hiệu fitness \"mạnh\".", "",
    "## Nguyên nhân (CODE AUDIT + tái hiện offline)",
    "- `llm/safety_guard.ts` `OFF_TOPIC_PATTERNS` có `\\bcuoi\\b` (ý định: \"cưới\" — hôn nhân).",
    "- V2 `agent-v2/answer-guards.ts` `checkInputSafety` chạy V1 `safetyGuard.check` trên câu gốc VÀ trên dạng bỏ dấu (`foldVi`) — để không yếu hơn V1 với câu không dấu (lỗi \"giảm 10kg trong 1 tuần\" đã biết).",
    "- Bỏ dấu biến \"cuối\" thành \"cuoi\" → khớp mẫu \"cưới\" → `isDefinitelyOffTopic` trừ khi có `STRONG_FITNESS_SIGNALS` (không gồm \"dự báo / nặng / cân\").",
    "- V1 production (câu có dấu) không bị: chỉ người gõ KHÔNG DẤU \"cuoi\" mới bị ở V1.", "",
    "## Phạm vi ảnh hưởng",
    "- V2 (flag OFF, chưa có người dùng): mọi câu có \"cuối\" mà không có tín hiệu fitness mạnh.",
    "- V1: câu không dấu chứa \"cuoi\".", "",
    "## Phương án đề xuất (chưa triển khai, cần duyệt)",
    "1. V1: tách \"cưới\" khỏi mẫu off-topic bỏ dấu (chỉ khớp \"cưới\" có dấu, hoặc cần ngữ cảnh \"đám cưới / lễ cưới\").",
    "2. V2: ở nhánh bỏ dấu chỉ áp các detector an toàn (giảm cân cực đoan, y tế, vị thành niên, injection), không áp off_topic — vẫn không yếu hơn V1 về an toàn.",
    "3. Thêm ca hồi quy cho \"cuối tuần / cuối tháng / cuối giai đoạn\" và \"đám cưới\".", "",
    "Bằng chứng: M5 v1 P05, M5.1 DEV D-A12, heldout v2 (xem báo cáo M5.1 §10).",
  ].join("\n");
}

if (process.argv[1] && /run-m51\.ts$/.test(process.argv[1])) {
  (async () => {
    if (process.argv.includes("--dev")) {
      const dev = await runRoutingBenchmark(ROUTING_CASES_DEV);
      for (const m of dev.metrics) console.log(m.config, JSON.stringify({ le2: m.exactSetLe2, prim: m.primaryCoverage, micro: m.microF1 }));
      process.exit(0);
    }
    if (!process.argv.includes("--final")) { console.log("usage: --dev | --final [--write]"); process.exit(2); }
    const r = await runM51Final();
    let head = "unknown"; try { head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { /* not git */ }
    if (!r.prior) writeFileSync(RUN_FILE, JSON.stringify({ plannerSha256: r.candidate, heldoutSha256: r.integrity.actual, firstScoredAt: new Date().toISOString(), baseHead: head,
      result: { exactSetLe2Pct: r.values["heldout.candidate.exactSetLe2Pct"], primaryCoveragePct: r.values["heldout.candidate.primaryCoveragePct"] } }, null, 2) + "\n");
    console.log(JSON.stringify({ m6Ready: r.m6Ready, gates: r.gates.map((g) => `${g.id}:${g.pass ? "PASS" : "FAIL"}(${g.value})`), deterministic: r.identical, firstHeldoutRun: !r.prior }));
    if (process.argv.includes("--write")) {
      const out = resolve(process.cwd(), "../../../docs/ai-v2/m5.1");
      mkdirSync(out, { recursive: true });
      writeFileSync(resolve(out, "m51-results.json"), JSON.stringify({ baseHead: head, candidatePlannerSha256: r.candidate, heldoutIntegrity: r.integrity, gates: r.gates, values: r.values, m6Ready: r.m6Ready,
        dev: r.dev, heldout: r.heldout, historicalV1: r.v1, execution: { summary: r.executionSummary, assertions: r.execution.assertions }, adjudications: ADJUDICATIONS_M51, v1Taxonomy: V1_FAILURE_TAXONOMY }, null, 1));
      writeFileSync(resolve(out, "M5.1-ROUTING-REMEDIATION-REPORT-vi.md"), buildM51Report(r, { head }));
      writeFileSync(resolve(out, "P05-V1-SAFETY-HANDOFF-vi.md"), p05Handoff());
      console.log(`written: ${out}`);
    }
    process.exit(0);
  })().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
