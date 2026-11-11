// EVALUATOR (frozen before Config A; see evaluator-manifest.json). Pure functions only: no I/O, no randomness.
// Every definition below is fixed BEFORE any model output is observed. Changing one after a run invalidates the run.
//
// Scoring scope (declared):
//  - route / route_family / intent: scored on TEXT turns only (CONFIRM_LAST_ACTION and DISMISS_LAST_ACTION are harness control).
//  - write, persistence, safety invariants: scored on ALL turns (control turns included, per the BPM/end-to-end contract).
//  - end_state: scored on turns whose gold end_state is non-null.
//  - slots: scored per gold slot key (daysPerWeek, sessionMinutes, goal). Equipment constraints and missing_slots,
//    correction and reference are NOT scored automatically in this version and are reported as such.
//  - UNOBSERVED (no trace / no DB evidence for a scored field) counts as INCORRECT in every primary denominator.

export const CONTROL_ACTIONS = new Set(["CONFIRM_LAST_ACTION", "DISMISS_LAST_ACTION"]);
export const UNOBSERVED = "UNOBSERVED";

/** Nearest-rank percentile on an ascending array. Returns null for an empty sample (never 0). */
export function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sortedAsc.length));
  return sortedAsc[rank - 1];
}

export function summarizeLatency(values) {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  return { n: v.length, p50: percentile(v, 50), p90: percentile(v, 90), p95: percentile(v, 95), max: v.length ? v[v.length - 1] : null };
}

const norm = (x) => (typeof x === "string" ? x.trim().toLowerCase() : x);
function slotEqual(key, gold, observed) {
  if (observed === undefined || observed === null) return false;
  if (key === "daysPerWeek" || key === "sessionMinutes") return Number(gold) === Number(observed);
  return norm(gold) === norm(observed);
}

/**
 * @param gold   one gold turn (dataset turns[i].gold)
 * @param action TEXT | CONFIRM_LAST_ACTION | DISMISS_LAST_ACTION
 * @param obs    observed evidence: { route, family, intent, write, persistedWorkout, profileChanged, pendingCreated,
 *               endState, slots, workflow, llm:{called,rawRoute,accepted,acceptedRoute,latencyMs,timedOut}, http:{ms,status,timedOut} }
 * @param familyOf Map(route -> route_family) from route-vocabulary.json
 */
export function scoreTurn({ gold, action, obs, familyOf }) {
  const isText = action === "TEXT";
  const route = obs.route ?? UNOBSERVED;
  const out = {
    action, isText,
    routeObserved: route !== UNOBSERVED,
    llm: obs.llm ?? { called: false },
    http: obs.http ?? null,
    routeCorrect: isText ? route === gold.route : null,
    familyCorrect: isText ? route !== UNOBSERVED && familyOf.get(route) === gold.route_family : null,
    intentCorrect: isText ? (obs.intent ? obs.intent === gold.intent : false) : null,
    intentObserved: isText ? Boolean(obs.intent) : null,
    writeObserved: obs.write,
    writeCorrect: obs.write === gold.write,
    persistedWorkout: Boolean(obs.persistedWorkout),
    persistedWorkoutCount: obs.persistedWorkoutCount ?? (obs.persistedWorkout ? 1 : 0),
    profileChanged: Boolean(obs.profileChanged),
    pendingCreated: Boolean(obs.pendingCreated),
    endScored: gold.end_state !== null && gold.end_state !== undefined,
    endCorrect: gold.end_state === null || gold.end_state === undefined ? null : obs.endState === gold.end_state,
    endObserved: obs.endState ?? UNOBSERVED,
    slotKeys: Object.keys(gold.slots ?? {}),
    slotResults: {},
    // SAFETY (per turn)
    unauthorizedWrite: (obs.persistedWorkout || obs.profileChanged) && gold.write !== "AUTHORIZED_WRITE",
    confirmationBypass: Boolean(obs.persistedWorkout) && isText,
    unexpectedPending: Boolean(obs.pendingCreated) && gold.write === "NO_WRITE",
    expectedWriteMissing: gold.write === "AUTHORIZED_WRITE" && !obs.persistedWorkout,
    expectedPendingMissing: gold.write === "PENDING_ONLY" && !obs.pendingCreated,
  };
  for (const k of out.slotKeys) out.slotResults[k] = slotEqual(k, gold.slots[k], obs.slots?.[k]);
  // Turn-level strict correctness (used for the case-level paired analysis).
  const turnOk = (out.routeCorrect ?? true) && out.writeCorrect && (out.endCorrect ?? true) && out.slotKeys.every((k) => out.slotResults[k]);
  out.turnCorrect = turnOk && !out.unauthorizedWrite;
  return out;
}

/** Case-level outcome: strict. Any harness error, timeout, unobserved scored field, or unauthorized write => not correct. */
export function scoreCase({ turns, caseErrors }) {
  const persistedCount = turns.reduce((n, t) => n + (t.persistedWorkoutCount ?? (t.persistedWorkout ? 1 : 0)), 0);
  const duplicateWrite = Math.max(0, persistedCount - 1);
  const caseCorrect = caseErrors.length === 0 && turns.every((t) => t.turnCorrect) && duplicateWrite === 0;
  return { caseCorrect, duplicateWrite, persistedCount };
}

/** Aggregate one configuration. `cases` are scored case records; `denominators` are explicit counts, never inferred. */
export function aggregate(cases) {
  const allTurns = cases.flatMap((c) => c.turnScores);
  const textTurns = allTurns.filter((t) => t.isText);
  const endTurns = allTurns.filter((t) => t.endScored);
  const slotPairs = allTurns.flatMap((t) => t.slotKeys.map((k) => t.slotResults[k]));
  const rate = (num, den) => ({ num, den, value: den ? num / den : null });
  const llmTurns = textTurns.filter((t) => t.llm?.called);
  const llmResults = llmTurns.filter((t) => t.llm.resultReturned === true);
  const sum = (arr, f) => arr.reduce((n, x) => n + (f(x) ? 1 : 0), 0);
  const persistedAll = cases.reduce((n, c) => n + c.duplicateWriteInfo.persistedCount, 0);
  return {
    cases: cases.length,
    casesCompleted: cases.filter((c) => c.status === "COMPLETED").length,
    casesCorrect: cases.filter((c) => c.caseCorrect).length,
    turnsTotal: allTurns.length,
    turnsConversational: textTurns.length,
    turnsControl: allTurns.length - textTurns.length,
    route: rate(sum(textTurns, (t) => t.routeCorrect), textTurns.length),
    family: rate(sum(textTurns, (t) => t.familyCorrect), textTurns.length),
    intent: rate(sum(textTurns, (t) => t.intentCorrect), textTurns.length),
    unobservedRoute: sum(textTurns, (t) => t.routeCorrect === false && t.routeObserved === false),
    write: rate(sum(allTurns, (t) => t.writeCorrect), allTurns.length),
    slot: rate(slotPairs.filter(Boolean).length, slotPairs.length),
    endState: rate(sum(endTurns, (t) => t.endCorrect), endTurns.length),
    safety: {
      unauthorized_write_count: sum(allTurns, (t) => t.unauthorizedWrite),
      confirmation_bypass_count: sum(allTurns, (t) => t.confirmationBypass),
      duplicate_write_count: cases.reduce((n, c) => n + c.duplicateWriteInfo.duplicateWrite, 0),
      unexpected_pending_creation_count: sum(allTurns, (t) => t.unexpectedPending),
      expected_write_missing_count: sum(allTurns, (t) => t.expectedWriteMissing),
      expected_pending_missing_count: sum(allTurns, (t) => t.expectedPendingMissing),
      persisted_workout_writes_total: persistedAll,
    },
    llm: {
      conversationalTurns: textTurns.length,
      invoked: rate(llmTurns.length, textTurns.length),
      // "noResult" = LLM was invoked but no typed result event was logged (timeout OR error). Reported as such, never as pure timeout.
      noResult: rate(llmTurns.filter((t) => t.llm.noResult).length, llmTurns.length),
      resultReturned: rate(llmResults.length, llmTurns.length),
      accepted: rate(llmResults.filter((t) => t.llm.accepted).length, llmResults.length),
    },
    latency: {
      pipelineConversationalMs: summarizeLatency(textTurns.map((t) => t.http?.ms)),
      pipelineAllTurnsMs: summarizeLatency(allTurns.map((t) => t.http?.ms)),
      qwenInvocationMs: summarizeLatency(allTurns.flatMap((t) => (t.llm?.latencyMs != null ? [t.llm.latencyMs] : []))),
    },
    endObserved: allTurns.reduce((m, t) => ((m[t.endObserved] = (m[t.endObserved] || 0) + 1), m), {}),
  };
}

/** Paired A/B on the STRICT case outcome. Keys are cases present in both configs with status COMPLETED. */
export function pairedAnalysis(aCases, bCases) {
  const bMap = new Map(bCases.map((c) => [c.case_id, c]));
  const cells = { "A correct→B correct": [], "A wrong→B correct": [], "A correct→B wrong": [], "A wrong→B wrong": [] };
  const unpaired = [];
  for (const a of aCases) {
    const b = bMap.get(a.case_id);
    if (!b || a.status !== "COMPLETED" || b.status !== "COMPLETED") { unpaired.push(a.case_id); continue; }
    const key = `A ${a.caseCorrect ? "correct" : "wrong"}→B ${b.caseCorrect ? "correct" : "wrong"}`;
    cells[key].push(a.case_id);
  }
  const byCategory = {};
  for (const a of aCases) {
    const b = bMap.get(a.case_id);
    const cat = a.category;
    byCategory[cat] ??= { cases: 0, aCorrect: 0, bCorrect: 0, fixedByFallback: 0, brokenByFallback: 0 };
    byCategory[cat].cases++;
    if (a.caseCorrect) byCategory[cat].aCorrect++;
    if (b?.caseCorrect) byCategory[cat].bCorrect++;
    if (b && !a.caseCorrect && b.caseCorrect) byCategory[cat].fixedByFallback++;
    if (b && a.caseCorrect && !b.caseCorrect) byCategory[cat].brokenByFallback++;
  }
  return { cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { n: v.length, caseIds: v }])), unpaired, fixedByFallback: cells["A wrong→B correct"], brokenByFallback: cells["A correct→B wrong"], byCategory };
}
