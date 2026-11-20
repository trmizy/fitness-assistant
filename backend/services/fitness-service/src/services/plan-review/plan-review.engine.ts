import { createHash } from "node:crypto";

/**
 * Workout Plan Review & Approval — pure domain logic (no I/O).
 *
 * Identity model (see schema.prisma, PlanReviewRequest):
 *  - the logical plan id is the WorkoutProgram id and never changes across edits;
 *  - a decision binds to (subjectId, contentHash), where contentHash is the SHA-256 of the
 *    canonical prescription snapshot — NOT a counter someone could forget to bump;
 *  - approval is never copied forward: whether an approval is still in force is COMPUTED at
 *    read time by comparing the approved hash with the program's current hash.
 */

export const PLAN_REVIEW_STATUSES = [
  "PENDING_REVIEW",
  "IN_REVIEW",
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
  "CANCELLED",
  "SUPERSEDED",
  "ACCESS_REVOKED",
] as const;
export type PlanReviewStatusValue = (typeof PLAN_REVIEW_STATUSES)[number];

export const OPEN_STATUSES: readonly PlanReviewStatusValue[] = ["PENDING_REVIEW", "IN_REVIEW"];
export type PlanReviewActorRole = "CLIENT" | "PT" | "SYSTEM";
export type PlanReviewAction = "START" | "APPROVE" | "REQUEST_CHANGES" | "REJECT" | "CANCEL" | "SUPERSEDE" | "REVOKE_ACCESS";

interface Transition {
  to: PlanReviewStatusValue;
  event: string;
  actors: readonly PlanReviewActorRole[];
  from: readonly PlanReviewStatusValue[];
}

/** The ONLY legal transitions. Everything not listed is rejected (terminal states have no outgoing edge). */
export const TRANSITIONS: Record<PlanReviewAction, Transition> = {
  START: { to: "IN_REVIEW", event: "STARTED", actors: ["PT"], from: ["PENDING_REVIEW"] },
  APPROVE: { to: "APPROVED", event: "APPROVED", actors: ["PT"], from: OPEN_STATUSES },
  REQUEST_CHANGES: { to: "CHANGES_REQUESTED", event: "CHANGES_REQUESTED", actors: ["PT"], from: OPEN_STATUSES },
  REJECT: { to: "REJECTED", event: "REJECTED", actors: ["PT"], from: OPEN_STATUSES },
  CANCEL: { to: "CANCELLED", event: "CANCELLED", actors: ["CLIENT"], from: OPEN_STATUSES },
  SUPERSEDE: { to: "SUPERSEDED", event: "SUPERSEDED", actors: ["SYSTEM", "CLIENT"], from: OPEN_STATUSES },
  REVOKE_ACCESS: { to: "ACCESS_REVOKED", event: "ACCESS_REVOKED", actors: ["SYSTEM"], from: OPEN_STATUSES },
};

export class PlanReviewTransitionError extends Error {
  constructor(
    public readonly code: "ILLEGAL_TRANSITION" | "ACTOR_NOT_ALLOWED",
    message: string,
  ) {
    super(message);
  }
}

export function isOpenStatus(status: PlanReviewStatusValue): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Returns the transition definition, or throws. Pure — the caller still has to apply it with a conditional write. */
export function resolveTransition(
  from: PlanReviewStatusValue,
  action: PlanReviewAction,
  actor: PlanReviewActorRole,
): Transition {
  const t = TRANSITIONS[action];
  if (!t.actors.includes(actor)) {
    throw new PlanReviewTransitionError("ACTOR_NOT_ALLOWED", `${actor} may not perform ${action}`);
  }
  if (!t.from.includes(from)) {
    throw new PlanReviewTransitionError("ILLEGAL_TRANSITION", `${action} is not allowed from ${from}`);
  }
  return t;
}

// ── Canonical snapshot + hash ───────────────────────────────────────────────

/** Deterministic JSON: object keys sorted recursively, undefined dropped, so equal content ⇒ equal bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function hashSnapshot(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
}

export interface ProgramSnapshotSource {
  id: string;
  name: string;
  goal?: string | null;
  durationWeeks?: number | null;
  daysPerWeek?: number | null;
  version: number;
  sourcePlanId?: string | null;
  aiPlanVersion?: number | null;
  days: Array<{
    dayNumber: number;
    title: string;
    exercises: Array<{
      exerciseId: string;
      order: number;
      sets?: number | null;
      reps?: number | null;
      weight?: number | null;
      duration?: number | null;
      restSeconds?: number | null;
      notes?: string | null;
      exercise?: { exerciseName?: string | null } | null;
      setPrescriptions?: Array<{
        setNumber: number;
        targetReps?: number | null;
        targetWeight?: number | null;
        targetRpe?: number | null;
        targetRir?: number | null;
        targetSetType?: string | null;
        isAmrap?: boolean | null;
        restSeconds?: number | null;
      }>;
    }>;
  }>;
}

/**
 * The reviewable prescription ONLY. Deliberately excludes: row ids/timestamps (volatile, would break hash stability),
 * schedules, workout logs, and anything from the user's profile/InBody/health history — a PT reviewing a plan must not
 * receive body data through this channel (that stays behind the existing coach workspace consent path).
 */
export function buildProgramSnapshot(program: ProgramSnapshotSource) {
  return {
    programId: program.id,
    name: program.name,
    goal: program.goal ?? null,
    durationWeeks: program.durationWeeks ?? null,
    daysPerWeek: program.daysPerWeek ?? null,
    days: [...program.days]
      .sort((a, b) => a.dayNumber - b.dayNumber)
      .map((day) => ({
        dayNumber: day.dayNumber,
        title: day.title,
        exercises: [...day.exercises]
          .sort((a, b) => a.order - b.order)
          .map((ex) => ({
            exerciseId: ex.exerciseId,
            name: ex.exercise?.exerciseName ?? null,
            order: ex.order,
            sets: ex.sets ?? null,
            reps: ex.reps ?? null,
            weight: ex.weight ?? null,
            duration: ex.duration ?? null,
            restSeconds: ex.restSeconds ?? null,
            notes: ex.notes ?? null,
            setPrescriptions: [...(ex.setPrescriptions ?? [])]
              .sort((a, b) => a.setNumber - b.setNumber)
              .map((s) => ({
                setNumber: s.setNumber,
                targetReps: s.targetReps ?? null,
                targetWeight: s.targetWeight ?? null,
                targetRpe: s.targetRpe ?? null,
                targetRir: s.targetRir ?? null,
                targetSetType: s.targetSetType ?? null,
                isAmrap: s.isAmrap ?? false,
                restSeconds: s.restSeconds ?? null,
              })),
          })),
      })),
  };
}

// ── Effective approval (read-time) ──────────────────────────────────────────

export type EffectiveReviewState =
  | "APPROVED_CURRENT" //  approved AND the program still has exactly the approved content
  | "APPROVED_OUTDATED" // approved, but the program was edited since — approval does NOT carry over
  | "OPEN" //              waiting on / being reviewed by the PT
  | "CHANGES_REQUESTED"
  | "REJECTED"
  | "NONE"; //             cancelled / superseded / access revoked — no active review outcome

/** What the plan IS right now: monotonic program version + content hash. */
export interface CurrentFingerprint {
  hash: string;
  version: number;
}

/**
 * A review applies to the current plan ONLY if BOTH the monotonic version and the content hash match.
 * The hash alone is not enough: A -> B -> A yields the same hash as the approved plan but a newer version, and the plan went
 * through an unreviewed state in between — the earlier approval must not silently come back.
 */
export function fingerprintMatches(request: { contentHash: string; subjectVersion: number }, current: CurrentFingerprint | null): boolean {
  return current !== null && current.version === request.subjectVersion && current.hash === request.contentHash;
}

export function computeEffectiveState(
  request: { status: PlanReviewStatusValue; contentHash: string; subjectVersion: number },
  current: CurrentFingerprint | null,
): EffectiveReviewState {
  switch (request.status) {
    case "APPROVED":
      return fingerprintMatches(request, current) ? "APPROVED_CURRENT" : "APPROVED_OUTDATED";
    case "PENDING_REVIEW":
    case "IN_REVIEW":
      return "OPEN";
    case "CHANGES_REQUESTED":
      return "CHANGES_REQUESTED";
    case "REJECTED":
      return "REJECTED";
    default:
      return "NONE";
  }
}

/**
 * Backward compatibility with ai-service's legacy WorkoutPlan.ptReviewStatus. READ-ONLY mapping: this service never
 * writes ai-service rows (no cross-DB transaction exists), and the legacy /plans/pt-review API is left untouched.
 */
export function toLegacyPtReviewStatus(
  status: PlanReviewStatusValue,
): "PENDING_PT_REVIEW" | "PT_APPROVED" | "PT_REJECTED" | null {
  switch (status) {
    case "PENDING_REVIEW":
    case "IN_REVIEW":
      return "PENDING_PT_REVIEW";
    case "APPROVED":
      return "PT_APPROVED";
    case "REJECTED":
      return "PT_REJECTED";
    default:
      return null; // CHANGES_REQUESTED has no legacy equivalent; cancelled/superseded/revoked are not review outcomes
  }
}
