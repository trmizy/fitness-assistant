import type { AgentIdentity } from "../services/fitness-agent-tools";

/**
 * Conversational AI Coach workflow orchestration — the missing product
 * layer between "user knows enough information -> intent router -> domain
 * tool -> response" (today) and "user expresses an outcome in natural
 * language, the system resolves what it already knows, asks only for what
 * it doesn't, confirms any persistent change, and automatically resumes"
 * (target). See docs/conversational-ai-coach-workflow-design.md.
 *
 * Architectural invariant (never violated by this module): the LLM may
 * help understand natural language (see slot-values.ts's bounded
 * extractor), but it never decides which fields are required, which DB
 * field gets updated, whether a value is valid, whether confirmation is
 * required, which tool is authorized, or workflow transition rules. All of
 * that is server code, in this file and the workflow definitions under
 * ./workflows/.
 */

/** Where a slot's value physically lives when it IS known. */
export type SlotSource = "USER_PROFILE" | "WORKFLOW" | "BUSINESS_STATE";

/** How a resolved slot value should be treated once the user confirms it.
 * See docs/conversational-ai-coach-workflow-design.md §Slot classification. */
export type SlotPersistence =
  | "WORKFLOW_ONLY" // never persisted anywhere outside this workflow's own state
  | "PERSISTABLE_PREFERENCE" // may be offered as "save to profile?" but workflow proceeds either way
  | "PROFILE_FACT"; // a profile field with no legitimate "just this once" mode (goal/targetWeight)
// BUSINESS_STATE (TrainingCycle phase, Contract status, etc.) is deliberately
// NOT a slot persistence value — no slot may ever target business state;
// that would violate "workflow state is not business truth". See §7 of the
// audit doc.

/** Codex Conversational AI Coach Evaluation #1 (RETURN TO CLAUDE) found
 * `PROFILE_FACT` accepted "Chỉ dùng cho lần này" even though this type's
 * own comment above already says PROFILE_FACT has "no legitimate just this
 * once mode" — the bug was in orchestrator.ts not enforcing what this type
 * always documented, not in the type design. This predicate is the single
 * place that enforcement is computed, so no call site ever hardcodes
 * `if (field === "age")`-style logic (docs/conversational-ai-coach-
 * remediation-1.md §6) — a future `PERSISTABLE_PREFERENCE` slot will
 * correctly allow use-once without any orchestrator change. */
export function allowsUseOnce(persistence: SlotPersistence): boolean {
  return persistence !== "PROFILE_FACT";
}

/** Where a CANDIDATE value for a slot came from this turn — the provenance
 * check that keeps prompt-injected/RAG/tool-result content from ever being
 * treated as a genuine user fact. Only CURRENT_USER_MESSAGE and
 * ENTERPRISE_CONTEXT (i.e. already-known, already-trusted profile data) are
 * ever accepted as the source of a slot value. */
export type SlotProvenance = "ENTERPRISE_CONTEXT" | "CURRENT_USER_MESSAGE" | "WORKFLOW_LOCAL_DEFAULT";

export type SlotParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; clarifyingQuestion?: string };

export interface WorkflowContext {
  identity: AgentIdentity;
  /** Real, already-fetched fitness-agent-tools.getUserFitnessContext() result
   * (profile + coach summaries) — the ONLY source of "what Gymini already
   * knows" a slot may read from. Never mutated in place. */
  enterpriseContext: { profile: Record<string, unknown>; coach: unknown };
  /** Slots resolved so far THIS turn (including ones just confirmed this
   * turn) — workflow-local working memory, never authoritative. */
  known: Record<string, unknown>;
}

export interface SlotDefinition<T = unknown> {
  key: string;
  /** Vietnamese noun phrase used in generated prompts, e.g. "cân nặng mục tiêu". */
  label: string;
  source: SlotSource;
  persistence: SlotPersistence;
  /** UserProfile field name this slot maps to — required when persistence
   * is PERSISTABLE_PREFERENCE or PROFILE_FACT, used by the profile-update
   * tool's explicit whitelist (never a generic PATCH — see
   * profile-update.tool.ts). */
  profileField?: string;
  /** Whether this slot must be known before the workflow can proceed.
   * A function form supports goal-conditional requirements (e.g. targetWeight
   * only required for WEIGHT_LOSS/MUSCLE_GAIN — see roadmap.workflow.ts). */
  required: boolean | ((ctx: WorkflowContext) => boolean);
  /** Reads the current known value straight from EnterpriseContext — real
   * server data, never a guess. Returns undefined when genuinely unknown. */
  readFromContext: (ctx: WorkflowContext) => T | undefined;
  /** Deterministic-first parser for a raw user reply. Must return ok:false
   * (never throw) for anything it can't confidently parse — ambiguous input
   * must re-ask, never guess (docs/...§Ambiguous value). */
  parse: (raw: string, ctx: WorkflowContext) => SlotParseResult<T>;
  /** Optional contextual/domain safety check, run AFTER `parse()` already
   * succeeded — `parse()` only ever validates SYNTAX (a number in a sane
   * absolute range); this validates the value against other already-known
   * facts (height, current weight, goal, ...). Codex Evaluation #1's HIGH
   * finding — a 30kg target for a 180cm/80kg profile passed the absolute
   * 25-300kg range check with no contextual gate at all. Must return
   * ok:false (never throw, never silently clamp) with a clarifying
   * question rather than a raw rejection — a safety failure re-asks, it is
   * never shown as a confirmable proposal (docs/conversational-ai-coach-
   * remediation-1.md §16). Called twice by the orchestrator: once when the
   * slot is first answered, and again immediately before the actual
   * profile write using freshly reloaded context — context can change
   * between propose and confirm (§14). */
  validateContext?: (value: T, ctx: WorkflowContext) => { ok: true } | { ok: false; clarifyingQuestion: string };
  /** The exact question to show when this slot is missing. */
  question: (ctx: WorkflowContext) => string;
  /** Human-readable rendering of a known/candidate value, for confirmation
   * cards and "known so far" summaries. */
  format: (value: T) => string;
}

export type WorkflowStatus =
  | "COLLECTING_SLOTS"
  | "AWAITING_SLOT_CONFIRMATION"
  // Codex Evaluation #1 §37/§59 — a short-lived transitional status a
  // confirmed write atomically claims (AWAITING_SLOT_CONFIRMATION ->
  // WRITING, guarded by a conditional update that only one of two
  // concurrent "Xác nhận cập nhật" replies can win) before calling
  // updateProfileFields(). On success it moves to COMPLETED; on a failed
  // write it reverts to AWAITING_SLOT_CONFIRMATION (preserving the
  // existing "failed write stays pending, never resumes" contract). Counts
  // as ACTIVE/non-terminal — a fresh workflow must not start while a write
  // is in flight either.
  | "WRITING"
  | "READY"
  | "GENERATING_PREVIEW"
  | "AWAITING_PREVIEW_DECISION"
  | "AWAITING_ACTION_CONFIRMATION"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export interface PendingProfileUpdate {
  slotKey: string;
  profileField: string;
  oldValue: unknown;
  newValue: unknown;
  /** The real profile snapshot value at propose-time — used to detect a
   * stale update (profile changed between propose and confirm) without a
   * dedicated version column, per docs/...§Profile stale-state ("design the
   * smallest safe expected-value check"). */
  expectedCurrentValue: unknown;
}

export interface WorkflowDefinition {
  type: string;
  /** Which fitness-agent-intent.ts intent `kind` this workflow gates —
   * once every required slot is confirmed, the orchestrator falls through
   * to the EXISTING, unmodified `tryTurn` dispatch for this same intent
   * kind (e.g. "CREATE_PLAN_BUNDLE" -> the existing `proposePlanBundle`),
   * rather than this module reimplementing preview generation itself. This
   * is a deliberate design choice, not a shortcut: it means 100% of the
   * already-signed-off preview/confirm/execute logic for each domain
   * (roadmap+workout+nutrition bundle, PT search, program search) is reused
   * completely unchanged — the orchestrator's only job is gating entry. */
  gatesIntentKind: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a
  // heterogeneous array of SlotDefinition<T> for different concrete T
  // (number/string/enum/number[]) is fundamentally not expressible as
  // SlotDefinition<unknown>[] under structural function-parameter variance;
  // `any` here is the standard, contained escape hatch — every individual
  // slot definition is still fully typed at its own declaration site.
  slots: SlotDefinition<any>[];
  /** Optional deterministic extraction from the message that TRIGGERED this
   * workflow (or, opportunistically, from any later reply while other
   * slots are still missing) — Codex Evaluation #1 §12/§19 found a rich
   * initial prompt ("25 tuổi, cao 175cm, 80kg, mục tiêu 72kg") was fully
   * ignored, `startWorkflow()` only ever consulted EnterpriseContext. Must
   * return ONLY values it is confident about (deterministic pattern
   * matching, never an LLM); the orchestrator re-validates every returned
   * value through that slot's own `validateContext` before trusting it,
   * and NEVER overwrites a slot that's already known — this only fills in
   * slots that would otherwise have to be asked one at a time. */
  extractFromMessage?: (message: string, ctx: WorkflowContext) => Record<string, unknown>;
}
