/**
 * Thực nghiệm NCKH: ghép nối PT bằng chấm điểm tương thích đa tiêu chí (Gymini).
 * - Gọi TRỰC TIẾP mã sản phẩm: scorePT / journeySimilarity / summarizeJourneys / GOAL_SPECIALTIES
 *   (backend/shared/src/fitness-agent-scoring.ts, phiên bản compatibility-v2).
 * - Bộ lọc cứng mô phỏng lại đúng điều kiện của agentic-fitness.service.ts::candidates().
 * - Dữ liệu là MÔ PHỎNG (synthetic) có seed cố định -> tái lập được.
 * Chạy: backend/services/ai-service/node_modules/.bin/tsx reports/nckh-pt-matching/experiment/run_pt_matching_experiment.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  scorePT, journeySimilarity, summarizeJourneys, FITNESS_SCORING, GOAL_SPECIALTIES,
} from "../../../../backend/shared/src/fitness-agent-scoring";

const OUT = path.resolve(__dirname, "../results");
fs.mkdirSync(OUT, { recursive: true });

// ---------- RNG ----------
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
type Rng = () => number;
const gauss = (r: Rng) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const pick = <T,>(r: Rng, xs: T[]) => xs[Math.floor(r() * xs.length)];
const sample = <T,>(r: Rng, xs: T[], k: number) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, k); };
const weighted = <T,>(r: Rng, items: Array<[T, number]>) => { let x = r(); for (const [v, w] of items) { if ((x -= w) <= 0) return v; } return items[items.length - 1][0]; };

const GOALS = ["WEIGHT_LOSS", "MUSCLE_GAIN", "MAINTENANCE", "ATHLETIC_PERFORMANCE"] as const;
const EXPS = ["BEGINNER", "INTERMEDIATE", "ADVANCED"] as const;
const BANDS = ["LEAN", "MID", "HIGH"] as const; // nhóm thể trạng theo % mỡ: <18, 18-27, >=27
type Band = typeof BANDS[number];
const DAYS = [1, 2, 3, 4, 5, 6, 7];
let RATING_MODE: "informative" | "inflated" = "informative";

function genBody(r: Rng, band: Band) {
  const bf = band === "LEAN" ? 10 + 8 * r() : band === "MID" ? 18 + 9 * r() : 27 + 13 * r();
  const w = band === "LEAN" ? 55 + 25 * r() : band === "MID" ? 60 + 30 * r() : 70 + 45 * r();
  return { weight: Math.round(w * 10) / 10, bodyFat: Math.round(bf * 10) / 10 };
}

// ---------- PT ----------
interface SimPT {
  id: string; specialties: string[]; goals: string[]; availableDays: number[];
  packages: Array<{ id: string; name: string; price: number; sessions: number; sessionMinutes: number; mode: string }>;
  averageRating: number | null; reviewCount: number; availableSlots: number; isAcceptingClients: boolean;
  quality: Record<string, Record<Band, number>>; // chất lượng ẨN (ground truth), hệ thống không nhìn thấy
  journeys: any[]; coldStart: boolean;
}
function genPT(r: Rng, i: number): SimPT {
  const goals = sample(r, [...GOALS], r() < 0.6 ? 1 : 2);
  const base = 0.35 + 0.5 * r();
  const prefBand = pick(r, [...BANDS]);
  const quality: any = {};
  for (const g of GOALS) { quality[g] = {}; for (const b of BANDS)
    quality[g][b] = clamp(base + (goals.includes(g) ? 0.1 : -0.2) + (b === prefBand ? 0.15 : -0.08) + 0.07 * gauss(r)); }
  const availableDays = sample(r, DAYS, 3 + Math.floor(r() * 4)).sort();
  const nPk = 1 + Math.floor(r() * 3);
  const perSession = 150_000 + 250_000 * (0.6 * r() + 0.4 * base);
  const packages = Array.from({ length: nPk }, (_, k) => {
    const sessions = pick(r, [8, 12, 16]);
    const sessionMinutes = weighted(r, [[45, 0.25], [60, 0.5], [90, 0.25]]);
    return { id: `pt${i}-pk${k}`, name: `${sessions} buổi`, price: Math.round(perSession * sessions * (sessionMinutes / 60) / 50_000) * 50_000,
      sessions, sessionMinutes, mode: "OFFLINE" };
  });
  const coldStart = r() < 0.3;
  const nClients = coldStart ? Math.floor(r() * 4) : 5 + Math.floor(r() * 45);
  const journeys = Array.from({ length: nClients }, (_, k) => {
    const goal = pick(r, goals); const band = r() < 0.7 ? prefBand : pick(r, [...BANDS]);
    const body = genBody(r, band); const q = quality[goal][band];
    const trainingDays = 2 + Math.floor(r() * 4), durationWeeks = 8 + Math.floor(r() * 9);
    const sessionsPrescribed = trainingDays * durationWeeks;
    return { id: `pt${i}-j${k}`, ptId: `pt-${i}`, goal, experience: pick(r, [...EXPS]), baselineWeight: body.weight, baselineBodyFat: body.bodyFat,
      trainingDays, sessionMinutes: pick(r, [45, 60, 90]), durationWeeks, constraints: [],
      sessionsPrescribed, sessionsCompleted: Math.round(sessionsPrescribed * clamp(q + 0.1 * gauss(r))),
      nutritionAdherence: clamp(q + 0.1 * gauss(r)), endingWeight: body.weight - (goal === "WEIGHT_LOSS" ? 7 * q : goal === "MUSCLE_GAIN" ? -3 * q : 0) + gauss(r),
      status: r() < q ? "COMPLETED" : "ENDED" };
  });
  const qOverall = goals.reduce((s, g) => s + BANDS.reduce((t, b) => t + quality[g][b], 0) / 3, 0) / goals.length;
  const reviewCount = coldStart ? Math.floor(r() * 3) : Math.floor(nClients * (0.3 + 0.4 * r()));
  // informative: sao phản ánh chất lượng; inflated: sao bị thổi phồng, dồn về 4.3-5 (phân bố chữ J như sàn thật)
  const rating = RATING_MODE === "informative"
    ? clamp(3.2 + 1.8 * qOverall + 0.3 * gauss(r) + (nClients > 30 ? 0.15 : 0), 1, 5)
    : clamp(4.35 + 0.5 * qOverall + 0.35 * gauss(r) + (nClients > 30 ? 0.15 : 0), 1, 5);
  return { id: `pt-${i}`, specialties: goals.map(g => GOAL_SPECIALTIES[g][0]), goals, availableDays, packages,
    averageRating: reviewCount > 0 ? Math.round(rating * 10) / 10 : null, reviewCount,
    availableSlots: r() < 0.1 ? 4 : 20, isAcceptingClients: r() > 0.05, quality, journeys, coldStart };
}

// ---------- Người tập ----------
interface SimUser { id: string; goal: string; experience: string; band: Band; weight: number; bodyFat: number;
  days: number[]; sessionMinutes: number; budgetVnd: number; }
function genUser(r: Rng, i: number): SimUser {
  const band = weighted<Band>(r, [["HIGH", 0.35], ["MID", 0.4], ["LEAN", 0.25]]);
  const body = genBody(r, band);
  return { id: `u-${i}`, goal: pick(r, [...GOALS]), experience: pick(r, [...EXPS]), band, ...body,
    days: sample(r, DAYS, 2 + Math.floor(r() * 3)).sort(), sessionMinutes: weighted(r, [[45, 0.2], [60, 0.55], [90, 0.25]]),
    budgetVnd: Math.round((1_500_000 + 4_500_000 * r()) / 100_000) * 100_000 };
}

// ---------- Bộ lọc cứng (mirror agentic-fitness.service.ts::candidates) ----------
function eligiblePackages(pt: SimPT, u: SimUser) {
  return pt.packages.filter(p => p.price <= u.budgetVnd && p.sessionMinutes <= u.sessionMinutes && pt.availableSlots >= p.sessions);
}
function isFeasible(pt: SimPT, u: SimUser) {
  const aliases = GOAL_SPECIALTIES[u.goal] ?? [];
  return pt.isAcceptingClients && pt.specialties.some(s => aliases.includes(s))
    && u.days.every(d => pt.availableDays.includes(d)) && eligiblePackages(pt, u).length > 0;
}
// Lịch sử hành trình tương tự (chỉ số cơ thể) — mirror bộ lọc cohort của service + journeySimilarity >= 0.65
function historyFor(pt: SimPT, u: SimUser) {
  const base = { goal: u.goal, experience: u.experience, baselineWeight: u.weight, baselineBodyFat: u.bodyFat,
    trainingDays: u.days.length, sessionMinutes: u.sessionMinutes, durationWeeks: 12, constraints: [] as string[] };
  const cohort = pt.journeys
    .filter(j => j.goal === u.goal && j.experience === u.experience && Math.abs(j.baselineWeight - u.weight) <= 30)
    .map(j => ({ j, s: journeySimilarity(base, j) })).filter(x => x.s >= 0.65)
    .sort((a, b) => b.s - a.s || a.j.id.localeCompare(b.j.id)).slice(0, FITNESS_SCORING.maximumCohort).map(x => x.j);
  return summarizeJourneys(cohort, "REAL");
}
function toCandidate(pt: SimPT, u: SimUser, filtered: boolean): any {
  return { id: pt.id, name: pt.id, photoUrl: null, specialties: pt.specialties, yearsExperience: null, languages: [], certificates: [],
    packages: filtered ? eligiblePackages(pt, u) : pt.packages, availableDays: pt.availableDays, availableSlots: pt.availableSlots,
    averageRating: pt.averageRating, reviewCount: pt.reviewCount, clientsStarted: pt.journeys.length, clientsCompleted: 0,
    cancellationRate: null, noShowRate: null, dataOrigin: "REAL", history: historyFor(pt, u) };
}

// v1 (trước commit 96c1040f): cold-start bị tính evidence = 0 trong mẫu số
function scorePTv1(c: any, p: any) {
  const W = FITNESS_SCORING.weights; const aliases = GOAL_SPECIALTIES[p.goal] ?? []; const days = p.days ?? [];
  const comp: any = { goal: aliases.some((v: string) => c.specialties.includes(v)) ? 1 : 0,
    schedule: days.length ? days.filter((d: number) => c.availableDays.includes(d)).length / days.length : 0,
    budget: p.budgetVnd ? (c.packages.some((x: any) => x.price <= p.budgetVnd) ? 1 : 0) : 0,
    reputation: c.reviewCount >= 5 && c.averageRating !== null ? c.averageRating / 5 : 0,
    evidence: c.history.count >= FITNESS_SCORING.minimumCohort ? Math.min(1, c.history.count / FITNESS_SCORING.maximumCohort) : 0 };
  const tw = Object.values(W).reduce((a, b) => a + b, 0);
  return Math.round(100 * Object.entries(comp).reduce((s, [k, v]) => s + (v as number) * (W as any)[k], 0) / tw);
}
const cfg = (w: Partial<typeof FITNESS_SCORING.weights>) => ({ ...FITNESS_SCORING, weights: { ...FITNESS_SCORING.weights, ...w } }) as any;
// Biến thể THỬ NGHIỆM (không có trong sản phẩm): evidence xét cả kết quả (tỉ lệ hoàn thành) của nhóm tương tự
function scoreOutcomeAware(c: any, p: any) {
  const s = scorePT(c, p); if (c.history.count < FITNESS_SCORING.minimumCohort) return s.total;
  const W = FITNESS_SCORING.weights; const comp = { ...s.components, evidence: 0.5 * Math.min(1, c.history.count / 20) + 0.5 * (c.history.completionRate ?? 0) };
  const tw = Object.keys(comp).reduce((a, k) => a + (W as any)[k], 0);
  return Math.round(100 * Object.entries(comp).reduce((a, [k, v]) => a + (v as number) * (W as any)[k], 0) / tw);
}

// Biến thể X2 (đề xuất cải tiến nhỏ): giữ nguyên v2 nhưng KHÔNG làm tròn điểm, hoà thì ưu tiên sao rồi số đánh giá
function rawV2(c: any, p: any) {
  const s = scorePT(c, p); const W = FITNESS_SCORING.weights as any;
  const tw = Object.keys(s.components).reduce((a, k) => a + W[k], 0);
  return Object.entries(s.components).reduce((a, [k, v]) => a + (v as number) * W[k], 0) / tw * 100;
}
type Ranked = { id: string; score?: number }[];
const byScore = (xs: Ranked) => xs.sort((a, b) => (b.score! - a.score!) || a.id.localeCompare(b.id));
const ratingKey = (pt: SimPT) => (pt.averageRating ?? 0) * 1000 + pt.reviewCount;

const METHODS: Record<string, { label: string; run: (pts: SimPT[], u: SimUser, r: Rng) => Ranked; scored: boolean }> = {
  RANDOM: { label: "M0 Ngẫu nhiên", scored: false, run: (pts, _u, r) => sample(r, pts, pts.length).map(p => ({ id: p.id })) },
  RATING_ONLY: { label: "M1 Chỉ theo đánh giá sao", scored: false, run: pts => [...pts].sort((a, b) => ratingKey(b) - ratingKey(a) || a.id.localeCompare(b.id)).map(p => ({ id: p.id })) },
  SCORE_NO_FILTER: { label: "M2 Chấm điểm, không lọc cứng", scored: true, run: (pts, u) => byScore(pts.map(p => ({ id: p.id, score: scorePT(toCandidate(p, u, false), u as any).total }))) },
  FILTER_PRICE: { label: "M3 Lọc cứng + giá rẻ nhất", scored: false, run: (pts, u) => pts.filter(p => isFeasible(p, u))
      .sort((a, b) => Math.min(...eligiblePackages(a, u).map(x => x.price)) - Math.min(...eligiblePackages(b, u).map(x => x.price)) || a.id.localeCompare(b.id)).map(p => ({ id: p.id })) },
  FILTER_RATING: { label: "M4 Lọc cứng + đánh giá sao", scored: false, run: (pts, u) => pts.filter(p => isFeasible(p, u)).sort((a, b) => ratingKey(b) - ratingKey(a) || a.id.localeCompare(b.id)).map(p => ({ id: p.id })) },
  HYBRID_V1: { label: "M5 Lọc cứng + đa tiêu chí v1", scored: true, run: (pts, u) => byScore(pts.filter(p => isFeasible(p, u)).map(p => ({ id: p.id, score: scorePTv1(toCandidate(p, u, true), u) }))) },
  HYBRID_V2: { label: "M6 Lọc cứng + đa tiêu chí v2 (đề xuất)", scored: true, run: (pts, u) => byScore(pts.filter(p => isFeasible(p, u)).map(p => ({ id: p.id, score: scorePT(toCandidate(p, u, true), u as any).total }))) },
  // Ablation
  ABL_NO_GOAL_SCHED_BUDGET: { label: "A1 v2 bỏ mục tiêu+lịch+ngân sách", scored: true, run: (pts, u) => byScore(pts.filter(p => isFeasible(p, u)).map(p => ({ id: p.id, score: scorePT(toCandidate(p, u, true), u as any, cfg({ goal: 0, schedule: 0, budget: 0 })).total }))) },
  ABL_NO_REPUTATION: { label: "A2 v2 bỏ uy tín (sao)", scored: true, run: (pts, u) => byScore(pts.filter(p => isFeasible(p, u)).map(p => ({ id: p.id, score: scorePT(toCandidate(p, u, true), u as any, cfg({ reputation: 0 })).total }))) },
  ABL_NO_EVIDENCE: { label: "A3 v2 bỏ bằng chứng chỉ số cơ thể", scored: true, run: (pts, u) => byScore(pts.filter(p => isFeasible(p, u)).map(p => ({ id: p.id, score: scorePT(toCandidate(p, u, true), u as any, cfg({ evidence: 0 })).total }))) },
  EXP_OUTCOME_AWARE: { label: "X1 v2 + bằng chứng theo kết quả (thử nghiệm)", scored: true, run: (pts, u) => byScore(pts.filter(p => isFeasible(p, u)).map(p => ({ id: p.id, score: scoreOutcomeAware(toCandidate(p, u, true), u) }))) },
  EXP_UNROUNDED_TIEBREAK: { label: "X2 v2 không làm tròn + phá hoà theo sao", scored: true, run: (pts, u) => pts.filter(p => isFeasible(p, u))
      .map(p => ({ p, id: p.id, score: rawV2(toCandidate(p, u, true), u) }))
      .sort((a, b) => (b.score - a.score) || (ratingKey(b.p) - ratingKey(a.p)) || a.id.localeCompare(b.id)).map(x => ({ id: x.id, score: x.score })) },
};

const K = 5, REL_T = 0.6;
function gain(pt: SimPT, u: SimUser) { return isFeasible(pt, u) ? pt.quality[u.goal][u.band] : 0; }
function dcg(g: number[]) { return g.reduce((s, x, i) => s + (Math.pow(2, x) - 1) / Math.log2(i + 2), 0); }

function runSeed(seed: number, nPT: number, nUser: number) {
  const r = mulberry32(seed);
  const pts = Array.from({ length: nPT }, (_, i) => genPT(r, i));
  const users = Array.from({ length: nUser }, (_, i) => genUser(r, i));
  const byId = new Map(pts.map(p => [p.id, p]));
  const acc: Record<string, any> = {};
  for (const m of Object.keys(METHODS)) acc[m] = { ndcg: 0, prec: 0, recall: 0, hr1: 0, viol: 0, tie: 0, tieN: 0, csHit: 0, csN: 0, ms: 0, n: 0, nRecall: 0, returned: 0 };
  let empty = 0, feasibleCount = 0, evidenceCov = 0, evidenceDen = 0;
  for (const u of users) {
    const feasible = pts.filter(p => isFeasible(p, u));
    if (!feasible.length) { empty++; continue; }
    feasibleCount += feasible.length;
    for (const p of feasible) { evidenceDen++; if (historyFor(p, u).count >= FITNESS_SCORING.minimumCohort) evidenceCov++; }
    const gains = pts.map(p => gain(p, u)).sort((a, b) => b - a);
    const idcg = dcg(gains.slice(0, K)); const best = feasible.reduce((a, b) => gain(b, u) > gain(a, u) ? b : a);
    const nRel = feasible.filter(p => gain(p, u) >= REL_T).length;
    const bestIsCold = best.reviewCount < 5 && historyFor(best, u).count < FITNESS_SCORING.minimumCohort;
    for (const [m, def] of Object.entries(METHODS)) {
      const t0 = process.hrtime.bigint();
      const ranked = def.run(pts, u, mulberry32(seed * 7919 + Number(u.id.slice(2))));
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      const top = ranked.slice(0, K); const a = acc[m];
      const g = top.map(x => gain(byId.get(x.id)!, u));
      a.ndcg += idcg ? dcg(g) / idcg : 0; a.n++; a.ms += dt; a.returned += top.length;
      a.prec += top.length ? g.filter(x => x >= REL_T).length / top.length : 0;
      if (nRel) { a.recall += g.filter(x => x >= REL_T).length / Math.min(K, nRel); a.nRecall++; }
      a.hr1 += top[0]?.id === best.id ? 1 : 0;
      a.viol += top.length ? top.filter(x => !isFeasible(byId.get(x.id)!, u)).length / top.length : 0;
      if (def.scored && top.length >= 2) { a.tieN++; const s = top.map(x => x.score); if (new Set(s).size < s.length) a.tie++; }
      if (bestIsCold) { a.csN++; if (top.some(x => x.id === best.id)) a.csHit++; }
    }
  }
  const out: Record<string, any> = {};
  for (const [m, a] of Object.entries(acc)) out[m] = { ndcg5: a.ndcg / a.n, precision5: a.prec / a.n, recall5: a.nRecall ? a.recall / a.nRecall : 0,
    hitRate1: a.hr1 / a.n, violation5: a.viol / a.n, tieRate5: a.tieN ? a.tie / a.tieN : null, coldStartHit5: a.csN ? a.csHit / a.csN : null, coldStartN: a.csN,
    msPerQuery: a.ms / a.n, avgReturned: a.returned / a.n };
  return { methods: out, queries: nUser, answered: nUser - empty, emptyRate: empty / nUser, avgFeasible: feasibleCount / Math.max(1, nUser - empty),
    evidenceCoverage: evidenceCov / Math.max(1, evidenceDen), coldStartPTShare: pts.filter(p => p.coldStart).length / nPT,
    sample: seed === SEEDS[0] ? { pts: pts.slice(0, 5).map(p => ({ id: p.id, specialties: p.specialties, days: p.availableDays, packages: p.packages.map(x => `${x.sessions}b/${x.sessionMinutes}p/${x.price}`), rating: p.averageRating, reviews: p.reviewCount, journeys: p.journeys.length })),
      users: users.slice(0, 5).map(u => ({ id: u.id, goal: u.goal, exp: u.experience, weight: u.weight, bodyFat: u.bodyFat, days: u.days, sessionMinutes: u.sessionMinutes, budget: u.budgetVnd })) } : undefined };
}

const SEEDS = [11, 23, 37, 41, 53];
const N_USER = 300;
const SCENARIOS = [
  { id: "S1", nPT: 80, rating: "informative" as const, label: "S1: 80 PT, sao phản ánh chất lượng" },
  { id: "S2", nPT: 80, rating: "inflated" as const, label: "S2: 80 PT, sao bị thổi phồng" },
  { id: "S3", nPT: 250, rating: "informative" as const, label: "S3: 250 PT, sao phản ánh chất lượng" },
  { id: "S4", nPT: 250, rating: "inflated" as const, label: "S4: 250 PT, sao bị thổi phồng" },
];
const scenarioResults = SCENARIOS.map(sc => { RATING_MODE = sc.rating; return { ...sc, perSeed: SEEDS.map(s => runSeed(s, sc.nPT, N_USER)) }; });
const N_PT = 250; RATING_MODE = "inflated";

// Độ nhạy trọng số: reputation × evidence (trong tập đã lọc)
const sens: any[] = [];
for (const wr of [0, 5, 10, 20, 30]) for (const we of [0, 5, 15, 25, 35]) {
  const r = mulberry32(999); const pts = Array.from({ length: N_PT }, (_, i) => genPT(r, i)); const users = Array.from({ length: N_USER }, (_, i) => genUser(r, i));
  let s = 0, n = 0;
  for (const u of users) { const f = pts.filter(p => isFeasible(p, u)); if (!f.length) continue;
    const idcg = dcg(pts.map(p => gain(p, u)).sort((a, b) => b - a).slice(0, K));
    const top = byScore(f.map(p => ({ id: p.id, score: scorePT(toCandidate(p, u, true), u as any, cfg({ reputation: wr, evidence: we })).total }))).slice(0, K);
    s += dcg(top.map(x => gain(pts.find(p => p.id === x.id)!, u))) / idcg; n++; }
  sens.push({ wReputation: wr, wEvidence: we, ndcg5: s / n });
}

// Khả năng mở rộng: thời gian xử lý 1 truy vấn theo số PT
const scale: any[] = [];
for (const n of [100, 500, 1000, 5000]) {
  const r = mulberry32(7); const pts = Array.from({ length: n }, (_, i) => genPT(r, i)); const users = Array.from({ length: 30 }, (_, i) => genUser(r, i));
  const t0 = process.hrtime.bigint(); for (const u of users) METHODS.HYBRID_V2.run(pts, u, r);
  scale.push({ nPT: n, msPerQuery: Number(process.hrtime.bigint() - t0) / 1e6 / users.length });
}

fs.writeFileSync(path.join(OUT, "pt_matching_results.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), scoringVersion: FITNESS_SCORING.version, weights: FITNESS_SCORING.weights,
  setup: { seeds: SEEDS, nPTSensitivity: N_PT, nUserPerSeed: N_USER, K, relevanceThreshold: REL_T },
  labels: Object.fromEntries(Object.entries(METHODS).map(([k, v]) => [k, v.label])), scenarios: scenarioResults, sensitivityScenario: "S4", sensitivity: sens, scalability: scale,
}, null, 2));
console.log("done ->", path.join(OUT, "pt_matching_results.json"));
for (const sc of scenarioResults) { const main = sc.perSeed; console.log("=====", sc.label);
for (const m of Object.keys(METHODS)) {
  const v = (k: string) => main.map(x => x.methods[m][k] ?? 0); const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(m.padEnd(26), ["ndcg5", "precision5", "hitRate1", "violation5", "tieRate5", "coldStartHit5", "msPerQuery"].map(k => `${k}=${mean(v(k)).toFixed(3)}`).join(" "));
}
console.log("emptyRate", main.map(x => x.emptyRate.toFixed(3)).join(","), "avgFeasible", main.map(x => x.avgFeasible.toFixed(1)).join(","), "evidenceCov", main.map(x => x.evidenceCoverage.toFixed(3)).join(","));
}
console.log("sens", JSON.stringify(sens.map(x => [x.wReputation, x.wEvidence, +x.ndcg5.toFixed(3)])));
console.log("scale", JSON.stringify(scale));
