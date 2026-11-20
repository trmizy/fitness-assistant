/**
 * REAL DEVICE complaint (20/11, typed without diacritics): "Tim PT giam mo o Go Vap, ngan sach 5 trieu, tap truc tiep" re-asked the
 * budget, and the follow-up "5 trieu, giam mo, o Go Vap, truc tiep" returned PT cards with no distance because placeText never reached
 * findPTCandidates. Oracle: hand-labelled expected values. Drives the REAL entry used by /ai/ask and /ai/ask/stream
 * (ragService -> orchestrator -> fitnessAgent.tryTurn -> runWorkflowTurn -> resume -> buildAndPersistRecommendation) with the DB replaced
 * by an in-memory fake (TEST FIXTURE) and the tool boundary (profile, findPTCandidates, narrator) stubbed — so it needs no Postgres.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/conversation.repository";
import { Prisma } from "../generated/prisma";
import { fitnessAgent, fitnessAgentDeps } from "../services/fitness-agent.service";

// ---- in-memory DB fake (only the tables the PT flow really touches; everything else answers "nothing there") ----------------------
type Row = Record<string, any>;
const workflowRows: Row[] = [];
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "notIn" in v) return !(v as any).notIn.includes(row[k]);
    if (v && typeof v === "object" && ("gt" in v || "not" in v)) return true;
    return row[k] === v;
  });
}
const workflowFake = {
  async create({ data }: { data: Row }) { const row = { id: randomUUID(), createdAt: new Date(), revision: 0, expectedSlot: null, pendingProfileUpdate: null, draftRef: null, ...data }; workflowRows.push(row); return row; },
  async findFirst({ where }: { where: Row }) { return [...workflowRows].reverse().find((r) => matches(r, where)) ?? null; },
  async findMany({ where }: { where: Row }) { return workflowRows.filter((r) => matches(r, where)); },
  async update({ where, data }: { where: Row; data: Row }) {
    const row = workflowRows.find((r) => r.id === where.id)!;
    for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === "object" && "increment" in v ? row[k] + (v as any).increment : v;
    return row;
  },
  async updateMany({ where, data }: { where: Row; data: Row }) {
    const hit = workflowRows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length };
  },
};
const recommendationRows: Row[] = [];
const genericFake = (extra: Record<string, unknown> = {}) => new Proxy(extra, {
  get: (t, name: string) => (name in t ? (t as any)[name] : name === "findMany" ? async () => [] : name === "count" ? async () => 0
    : name === "create" || name === "upsert" ? async (a: any) => ({ id: randomUUID(), ...(a?.data ?? {}) }) : name === "updateMany" || name === "deleteMany" ? async () => ({ count: 0 }) : async () => null),
});
for (const model of Object.values(Prisma.ModelName) as string[]) {
  const key = model.charAt(0).toLowerCase() + model.slice(1);
  const fake = key === "agentWorkflowSession" ? workflowFake
    : key === "chatSession" ? genericFake({ findFirst: async () => ({ id: "s" }) })
    : key === "fitnessRecommendation" ? genericFake({ create: async ({ data }: { data: Row }) => { recommendationRows.push(data); return data; }, findMany: async () => [...recommendationRows].reverse() })
    : genericFake();
  Object.defineProperty(prisma, key, { value: fake, configurable: true });
}

// ---- tool boundary --------------------------------------------------------------------------------------------------------------
const original = { ...fitnessAgentDeps.tools, narrate: fitnessAgentDeps.narrateRecommendations };
test.afterEach(() => { delete process.env.CONVERSATIONAL_INTELLIGENCE_V2; Object.assign(fitnessAgentDeps.tools, original); fitnessAgentDeps.narrateRecommendations = original.narrate; });

const PT = { id: "pt-1", name: "PT Một", photoUrl: null, specialties: ["Giảm mỡ"], yearsExperience: 3, languages: [], certificates: [],
  packages: [{ id: "pk", name: "8 buổi", price: 4_000_000, sessions: 8, sessionMinutes: 60, mode: "OFFLINE" }],
  availableDays: [1, 3, 5], availableSlots: 10, averageRating: 4.5, reviewCount: 3, clientsStarted: 2, clientsCompleted: 1,
  cancellationRate: null, noShowRate: null, dataOrigin: "REAL",
  history: { count: 0, medianWeightChange: null, medianTrainingAdherence: null, medianNutritionAdherence: null, medianDurationWeeks: null, completionRate: null, dataOrigin: "REAL", similarityVersion: "x", note: "" } };

function arrange(profile: Record<string, unknown>, mode: "off" | "on") {
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = mode;
  const calls: any[] = [];
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({
    profile: { goal: "MUSCLE_GAIN", experience: "BEGINNER", days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, reviewRequired: false, injuries: [], equipment: [], goalIntent: null, ...profile },
    coach: { training_summary: {}, nutrition_summary: {} },
  } as any);
  fitnessAgentDeps.tools.findPTCandidates = async (_i: any, preferences: any) => { calls.push(preferences); return { candidates: [PT], truncated: false, historyAuditId: null } as any; };
  fitnessAgentDeps.tools.getScientificEvidence = () => [] as any;
  fitnessAgentDeps.narrateRecommendations = async () => ({ narrations: [], usedFallback: true }) as any;
  return calls;
}
const ask = (q: string, userId: string, sessionId = "s") => fitnessAgent.tryTurn(q, { userId } as any, sessionId);

// CONVERSATIONAL_INTELLIGENCE_V2 is read per call; the real stack may run with it on, so both modes are covered.
for (const mode of ["off", "on"] as const) {

  test(`[CI-V2 ${mode}] device turn 1: 'Tim PT giam mo o Go Vap, ngan sach 5 trieu, tap truc tiep' (profile has days, no budget) searches at once — no budget re-ask — with goal/budget/mode/placeText`, async () => {
    const calls = arrange({}, mode);
    const r = await ask("Tim PT giam mo o Go Vap, ngan sach 5 trieu, tap truc tiep", `u-${randomUUID()}`);
    assert.equal(r!.blocks[0].type, "PT_RECOMMENDATIONS", `got: ${r!.answer}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].budgetVnd, 5_000_000);
    assert.equal(calls[0].goal, "WEIGHT_LOSS", "the goal typed in the message wins over the profile's MUSCLE_GAIN");
    assert.equal(calls[0].mode, "OFFLINE");
    assert.equal(calls[0].placeText, "go vap");
  });

  test(`[CI-V2 ${mode}] device turn 1 with NO days on file: only the days are asked (never the budget); the days answer then searches with place+mode kept`, async () => {
    const calls = arrange({ days: [] }, mode);
    const userId = `u-${randomUUID()}`;
    const r1 = await ask("Tim PT giam mo o Go Vap, ngan sach 5 trieu, tap truc tiep", userId);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA");
    assert.ok(!/ngân sách/i.test(r1!.answer), `must not ask the budget: ${r1!.answer}`);
    const r2 = await ask("T2 T4 T6", userId);
    assert.equal(r2!.blocks[0].type, "PT_RECOMMENDATIONS");
    assert.equal(calls[0].placeText, "go vap");
    assert.equal(calls[0].mode, "OFFLINE");
    assert.equal(calls[0].budgetVnd, 5_000_000);
  });

  test(`[CI-V2 ${mode}] device turn 2: the follow-up '5 trieu, giam mo, o Go Vap, truc tiep' answers the budget AND carries goal/mode/placeText to findPTCandidates`, async () => {
    const calls = arrange({}, mode);
    const userId = `u-${randomUUID()}`;
    const r1 = await ask("Tim PT cho toi", userId);
    assert.equal(r1!.blocks[0].type, "WORKFLOW_MISSING_DATA", "no budget anywhere -> the budget is asked");
    const r2 = await ask("5 trieu, giam mo, o Go Vap, truc tiep", userId);
    assert.equal(r2!.blocks[0].type, "PT_RECOMMENDATIONS", `got: ${r2!.answer}`);
    assert.equal(calls[0].budgetVnd, 5_000_000);
    assert.equal(calls[0].goal, "WEIGHT_LOSS");
    assert.equal(calls[0].mode, "OFFLINE");
    assert.equal(calls[0].placeText, "go vap");
  });

  test(`[CI-V2 ${mode}] device: 'PT giam mo 5 trieu' and 'Tim PT online tang co, 3 trieu' are not re-asked the budget`, async () => {
    const calls = arrange({}, mode);
    const a = await ask("PT giam mo 5 trieu", `u-${randomUUID()}`);
    assert.equal(a!.blocks[0].type, "PT_RECOMMENDATIONS", `got: ${a!.answer}`);
    assert.equal(calls[0].budgetVnd, 5_000_000);
    const b = await ask("Tim PT online tang co, 3 trieu", `u-${randomUUID()}`);
    assert.equal(b!.blocks[0].type, "PT_RECOMMENDATIONS", `got: ${b!.answer}`);
    assert.equal(calls[1].budgetVnd, 3_000_000);
    assert.equal(calls[1].mode, "ONLINE");
    assert.equal(calls[1].goal, "MUSCLE_GAIN");
  });
}
