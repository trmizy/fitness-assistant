import { logger } from "@gym-coach/shared";
import type { AgentIdentity } from "../services/fitness-agent-tools";
import type { WorkflowContext, WorkflowDefinition, PendingProfileUpdate } from "./types";
import { allowsUseOnce } from "./types";
import { workflowStateRepository } from "./workflow-state.repository";
import { missingRequiredSlots, buildMissingSlotsQuestion, buildKnownMissingSummary } from "./slot-resolver";
import { normalizeAgentText } from "../services/fitness-agent-intent";

/**
 * The deterministic orchestration layer described in
 * docs/conversational-ai-coach-workflow-design.md. Owns: which fields are
 * required (via the registered WorkflowDefinition's slots), whether a value
 * is valid (slot.parse), whether persistence needs confirmation
 * (slot.persistence), and workflow transition rules (this file). It does
 * NOT own domain generation/ranking/writes — once a workflow's required
 * slots are all resolved, this module falls through to the EXISTING,
 * unmodified intent dispatch in fitness-agent.service.ts::tryTurn, which is
 * where every real preview/confirm/execute capability already lives.
 */

export type AgentBlockLike = { type: string; [key: string]: unknown };
export type TurnResult = {
  answer: string;
  blocks: AgentBlockLike[];
  /** Set ONLY alongside answer===RESUME_SENTINEL: the completed workflow's
   * own gatesIntentKind. The turn that resolves the last slot/confirmation
   * (e.g. a bare "72 kg" or "Xác nhận cập nhật" reply) almost never carries
   * a recognizable intent.kind of its own — the caller (tryTurn) MUST
   * dispatch on this instead of re-parsing the current message, or the
   * "automatically resume the SAME workflow" requirement silently breaks
   * (a real bug caught here: without this field, a resume turn fell through
   * to tryTurn's `!intent.kind` branch and returned null, i.e. the resumed
   * roadmap/PT/program generation never actually ran). */
  resumeIntentKind?: string;
  /** Set alongside resumeIntentKind: every slot this workflow resolved
   * (WORKFLOW_ONLY included) — e.g. FIND_PT's goal/days/sessionMinutes/
   * budgetVnd, which are deliberately never written to UserProfile (§44 "a
   * search preference is not necessarily a permanent profile fact") and so
   * would otherwise be invisible to the resumed dispatch, which reads
   * EnterpriseContext fresh. Without this, a resumed PT/PROGRAM search
   * would immediately re-hit "not enough preferences" and re-ask exactly
   * what the user just answered. */
  resumeKnownSlots?: Record<string, unknown>;
};
export const RESUME_SENTINEL = "__RESUME__";

export interface OrchestratorDeps {
  getUserFitnessContext: (identity: AgentIdentity) => Promise<{ profile: Record<string, unknown>; coach: unknown }>;
  updateProfileFields: (identity: AgentIdentity, fields: Record<string, unknown>) => Promise<unknown>;
}

const REGISTRY: WorkflowDefinition[] = [];
export function registerWorkflow(def: WorkflowDefinition): void {
  if (!REGISTRY.some((w) => w.type === def.type)) REGISTRY.push(def);
}
function workflowForIntentKind(kind: string | null): WorkflowDefinition | undefined {
  return REGISTRY.find((w) => w.gatesIntentKind === kind);
}
function workflowByType(type: string): WorkflowDefinition | undefined {
  return REGISTRY.find((w) => w.type === type);
}

// docs/...§20 "support workflow interruption" — checked BEFORE expected-slot
// interpretation so a genuine cancel is never mistaken for a slot answer.
const CANCEL_RE = /\b(thoi|huy|bo di|khong lam nua|cancel|stop|quit)\b/;
const CONFIRM_RE = /\b(xac nhan|dong y|ok|yes|confirm|dung roi|chuan)\b/;
// "(cho )?" — the real PROFILE_UPDATE_CONFIRMATION button text (see
// FitnessAgentBlocks.tsx) is "Chỉ dùng cho lần này", which normalizes to
// "chi dung cho lan nay"; a real bug caught by this module's own E2E test:
// the "cho" was missing here, so the button's own canned reply failed to
// match and fell through to a re-ask instead of declining persistence.
const USE_ONCE_RE = /\b(chi (dung|ap dung) (cho )?lan nay|dung 1 lan|one.?time|khong luu|dont save)\b/;
const DECLINE_RE = /\b(khong|huy|de sau|no|cancel)\b/;

async function buildContext(identity: AgentIdentity, deps: OrchestratorDeps, known: Record<string, unknown>): Promise<WorkflowContext> {
  const enterpriseContext = await deps.getUserFitnessContext(identity);
  return { identity, enterpriseContext, known };
}

/** Attempts to start OR continue a registered workflow for this turn.
 * Returns `null` when there is nothing for this layer to do — the caller
 * (fitness-agent.service.ts::tryTurn) must then run its own existing
 * dispatch unchanged, exactly as it did before this module existed. */
export async function runWorkflowTurn(
  question: string,
  identity: AgentIdentity,
  sessionId: string,
  intentKind: string | null,
  deps: OrchestratorDeps,
): Promise<TurnResult | null> {
  const active = await workflowStateRepository.findActive(identity.userId, sessionId);

  if (active) {
    const def = workflowByType(active.workflowType);
    if (!def) return null; // defensive — should never happen (registry is closed-world)

    if (CANCEL_RE.test(normalizeAgentText(question))) {
      await workflowStateRepository.cancel(active.id);
      return { answer: "Đã hủy yêu cầu này. Bạn có thể bắt đầu lại bất cứ lúc nào.", blocks: [] };
    }

    // §66/§20 — switching to a DIFFERENT workflow-triggering intent while
    // one is pending: cancel the old one explicitly rather than silently
    // mixing slot values across workflows (§67 — no slot leakage).
    const switchingTo = workflowForIntentKind(intentKind);
    if (switchingTo && switchingTo.type !== def.type) {
      await workflowStateRepository.cancel(active.id);
      return startWorkflow(switchingTo, question, identity, sessionId, deps);
    }

    if (active.status === "AWAITING_SLOT_CONFIRMATION") {
      return handleConfirmationReply(active, def, question, identity, sessionId, deps);
    }

    // COLLECTING_SLOTS + an expectedSlot — interpret this reply against
    // THAT slot first (§19 — expected-slot context has priority over
    // generic intent routing), regardless of what parseFitnessAgentIntent
    // thinks this message means.
    if (active.status === "COLLECTING_SLOTS" && active.expectedSlot) {
      return handleSlotReply(active, def, question, identity, deps);
    }
    return null;
  }

  const def = workflowForIntentKind(intentKind);
  if (!def) return null;
  return startWorkflow(def, question, identity, sessionId, deps);
}

/** Codex Evaluation #1 §12/§19-27 — a rich initiating (or later, while
 * other slots are still missing) message can carry values for several
 * slots at once; §11/§50 requires every extracted candidate to still pass
 * that slot's own contextual safety validator before being trusted — an
 * unsafe extracted value is silently dropped (never blocks the turn),
 * left to be asked normally so the user gets the SAME clarifying question
 * they would from typing it directly. Never overwrites a slot already
 * present in `known`. */
async function extractSafeKnownFromMessage(
  def: WorkflowDefinition, message: string, known: Record<string, unknown>, identity: AgentIdentity, deps: OrchestratorDeps,
): Promise<Record<string, unknown>> {
  if (!def.extractFromMessage) return {};
  const ctx = await buildContext(identity, deps, known);
  const extracted = def.extractFromMessage(message, ctx);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extracted)) {
    if (key in known) continue; // never overwrite an already-known value
    const slot = def.slots.find((sl) => sl.key === key);
    if (!slot) continue;
    if (slot.validateContext) {
      const ctxWithCandidate = await buildContext(identity, deps, { ...known, ...safe });
      const safety = slot.validateContext(value, ctxWithCandidate);
      if (!safety.ok) continue; // drop silently — asked normally instead
    }
    safe[key] = value;
  }
  return safe;
}

/** Shared tail for both startWorkflow (when the triggering message alone
 * resolves everything) and handleSlotReply (after each answered slot) —
 * Codex Evaluation #1 §12 exposed that these two paths had drifted apart
 * when only handleSlotReply had this logic. Computes PROFILE_FACT diffs
 * against the real profile (docs/...§28 — one batch confirmation, not one
 * per field), and either asks for what's still missing, proposes a batch
 * confirmation, or completes + resumes. */
async function finalizeWorkflow(
  workflowId: string, def: WorkflowDefinition, known: Record<string, unknown>,
  identity: AgentIdentity, deps: OrchestratorDeps,
): Promise<TurnResult> {
  const ctx = await buildContext(identity, deps, known);
  const missing = missingRequiredSlots(def.slots, ctx);

  if (missing.length > 0) {
    const { expectedSlot, question: q } = buildMissingSlotsQuestion(missing, ctx);
    await workflowStateRepository.update(workflowId, { slotsJson: known, expectedSlot, extendExpiry: true });
    const { known: knownSummary, missing: missingLabels } = buildKnownMissingSummary(def.slots, ctx);
    return { answer: q, blocks: [{ type: "WORKFLOW_MISSING_DATA", workflowId, workflowType: def.type, known: knownSummary, missing: missingLabels }] };
  }

  // Codex Evaluation #2 HIGH finding — a candidate can be ACCEPTED while
  // other context is still incomplete: `targetWeightSlot.validateContext`
  // (and every `validateContext`, by its own documented contract — see
  // types.ts) returns ok:true when it can't yet judge a value (e.g.
  // `currentWeightKg`/`goal` not resolvable yet), which is correct at THAT
  // moment — but the candidate then sits in `known`/`slotsJson` unchecked.
  // Once every required slot becomes known (right here — `ctx` above was
  // just built from the COMPLETE `known`), every slot with a
  // `validateContext` must be re-checked against this NOW-COMPLETE context
  // before it is ever allowed into a `PROFILE_UPDATE_CONFIRMATION` — the
  // exact reproduction: "mục tiêu 30kg" extracted before currentWeight is
  // known, then currentWeight arrives, then finalize must catch it here
  // (pre-write validation, unchanged below, is a second, independent net —
  // not a substitute for this one; see §7/§9 of the source task, and this
  // module's own `assessTargetWeightSafety` reasoning in
  // target-weight-safety.ts). Generic over every slot — never hardcoded to
  // `targetWeight`.
  for (const s of def.slots) {
    if (!s.validateContext) continue;
    const value = known[s.key];
    if (value === undefined) continue;
    const safety = s.validateContext(value, ctx);
    if (safety.ok) continue;
    if (s.key === "targetWeight") {
      logger.info({ userId: identity.userId, workflowType: def.type, stage: "finalize_revalidation" }, "workflow_target_weight_safety_rejected");
    }
    // Remove the now-invalid candidate and re-ask for THAT slot
    // specifically — recoverable, never a dead end (§8/§11 of the source
    // task): the workflow returns to COLLECTING_SLOTS with everything else
    // it already knows intact.
    const { [s.key]: _removed, ...knownWithoutInvalid } = known;
    await workflowStateRepository.update(workflowId, { slotsJson: knownWithoutInvalid, expectedSlot: s.key, extendExpiry: true });
    const ctxAfterRemoval = await buildContext(identity, deps, knownWithoutInvalid);
    const { known: knownSummary, missing: missingLabels } = buildKnownMissingSummary(def.slots, ctxAfterRemoval);
    return {
      answer: safety.clarifyingQuestion,
      blocks: [{ type: "WORKFLOW_MISSING_DATA", workflowId, workflowType: def.type, known: knownSummary, missing: missingLabels }],
    };
  }

  const profileFactChanges: PendingProfileUpdate[] = [];
  for (const s of def.slots) {
    if (s.persistence !== "PROFILE_FACT" || !s.profileField) continue;
    const newValue = known[s.key];
    if (newValue === undefined) continue;
    const currentValue = (ctx.enterpriseContext.profile as Record<string, unknown>)[s.profileField];
    if (currentValue === newValue) continue; // already matches real profile — nothing to confirm
    profileFactChanges.push({ slotKey: s.key, profileField: s.profileField, oldValue: currentValue ?? null, newValue, expectedCurrentValue: currentValue ?? null });
  }

  if (profileFactChanges.length > 0) {
    await workflowStateRepository.update(workflowId, {
      slotsJson: known, status: "AWAITING_SLOT_CONFIRMATION", expectedSlot: null,
      pendingProfileUpdate: profileFactChanges as unknown as PendingProfileUpdate, extendExpiry: true,
    });
    // Codex Evaluation #1 HIGH finding — PROFILE_FACT must never offer/
    // accept "just this once" (§4-9 of the remediation task; SlotPersistence's
    // own doc comment already said PROFILE_FACT "has no legitimate just
    // this once mode" — the bug was this never being enforced). Computed
    // from slot metadata (allowsUseOnce), never a hardcoded field check —
    // a batch requires persistence the moment ANY change in it is a
    // PROFILE_FACT, which today is every reachable case, but this stays
    // correct if a PERSISTABLE_PREFERENCE slot is ever added.
    const allowUseOnce = profileFactChanges.every((c) => {
      const slot = def.slots.find((sl) => sl.key === c.slotKey);
      return slot ? allowsUseOnce(slot.persistence) : false;
    });
    return {
      answer: buildProfileUpdateConfirmAnswer(profileFactChanges, def, allowUseOnce),
      blocks: [{
        type: "PROFILE_UPDATE_CONFIRMATION", workflowId, allowUseOnce,
        changes: profileFactChanges.map((c) => ({ field: c.profileField, oldValue: c.oldValue, newValue: c.newValue })),
      }],
    };
  }

  await workflowStateRepository.complete(workflowId);
  return { answer: RESUME_SENTINEL, blocks: [], resumeIntentKind: def.gatesIntentKind, resumeKnownSlots: known }; // sentinel — caller falls through to existing dispatch
}

async function startWorkflow(
  def: WorkflowDefinition, initialMessage: string, identity: AgentIdentity, sessionId: string, deps: OrchestratorDeps,
): Promise<TurnResult | null> {
  const extracted = await extractSafeKnownFromMessage(def, initialMessage, {}, identity, deps);
  const ctx = await buildContext(identity, deps, extracted);
  const missing = missingRequiredSlots(def.slots, ctx);

  if (missing.length === 0 && Object.keys(extracted).length === 0) {
    // Nothing to collect and nothing new was said — real context already
    // satisfies every required slot (docs/...§80 "no-repeat" case). Do not
    // create a workflow row at all; let the existing dispatch run this
    // turn exactly as before.
    return null;
  }

  const row = await workflowStateRepository.create(identity.userId, sessionId, def.type, extracted);
  if (!row) {
    // Codex Evaluation #1 §14/§35 — lost a concurrent-start race; a
    // different request already created the active workflow for this
    // session first. Never create a second active row, never guess which
    // workflow won. IDs/reason code only — no message content, no profile.
    logger.info({ userId: identity.userId, sessionId, workflowType: def.type }, "workflow_duplicate_active_prevented");
    return { answer: "Mình đang xử lý một yêu cầu khác cho cuộc trò chuyện này — bạn thử lại sau giây lát nhé.", blocks: [] };
  }

  if (missing.length === 0) {
    // Everything the workflow needs was already resolvable from
    // EnterpriseContext + the triggering message itself — go straight to
    // batch confirmation/resume via the same tail handleSlotReply uses.
    return finalizeWorkflow(row.id, def, extracted, identity, deps);
  }

  const { expectedSlot, question: q } = buildMissingSlotsQuestion(missing, ctx);
  await workflowStateRepository.update(row.id, { expectedSlot });
  const { known, missing: missingLabels } = buildKnownMissingSummary(def.slots, ctx);
  return {
    answer: q,
    blocks: [{ type: "WORKFLOW_MISSING_DATA", workflowId: row.id, workflowType: def.type, known, missing: missingLabels }],
  };
}

async function handleSlotReply(
  active: { id: string; slotsJson: unknown; expectedSlot: string | null },
  def: WorkflowDefinition, question: string, identity: AgentIdentity, deps: OrchestratorDeps,
): Promise<TurnResult> {
  const storedKnown = (active.slotsJson as Record<string, unknown>) ?? {};
  const slot = def.slots.find((s) => s.key === active.expectedSlot)!;
  const ctx = await buildContext(identity, deps, storedKnown);
  const result = slot.parse(question, ctx);
  if (!result.ok) {
    return { answer: result.clarifyingQuestion ?? "Mình chưa hiểu câu trả lời, bạn nói lại giúp mình nhé?", blocks: [] };
  }
  if (slot.validateContext) {
    const safety = slot.validateContext(result.value, ctx);
    // Codex Evaluation #1 §16-18 — a safety failure is NEVER shown as a
    // confirmable proposal; it re-asks, exactly like an unparseable reply.
    if (!safety.ok) {
      if (slot.key === "targetWeight") {
        // Reason code only — never the raw value/height/weight (no PII/health
        // numbers in the log, just enough to alert on volume).
        logger.info({ userId: identity.userId, workflowType: def.type }, "workflow_target_weight_safety_rejected");
      }
      return { answer: safety.clarifyingQuestion, blocks: [] };
    }
  }

  let updatedKnown = { ...storedKnown, [slot.key]: result.value };

  // Codex Evaluation #1 §25 "follow-up multi-slot" — the SAME reply that
  // answers the expected slot may also mention OTHER still-missing slots
  // ("72kg, tôi 25 tuổi và cao 175cm"); pick those up too rather than
  // discarding them and asking again next turn.
  const opportunistic = await extractSafeKnownFromMessage(def, question, updatedKnown, identity, deps);
  updatedKnown = { ...updatedKnown, ...opportunistic };

  return finalizeWorkflow(active.id, def, updatedKnown, identity, deps);
}

function buildProfileUpdateConfirmAnswer(changes: PendingProfileUpdate[], def: WorkflowDefinition, allowUseOnce: boolean): string {
  const lines = changes.map((c) => {
    const slot = def.slots.find((s) => s.profileField === c.profileField);
    const label = slot?.label ?? c.profileField;
    const format = slot?.format ?? ((v: unknown) => String(v));
    const oldText = c.oldValue == null ? "Chưa thiết lập" : format(c.oldValue as never);
    return `${label}: ${oldText} → ${format(c.newValue as never)}`;
  });
  if (!allowUseOnce) {
    // Codex Evaluation #1 §56 — explain WHY persistence is required rather
    // than making it look like an arbitrary/optional step.
    return `Mình sẽ cập nhật ${lines.join("; ")}. Gymini cần lưu thông tin này vào hồ sơ để lộ trình có thể sử dụng dữ liệu chính xác.\n\nXác nhận cập nhật, hay bạn muốn cho mình một giá trị khác?`;
  }
  return `Mình sẽ cập nhật ${lines.join("; ")} và dùng thông tin này để tiếp tục.\n\nXác nhận cập nhật, hay chỉ dùng cho lần này thôi?`;
}

/** Codex Evaluation #1 §28-31 "Correction Before Confirm" — while a batch
 * proposal is pending, tries to re-interpret the reply as a REPLACEMENT
 * value for one of the pending changes (checked BEFORE use-once/decline,
 * so "Không, 70 kg." is read as "70kg instead of 72kg", not as declining
 * persistence). Ambiguous across more than one pending field is
 * deliberately NOT resolved — never guess which field a bare number
 * corrects when more than one could match. */
async function tryDetectCorrection(
  changes: PendingProfileUpdate[], def: WorkflowDefinition, question: string, identity: AgentIdentity, deps: OrchestratorDeps,
): Promise<{ slotKey: string; newValue: unknown } | null> {
  const known = Object.fromEntries(changes.map((c) => [c.slotKey, c.newValue]));
  const ctx = await buildContext(identity, deps, known);
  const candidates: { slotKey: string; newValue: unknown }[] = [];
  for (const c of changes) {
    const slot = def.slots.find((s) => s.key === c.slotKey);
    if (!slot) continue;
    const parsed = slot.parse(question, ctx);
    if (!parsed.ok) continue;
    if (parsed.value === c.newValue) continue; // same value again isn't a correction
    if (slot.validateContext) {
      const safety = slot.validateContext(parsed.value, ctx);
      if (!safety.ok) continue; // an unsafe "correction" is not accepted as one either
    }
    candidates.push({ slotKey: c.slotKey, newValue: parsed.value });
  }
  if (candidates.length !== 1) return null; // 0 = no correction found, >1 = ambiguous, never guess
  return candidates[0];
}

async function handleConfirmationReply(
  active: { id: string; pendingProfileUpdate: unknown; slotsJson: unknown },
  def: WorkflowDefinition,
  question: string, identity: AgentIdentity, sessionId: string, deps: OrchestratorDeps,
): Promise<TurnResult> {
  const s = normalizeAgentText(question);
  const changes = (active.pendingProfileUpdate as unknown as PendingProfileUpdate[]) ?? [];
  const knownSlots = (active.slotsJson as Record<string, unknown>) ?? {};

  if (CANCEL_RE.test(s) && !CONFIRM_RE.test(s)) {
    await workflowStateRepository.cancel(active.id);
    return { answer: "Đã hủy — không có gì được lưu.", blocks: [] };
  }

  const correction = await tryDetectCorrection(changes, def, question, identity, deps);
  if (correction) {
    // Slot key only — never the old/new value (a weight/age/etc. number).
    logger.info({ userId: identity.userId, sessionId, slotKey: correction.slotKey }, "workflow_profile_correction_received");
    const updatedChanges = changes.map((c) => (c.slotKey === correction.slotKey ? { ...c, newValue: correction.newValue } : c));
    await workflowStateRepository.update(active.id, { pendingProfileUpdate: updatedChanges as unknown as PendingProfileUpdate, extendExpiry: true });
    const allowUseOnce = updatedChanges.every((c) => {
      const slot = def.slots.find((sl) => sl.key === c.slotKey);
      return slot ? allowsUseOnce(slot.persistence) : false;
    });
    return {
      answer: buildProfileUpdateConfirmAnswer(updatedChanges, def, allowUseOnce),
      blocks: [{
        type: "PROFILE_UPDATE_CONFIRMATION", workflowId: active.id, allowUseOnce,
        changes: updatedChanges.map((c) => ({ field: c.profileField, oldValue: c.oldValue, newValue: c.newValue })),
      }],
    };
  }

  // Codex Evaluation #1 HIGH finding — PROFILE_FACT must not accept
  // use-once/decline-without-replacement; downstream generation re-reads
  // the real profile, so silently "continuing" here would proceed with
  // stale/missing data. Computed from slot metadata, not hardcoded per
  // field (docs/conversational-ai-coach-remediation-1.md §5-6).
  const allowUseOnce = changes.every((c) => {
    const slot = def.slots.find((sl) => sl.key === c.slotKey);
    return slot ? allowsUseOnce(slot.persistence) : false;
  });
  if (USE_ONCE_RE.test(s) || (DECLINE_RE.test(s) && !CONFIRM_RE.test(s))) {
    if (!allowUseOnce) {
      // Field names only — never old/new values (PROFILE_FACT is exactly
      // the profile-truth data this event must not leak).
      logger.info(
        { userId: identity.userId, sessionId, fields: changes.map((c) => c.profileField) },
        "workflow_profile_fact_rejected",
      );
      return {
        answer: "Thông tin này cần được lưu vào hồ sơ để lộ trình có thể sử dụng dữ liệu chính xác. Bạn có thể xác nhận cập nhật, cho mình một giá trị khác, hoặc hủy.",
        blocks: [],
      };
    }
    // Reserved for a future PERSISTABLE_PREFERENCE slot — no currently
    // reachable batch satisfies allowUseOnce===true, since every
    // PROFILE_FACT change routes through the branch above.
    await workflowStateRepository.complete(active.id);
    return { answer: RESUME_SENTINEL, blocks: [], resumeIntentKind: def.gatesIntentKind, resumeKnownSlots: knownSlots };
  }

  if (!CONFIRM_RE.test(s)) {
    const prompt = allowUseOnce
      ? "Bạn xác nhận cập nhật, hay chỉ muốn dùng cho lần này thôi? (\"Xác nhận\" / \"Chỉ lần này\")"
      : "Bạn xác nhận cập nhật, cho mình một giá trị khác, hay muốn hủy?";
    return { answer: prompt, blocks: [] };
  }

  // Codex Evaluation #1 §37 "Concurrent Confirm" — atomically claim the
  // row before doing anything else; a concurrent second "Xác nhận" loses
  // this race and gets a clean "already processing" message instead of
  // racing the write or double-completing the workflow.
  const claimed = await workflowStateRepository.claimForWrite(active.id);
  if (!claimed) {
    return { answer: "Yêu cầu này đang được xử lý, bạn đợi mình một chút nhé.", blocks: [] };
  }

  // §30 — stale-profile guard: re-fetch the CURRENT real profile right
  // before writing and compare against what was true at propose-time. Any
  // mismatch means the profile changed underneath this pending proposal —
  // refuse rather than silently overwrite.
  const fresh = await deps.getUserFitnessContext(identity);
  for (const c of changes) {
    const currentReal = (fresh.profile as Record<string, unknown>)[c.profileField];
    if (currentReal !== c.expectedCurrentValue) {
      await workflowStateRepository.cancel(active.id);
      return { answer: `Hồ sơ của bạn đã thay đổi (${c.profileField}) từ lúc mình đề xuất — mình không cập nhật để tránh ghi đè nhầm. Bạn thử lại yêu cầu ban đầu giúp mình nhé.`, blocks: [] };
    }
  }

  // Codex Evaluation #1 §14 "run safety validation twice" — context can
  // change between propose and confirm; re-validate every PROFILE_FACT
  // change against FRESHLY reloaded context immediately before writing,
  // not just at propose time.
  const freshKnown = { ...knownSlots, ...Object.fromEntries(changes.map((c) => [c.slotKey, c.newValue])) };
  const freshCtx: WorkflowContext = { identity, enterpriseContext: fresh, known: freshKnown };
  for (const c of changes) {
    const slot = def.slots.find((sl) => sl.key === c.slotKey);
    if (!slot?.validateContext) continue;
    const safety = slot.validateContext(c.newValue as never, freshCtx);
    if (!safety.ok) {
      if (slot.key === "targetWeight") {
        logger.info({ userId: identity.userId, sessionId, stage: "pre_write" }, "workflow_target_weight_safety_rejected");
      }
      await workflowStateRepository.cancel(active.id);
      return { answer: safety.clarifyingQuestion, blocks: [] };
    }
  }

  const fields = Object.fromEntries(changes.map((c) => [c.profileField, c.newValue]));
  try {
    await deps.updateProfileFields(identity, fields);
  } catch (err) {
    logger.warn({ err: (err as Error)?.message, userId: identity.userId, sessionId }, "[agent-workflow] profile update failed");
    await workflowStateRepository.releaseClaimAfterFailedWrite(active.id);
    return { answer: "Mình chưa cập nhật được hồ sơ lúc này (dịch vụ hồ sơ đang gián đoạn). Bạn thử lại sau ít phút nhé.", blocks: [] };
  }
  await workflowStateRepository.complete(active.id);
  return { answer: RESUME_SENTINEL, blocks: [], resumeIntentKind: def.gatesIntentKind, resumeKnownSlots: knownSlots };
}

