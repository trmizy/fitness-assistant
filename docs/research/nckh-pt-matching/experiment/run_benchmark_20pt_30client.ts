/**
 * Chạy bộ benchmark GYMINI_SIM_COMPLETE_V2_2026-11-03 (20 PT × 30 client) qua pipeline ghép nối của Gymini.
 * - Đọc dữ liệu ở "D:/Nghiên cứu khoa học/Gymini_Research/01_data" (chỉ đọc, không sửa).
 * - H0–H5 được chấm tự động theo 04_evaluation/H0_H5_RUBRIC.csv + AGENT_RUN_INSTRUCTIONS.md.
 * - Gọi thẳng scorePT / GOAL_SPECIALTIES của sản phẩm (backend/shared/src/fitness-agent-scoring.ts).
 * Chạy: backend/services/ai-service/node_modules/.bin/tsx reports/nckh-pt-matching/experiment/run_benchmark_20pt_30client.ts
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { scorePT, GOAL_SPECIALTIES } from "../../../../backend/shared/src/fitness-agent-scoring";

const DATA = "D:/Nghiên cứu khoa học/Gymini_Research";
const OUT = path.resolve(__dirname, "../benchmark"); fs.mkdirSync(OUT, { recursive: true });
const ptRaw = fs.readFileSync(`${DATA}/01_data/PT_MATCHING_FIXTURE_20_COMPLETE.json`);
const PTS: any[] = JSON.parse(ptRaw.toString("utf8"));
const CLIENTS: any[] = fs.readFileSync(`${DATA}/01_data/CLIENT_SCENARIOS_30.jsonl`, "utf8").trim().split(/\r?\n/).map(l => JSON.parse(l));
const sha = crypto.createHash("sha256").update(ptRaw).digest("hex");

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const SPEC_VI: Record<string, string> = { "giảm mỡ": "FAT_LOSS", "tăng cơ": "MUSCLE_GAIN", "sức mạnh": "STRENGTH", "sức bền": "ENDURANCE", "functional fitness": "FUNCTIONAL" };
// Gymini chỉ có 4 mục tiêu (AgentPreferencesSchema.goal) -> chọn mục tiêu gần nhất
const GOAL_TO_GYMINI: Record<string, string> = { FAT_LOSS: "WEIGHT_LOSS", BODY_TONING: "WEIGHT_LOSS", MUSCLE_GAIN: "MUSCLE_GAIN",
  GENERAL_FITNESS: "MAINTENANCE", ENDURANCE: "MAINTENANCE", FUNCTIONAL: "MAINTENANCE", STRENGTH: "ATHLETIC_PERFORMANCE" };
const budgetOf = (c: any): number | null => c.budget_max_vnd_per_session === "NO_CAP" || c.budget_max_vnd_per_session == null ? null : Number(c.budget_max_vnd_per_session);
const modeOk = (c: any, m: string) => c.training_mode_required === "HYBRID" ? (m === "ONLINE" || m === "OFFLINE") : m === c.training_mode_required;

// ---------- Chấm H1–H5 (nhãn đúng, độc lập với mọi phương pháp) ----------
function overlaps(pt: any, c: any) {
  let n = 0;
  for (const a of c.available_slots) for (const b of pt.weekly_available_slots) if (a.weekday_iso === b.weekday_iso) {
    const ov = Math.min(toMin(a.end), toMin(b.end)) - Math.max(toMin(a.start), toMin(b.start));
    if (ov >= c.session_duration_minutes) n++;
  }
  return n;
}
function judge(pt: any, c: any) {
  const req = (c.required_specialties as string[]).map(s => SPEC_VI[s] ?? s);
  const H1 = !c.specialty_is_hard ? "NA" : req.every(r => pt.specialty_tags.includes(r)) ? "PASS" : "FAIL";
  const H2 = overlaps(pt, c) >= (c.min_bookable_slots_per_week ?? 1) ? "PASS" : "FAIL";
  const budget = budgetOf(c);
  const offers = pt.training_offers.filter((o: any) => modeOk(c, o.mode));
  const H4 = offers.length ? "PASS" : "FAIL";
  const priceOk = (o: any) => !c.budget_is_hard || budget === null || o.price_vnd_per_60min <= budget;
  const areaOk = (o: any) => o.mode === "ONLINE" || !c.location_is_hard || o.service_areas.some((a: string) => c.allowed_service_areas.includes(a));
  const H3 = budget === null || !c.budget_is_hard ? "NA" : offers.some(priceOk) ? "PASS" : "FAIL";
  const needsLoc = c.location_is_hard && c.training_mode_required !== "ONLINE";
  const H5 = !needsLoc ? "NA" : offers.some(areaOk) ? "PASS" : "FAIL";
  // 3 điều kiện giá/hình thức/khu vực phải được thoả bởi CÙNG một gói (offer)
  const sameOffer = offers.some((o: any) => priceOk(o) && areaOk(o));
  const valid = H1 !== "FAIL" && H2 === "PASS" && H4 === "PASS" && sameOffer;
  return { H0: "PASS", H1, H2, H3, H4, H5, sameOffer, valid };
}

// ---------- Ứng viên dạng PTCandidate của Gymini ----------
function candidate(pt: any, c: any, offers: any[], days: number[]): any {
  return { id: pt.pt_id, name: pt.profile_label, photoUrl: null, specialties: pt.specialty_tags, yearsExperience: String(pt.benchmark_experience_years),
    languages: [], certificates: [], packages: offers.map((o: any, i: number) => ({ id: `${pt.pt_id}-${i}`, name: o.mode, price: o.price_vnd_per_60min, sessions: 1, sessionMinutes: 60, mode: o.mode })),
    availableDays: days, availableSlots: overlaps(pt, c), averageRating: null, reviewCount: 0, clientsStarted: 0, clientsCompleted: 0,
    cancellationRate: null, noShowRate: null, dataOrigin: "REAL",
    history: { count: 0, medianWeightChange: null, medianTrainingAdherence: null, medianNutritionAdherence: null, medianDurationWeeks: null, completionRate: null, dataOrigin: "REAL", similarityVersion: "journey-distance-v1", note: "" } };
}
const rank = (xs: { id: string; score: number }[]) => xs.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 3);

// G0 — Gymini hiện tại: bộ lọc của agentic-fitness.service.ts::candidates() (theo ngày, tỉnh/thành, giá gói) + scorePT
function G0(c: any) {
  const goal = GOAL_TO_GYMINI[c.primary_goal_code];
  const days = [...new Set<number>(c.available_slots.map((s: any) => s.weekday_iso))].sort();
  const budget = budgetOf(c) ?? undefined;
  const mode = c.training_mode_required === "HYBRID" ? undefined : c.training_mode_required;
  const prefs: any = { goal, days, sessionMinutes: c.session_duration_minutes, budgetVnd: budget, mode };
  const out: { id: string; score: number }[] = [];
  for (const pt of PTS) {
    if (!pt.specialty_tags.some((s: string) => (GOAL_SPECIALTIES[goal] ?? []).includes(s))) continue;           // specialties hasSome
    const offers = pt.training_offers.filter((o: any) => (!budget || o.price_vnd_per_60min <= budget) && (!mode || o.mode === mode));
    if (!offers.length) continue;                                                                              // servicePackages some
    const ptDays = [...new Set<number>(pt.weekly_available_slots.map((s: any) => s.weekday_iso))];
    const availableDays = days.filter(d => ptDays.includes(d));
    if (!days.every(d => availableDays.includes(d))) continue;                                                  // PT phải rảnh MỌI ngày khách chọn
    out.push({ id: pt.pt_id, score: scorePT(candidate(pt, c, offers, availableDays), prefs).total });
  }
  return { top: rank(out), eligible: out.length };
}
// G1 — Gymini + ràng buộc đầy đủ theo giờ/quận/giá theo buổi (H1–H5) + scorePT
function G1(c: any) {
  const goal = GOAL_TO_GYMINI[c.primary_goal_code];
  const days = [...new Set<number>(c.available_slots.map((s: any) => s.weekday_iso))].sort();
  const prefs: any = { goal, days, sessionMinutes: 60, budgetVnd: budgetOf(c) ?? undefined };
  const out: { id: string; score: number }[] = [];
  for (const pt of PTS) {
    if (!judge(pt, c).valid) continue;
    const ptDays = [...new Set<number>(pt.weekly_available_slots.map((s: any) => s.weekday_iso))];
    out.push({ id: pt.pt_id, score: scorePT(candidate(pt, c, pt.training_offers.filter((o: any) => modeOk(c, o.mode)), days.filter(d => ptDays.includes(d))), prefs).total });
  }
  return { top: rank(out), eligible: out.length };
}
// R — ngẫu nhiên 3 PT trong 20 (seed cố định, trung bình 200 lần)
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const truth = CLIENTS.map(c => ({ c, valid: PTS.filter(p => judge(p, c).valid).map(p => p.pt_id) }));
function evaluate(name: string, runner: (c: any) => { top: { id: string; score: number }[]; eligible: number }) {
  let positions = 0, validPos = 0, top1 = 0, success = 0, full3 = 0, full3N = 0, ties = 0, tiesN = 0, recall = 0, emptyWrong = 0;
  const viol: Record<string, number> = { H1: 0, H2: 0, H3: 0, H4: 0, H5: 0, SAME_OFFER: 0 };
  const rows: any[] = [];
  for (const { c, valid } of truth) {
    const { top, eligible } = runner(c);
    const js = top.map(t => ({ ...t, j: judge(PTS.find(p => p.pt_id === t.id), c) }));
    positions += top.length; const v = js.filter(x => x.j.valid).length; validPos += v;
    if (js[0]?.j.valid) top1++; if (v > 0) success++; if (!top.length && valid.length) emptyWrong++;
    if (valid.length >= 3) { full3N++; if (v === 3) full3++; }
    recall += valid.length ? v / Math.min(3, valid.length) : 1;
    if (top.length >= 2) { tiesN++; if (new Set(top.map(t => t.score)).size < top.length) ties++; }
    for (const x of js) { for (const h of ["H1", "H2", "H3", "H4", "H5"]) if ((x.j as any)[h] === "FAIL") viol[h]++; if (!x.j.sameOffer && x.j.H3 !== "FAIL" && x.j.H5 !== "FAIL") viol.SAME_OFFER++; }
    rows.push({ client: c.client_id, goal: c.primary_goal_code, mode: c.training_mode_required, nValid: valid.length, validIds: valid.join(" "), eligibleByMethod: eligible,
      top: js.map(x => `${x.id}(${x.score})${x.j.valid ? "" : "✗" + ["H1", "H2", "H3", "H4", "H5"].filter(h => (x.j as any)[h] === "FAIL").join("/")}`).join(" ") });
  }
  const N = truth.length;
  return { method: name, runs: N, coverage3: positions / (N * 3), valid3: positions ? validPos / positions : 0, top1Validity: top1 / N, caseSuccess: success / N,
    full3: full3N ? full3 / full3N : null, full3N, recallValid: recall / N, emptyWhenValidExists: emptyWrong, tieRate: tiesN ? ties / tiesN : null, invalidPositions: positions - validPos, violations: viol, rows };
}
const randomRunner = (seed: number) => (c: any) => { const r = mulberry32(seed + Number(c.client_id.slice(1)));
  const ids = PTS.map(p => p.pt_id).sort(() => r() - 0.5).slice(0, 3); return { top: ids.map(id => ({ id, score: 0 })), eligible: 20 }; };
const rnd = Array.from({ length: 200 }, (_, s) => evaluate("R", randomRunner(s * 31 + 7)));
const avg = (k: string) => rnd.reduce((a, x: any) => a + x[k], 0) / rnd.length;
const R = { method: "R Ngẫu nhiên 3/20 (TB 200 lần)", coverage3: 1, valid3: avg("valid3"), top1Validity: avg("top1Validity"), caseSuccess: avg("caseSuccess"), recallValid: avg("recallValid") };
const g0 = evaluate("G0 Gymini hiện tại (lọc theo ngày/tỉnh/giá gói + scorePT)", G0);
const g1 = evaluate("G1 Gymini + ràng buộc đầy đủ giờ/quận/giá buổi (H1–H5) + scorePT", G1);

// Kiểm chéo nhãn của tại hạ với bảng precheck của nhóm nghiên cứu (chỉ để kiểm, không dùng làm nhãn)
const pre = fs.readFileSync(`${DATA}/04_evaluation/CLIENT_COVERAGE_PRECHECK_PRIVATE.csv`, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1).map(l => { const m = l.match(/^([^,]+),(\d+),(?:"([^"]*)"|([^,]*)),/)!; return [m[1], m[2], m[3] ?? m[4]]; });
const agree = pre.filter(([cid, , ids]) => { const t = truth.find(x => x.c.client_id === cid)!; return t.valid.slice().sort().join(" ") === ids.split(/[ ,;|]/).filter(Boolean).sort().join(" "); }).length;

const res = { generatedAt: new Date().toISOString(), datasetVersion: CLIENTS[0].benchmark_version, ptFixtureSha256: sha, nPT: PTS.length, nClient: CLIENTS.length,
  truthAgreementWithPrecheck: `${agree}/${pre.length}`, validCountDistribution: truth.reduce((m: any, t) => (m[t.valid.length] = (m[t.valid.length] ?? 0) + 1, m), {}),
  random: R, methods: [g0, g1] };
fs.writeFileSync(path.join(OUT, "benchmark_results.json"), JSON.stringify(res, null, 2));
const csv = ["method,client,goal,mode,n_valid,valid_ids,eligible_by_method,top3"].concat([g0, g1].flatMap(m => m.rows.map((r: any) => [m.method.split(" ")[0], r.client, r.goal, r.mode, r.nValid, r.validIds, r.eligibleByMethod, `"${r.top}"`].join(","))));
fs.writeFileSync(path.join(OUT, "benchmark_top3_per_client.csv"), "\uFEFF" + csv.join("\n"));
console.log("sha", sha, "precheck agreement", res.truthAgreementWithPrecheck, "validDist", JSON.stringify(res.validCountDistribution));
console.log(JSON.stringify(R));
for (const m of [g0, g1]) { const { rows, ...s } = m; console.log(JSON.stringify(s)); }
for (const r of g0.rows) console.log(r.client, r.goal, r.mode, "valid=", r.validIds, "| G0:", r.top);
