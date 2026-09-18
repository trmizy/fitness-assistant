import type { SlotDefinition, WorkflowContext } from "./types";

export type SlotResolution = { key: string; status: "KNOWN" | "MISSING"; value?: unknown };

/** Resolves every slot in a workflow definition against real context +
 * whatever has been collected so far this workflow. A slot already present
 * in `ctx.known` (set earlier this same workflow, including just-confirmed
 * profile updates) always wins over re-reading context, so a value the user
 * already gave this conversation is never asked for twice
 * (docs/...§Workflow-local data reuse). */
export function resolveSlots(slots: SlotDefinition[], ctx: WorkflowContext): SlotResolution[] {
  return slots.map((slot) => {
    if (slot.key in ctx.known && ctx.known[slot.key] !== undefined) {
      return { key: slot.key, status: "KNOWN", value: ctx.known[slot.key] };
    }
    const fromContext = slot.readFromContext(ctx);
    if (fromContext !== undefined && fromContext !== null) {
      return { key: slot.key, status: "KNOWN", value: fromContext };
    }
    return { key: slot.key, status: "MISSING" };
  });
}

function isRequired(slot: SlotDefinition, ctx: WorkflowContext): boolean {
  return typeof slot.required === "function" ? slot.required(ctx) : slot.required;
}

/** Slots that are both MISSING and actually required right now (a
 * goal-conditional slot like targetWeight is excluded once the resolved
 * goal doesn't need it) — this is the ONLY thing the orchestrator is
 * allowed to ask about (docs/...§17: "ask only for MISSING required
 * slots"). */
export function missingRequiredSlots(slots: SlotDefinition[], ctx: WorkflowContext): SlotDefinition[] {
  const resolved = new Map(resolveSlots(slots, ctx).map((r) => [r.key, r]));
  return slots.filter((slot) => resolved.get(slot.key)?.status === "MISSING" && isRequired(slot, ctx));
}

/** UX default (docs/...§18): ask the smallest useful group, not a 12-field
 * form. One at a time is the safest default for reliable multi-turn
 * interpretation (§19 — the NEXT reply is interpreted against exactly one
 * expectedSlot); a batch question naming the rest is only used when there
 * is more than one missing field, so the user knows what's still coming. */
export function buildMissingSlotsQuestion(missing: SlotDefinition[], ctx: WorkflowContext): { expectedSlot: string; question: string } {
  const first = missing[0];
  if (missing.length === 1) {
    return { expectedSlot: first.key, question: first.question(ctx) };
  }
  return {
    expectedSlot: first.key,
    question: `Mình còn cần thêm ${missing.length} thông tin: ${missing.map((s) => s.label).join(", ")}. ${first.question(ctx)}`,
  };
}

/** Known-vs-missing summary for the WORKFLOW_MISSING_DATA card
 * (docs/...§69 — "makes the agent's reasoning visible without exposing
 * chain-of-thought"). Never includes internal model reasoning, only
 * resolved field labels/values. */
export function buildKnownMissingSummary(slots: SlotDefinition[], ctx: WorkflowContext): { known: { label: string; value: string }[]; missing: string[] } {
  const resolved = resolveSlots(slots, ctx);
  const byKey = new Map(slots.map((s) => [s.key, s]));
  const known: { label: string; value: string }[] = [];
  const missing: string[] = [];
  for (const r of resolved) {
    const slot = byKey.get(r.key)!;
    if (r.status === "KNOWN") known.push({ label: slot.label, value: slot.format(r.value as never) });
    else if (isRequired(slot, ctx)) missing.push(slot.label);
  }
  return { known, missing };
}
