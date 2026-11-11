// R1.1 - real Qwen3 4B smoke test for PT and Program narration (not part of the
// automated suite - narration is presentation-only, so correctness does not
// require a live model; this script exists to produce real evidence of
// call count / latency / timeout-or-not / fallback-used / structured-recommendation-preserved
// against the exact pinned tag, mirroring unified-coach-qwen-smoke.ts.
import { narrateRecommendations } from "../llm/recommendation_narrator";
import { narrateProgramRecommendations } from "../llm/program_recommendation_narrator";

const ptCandidate = (id: string) => ({
  candidate: { id, name: `PT ${id}`, specialties: ["MUSCLE_GAIN"], availableDays: [1, 3, 5], packages: [{ price: 1000000 }], reviewCount: 10, averageRating: 4.5, certificates: [], yearsExperience: "3 năm" },
  compatibility: { total: 80, components: { specialty: 40, schedule: 40 }, reasons: ["Chuyên tăng cơ", "Rảnh T2/T4/T6"] },
  history: { count: 1, note: "" },
}) as any;
const programCandidate = (id: string) => ({
  program: { id, name: `Program ${id}`, goal: "MUSCLE_GAIN", daysPerWeek: 4, durationWeeks: 8, estimatedMinutes: 60, experienceLevel: "INTERMEDIATE", focusMuscles: ["CHEST", "BACK"], fingerprint: `fp-${id}`, dataOrigin: "REAL" },
  compatibility: { total: 75, components: { goal: 40, schedule: 35 }, reasons: ["Khớp mục tiêu tăng cơ"] },
}) as any;

const PT = [ptCandidate("pt-1"), ptCandidate("pt-2")];
const PROGRAMS = [programCandidate("prog-1"), programCandidate("prog-2")];

async function run() {
  console.log("env", { LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_MODEL: process.env.LLM_MODEL, RECOMMENDATION_NARRATION_TIMEOUT_MS: process.env.RECOMMENDATION_NARRATION_TIMEOUT_MS });

  const ptIdsBefore = JSON.stringify(PT.map(c => c.candidate.id));
  const t0 = Date.now();
  const ptOut = await narrateRecommendations(PT, [], { userId: "smoke-pt" });
  const ptMs = Date.now() - t0;
  const ptIdsAfter = JSON.stringify(PT.map(c => c.candidate.id));
  console.log(JSON.stringify({
    kind: "pt",
    latencyMs: ptMs,
    usedFallback: ptOut.usedFallback,
    candidateIdsPreserved: ptIdsBefore === ptIdsAfter,
    narrationCandidateIds: ptOut.narrations.map(n => n.candidateId),
    expectedCandidateIds: PT.map(c => c.candidate.id),
    summaries: ptOut.narrations.map(n => n.summary),
  }, null, 2));

  const progIdsBefore = JSON.stringify(PROGRAMS.map(c => c.program.id));
  const t1 = Date.now();
  const progOut = await narrateProgramRecommendations(PROGRAMS, [], { userId: "smoke-prog" });
  const progMs = Date.now() - t1;
  const progIdsAfter = JSON.stringify(PROGRAMS.map(c => c.program.id));
  console.log(JSON.stringify({
    kind: "program",
    latencyMs: progMs,
    usedFallback: progOut.usedFallback,
    candidateIdsPreserved: progIdsBefore === progIdsAfter,
    narrationCandidateIds: progOut.narrations.map(n => n.candidateId),
    expectedCandidateIds: PROGRAMS.map(c => c.program.id),
    summaries: progOut.narrations.map(n => n.summary),
  }, null, 2));
}

run().then(() => process.exit(0)).catch(err => { console.error("SMOKE_FAILED", err); process.exit(1); });
