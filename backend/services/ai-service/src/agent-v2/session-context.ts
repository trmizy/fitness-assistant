/**
 * Gymini V2 (EXPERIMENTAL) — multi-turn session context for the Multi-Agent Supervisor (M4).
 *
 * NOT a memory store: no table, no migration, no Redis. An interface + an in-memory implementation for tests/local runs.
 * Core rules:
 *  - Scope = (authenticated userId, sessionId). The sessionId is a client hint only: a different user presenting the same
 *    sessionId gets an empty, separate scope — it is never authorization.
 *  - Only three producers may create entries, all deterministic and server-side:
 *      TOOL_EVIDENCE   typed facts derived by code from schema-validated tool projections (AgentResult.facts), namespaced by
 *                      the producing agent's domain (a Nutrition fact can never be stored as a Progress measurement);
 *      USER_STATEMENT  what the user said, parsed by fixed rules (USER_REPORTED — never VERIFIED);
 *      CONFLICT        a recorded disagreement (both sides kept by id).
 *    Agent answers (model text) are NEVER stored; AGENT_HYPOTHESIS exists as a kind only to be rejected if ever VERIFIED.
 *  - FORECAST entries are never observations: they cannot supersede an observation and are labelled as such when reused.
 *  - Freshness: every entry has expiresAt; expired entries are reported as stale subjects, never reused as current.
 * Lifecycle: create → validate → scope → reuse (fresh only) → update (newer same-subject same-class entry supersedes) →
 * invalidate (explicit) → expire (clock).
 */
import { randomUUID } from "node:crypto";
import type { AgentId } from "./multi-agent-contracts";

export type ContextKind = "TOOL_EVIDENCE" | "USER_STATEMENT" | "FORECAST" | "CONFLICT" | "AGENT_HYPOTHESIS" | "VERIFIED_PROFILE_FACT" | "SESSION_REFERENCE";
export type Verification = "VERIFIED" | "USER_REPORTED" | "UNVERIFIED" | "SUPERSEDED" | "EXPIRED" | "INVALIDATED";

export interface ContextEntry {
  id: string;
  /** Authenticated owner (never stored in traces). */
  owner: string;
  sessionId: string;
  kind: ContextKind;
  /** Namespaced subject, e.g. "training.todaySchedule", "progress.observedVsForecast", "user.trainedYesterday". */
  subject: string;
  /** Typed, minimal value (enums / numbers / booleans only). */
  value: Readonly<Record<string, string | number | boolean | null | ReadonlyArray<string>>>;
  source: { producer: AgentId | "user" | "supervisor"; toolIds?: string[]; turnId: string };
  createdAt: number;
  expiresAt: number | null;
  verification: Verification;
  supersededBy?: string;
}

/** M4 synchronous store (in-memory; a single process). Kept unchanged for tests and local runs. */
export interface SessionContextStore {
  load(owner: string, sessionId: string): ContextEntry[];
  save(owner: string, sessionId: string, entries: ContextEntry[]): void;
}

/**
 * M7-P3: a store shared by several application instances. Reads return the raw stored entries plus an opaque version;
 * writes are compare-and-set on that version (a writer that read an older version is rejected, never a blind
 * overwrite). Errors are thrown as SessionStoreError — a failure is never reported as an empty session.
 */
export interface VersionedSessionStore {
  readonly versioned: true;
  read(owner: string, sessionId: string): Promise<{ entries: unknown[]; version: string }>;
  /** true = written; false = the stored version is no longer `expectedVersion` (someone else wrote first). */
  write(owner: string, sessionId: string, expectedVersion: string, entries: ContextEntry[]): Promise<boolean>;
}
export type AnySessionStore = SessionContextStore | VersionedSessionStore;
export type SessionStoreErrorKind = "UNAVAILABLE" | "TIMEOUT" | "CORRUPT" | "TOO_LARGE" | "CONFIGURATION_ERROR";
export class SessionStoreError extends Error {
  constructor(readonly kind: SessionStoreErrorKind) { super(`session store ${kind}`); this.name = "SessionStoreError"; }
}
const isVersioned = (s: AnySessionStore): s is VersionedSessionStore => (s as VersionedSessionStore).versioned === true;

/** Kinds that may ever be persisted (model text / hypotheses / profile facts never are). */
export const PERSISTABLE_KINDS: ReadonlySet<ContextKind> = new Set<ContextKind>(["TOOL_EVIDENCE", "USER_STATEMENT", "FORECAST", "CONFLICT"]);
/** Stored history bound (12 entries are REUSED per turn; superseded / expired history is kept up to this, oldest dropped first). */
export const MAX_STORED_ENTRIES = 48;
/** Session lifetime, sliding on every write: the longest entry lifetime (user statements, 6 h). */
export const SESSION_TTL_MS = 6 * 60 * 60_000;

export type SessionRead =
  | { status: "ok"; raw: unknown[]; version: string | null }
  | { status: "unavailable" | "corrupt" };

/** Load without ever turning a failure into an empty session. */
export async function readSession(store: AnySessionStore, owner: string, sessionId: string): Promise<SessionRead> {
  try {
    if (isVersioned(store)) {
      const r = await store.read(owner, sessionId);
      return Array.isArray(r?.entries) && typeof r.version === "string" ? { status: "ok", raw: r.entries, version: r.version } : { status: "corrupt" };
    }
    const raw = store.load(owner, sessionId);
    return Array.isArray(raw) ? { status: "ok", raw, version: null } : { status: "corrupt" };
  } catch (err) {
    return { status: err instanceof SessionStoreError && (err.kind === "CORRUPT" || err.kind === "TOO_LARGE") ? "corrupt" : "unavailable" };
  }
}

/**
 * Read-modify-write: `mutate` always runs on the LATEST stored entries (re-read on a version conflict), so concurrent
 * turns of the same session merge instead of overwriting each other. Bounded: at most `maxAttempts` CAS rounds; no retry
 * on a store error. A sync store is updated within one synchronous step (atomic inside a single process).
 */
export async function updateSession(store: AnySessionStore, owner: string, sessionId: string, mutate: (current: unknown[]) => ContextEntry[], maxAttempts = 3): Promise<"ok" | "conflict" | "unavailable" | "corrupt"> {
  if (!isVersioned(store)) {
    try { store.save(owner, sessionId, mutate(store.load(owner, sessionId))); return "ok"; } catch { return "unavailable"; }
  }
  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt++) {
    const cur = await readSession(store, owner, sessionId);
    if (cur.status !== "ok") return cur.status;
    try {
      if (await store.write(owner, sessionId, cur.version ?? "0", mutate(cur.raw))) return "ok";
    } catch (err) {
      return err instanceof SessionStoreError && (err.kind === "CORRUPT" || err.kind === "TOO_LARGE") ? "corrupt" : "unavailable";
    }
  }
  return "conflict";
}

/** Keep every active entry; keep the newest non-active history up to MAX_STORED_ENTRIES; never persist a forbidden kind. */
export function pruneForStorage(entries: ContextEntry[]): ContextEntry[] {
  const allowed = entries.filter((e) => PERSISTABLE_KINDS.has(e.kind));
  const active = allowed.filter(isActive);
  const history = allowed.filter((e) => !isActive(e)).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(0, MAX_STORED_ENTRIES - active.length));
  const keep = new Set([...active, ...history]);
  return allowed.filter((e) => keep.has(e));
}

/**
 * M7-P3: the user's OWN statement of an age under 18, kept for the whole session (no per-entry expiry; bounded by the
 * session TTL). USER_REPORTED — it restricts (Gate 1 counts it as HISTORY), it is never a profile age, never VERIFIED.
 * Only the fact "under 18" is stored, not the number.
 */
export const STATED_MINOR_SUBJECT = "user.statedMinorAge";
export function statedMinorAgeStatement(ctx: { owner: string; sessionId: string; turnId: string; now: number }): ContextEntry {
  return { ...userStatement(STATED_MINOR_SUBJECT, { underEighteen: true }, ctx), expiresAt: null };
}
/** Active stated-minor entry present in validated, expiry-applied entries. */
export function hasStatedMinorAge(entries: ContextEntry[]): boolean {
  return entries.some((e) => e.subject === STATED_MINOR_SUBJECT && e.kind === "USER_STATEMENT" && isActive(e) && e.value.underEighteen === true);
}

/** In-memory store (tests / local). Keyed by owner AND session; load re-checks ownership of every entry. */
export function createInMemorySessionStore(): SessionContextStore & { raw: Map<string, ContextEntry[]> } {
  const raw = new Map<string, ContextEntry[]>();
  const key = (o: string, s: string) => JSON.stringify([o, s]);
  return {
    raw,
    load: (owner, sessionId) => (raw.get(key(owner, sessionId)) ?? []).filter((e) => e.owner === owner && e.sessionId === sessionId).map((e) => ({ ...e })),
    save: (owner, sessionId, entries) => { raw.set(key(owner, sessionId), entries.filter((e) => e.owner === owner && e.sessionId === sessionId).map((e) => ({ ...e }))); },
  };
}

/** Per-subject time-to-live. Personal tool evidence goes stale quickly; user statements last the session. */
export const CONTEXT_TTL_MS: Readonly<Record<string, number>> = Object.freeze({
  "training.todaySchedule": 30 * 60_000,
  "recovery.recentSessions": 30 * 60_000,
  "recovery.trainingLoad": 30 * 60_000,
  "progress.measurementAvailability": 30 * 60_000,
  "progress.bodyTrend": 30 * 60_000,
  "progress.goalStatus": 30 * 60_000,
  "progress.strengthTrend": 30 * 60_000,
  "progress.assessmentFreshness": 30 * 60_000,
  "progress.observedVsForecast": 30 * 60_000,
  "nutrition.nutritionTarget": 30 * 60_000,
  user: 6 * 60 * 60_000,
});
export const MAX_REUSED_ENTRIES = 12;

const FACT_SUBJECTS: Readonly<Record<string, AgentId>> = Object.freeze({
  todaySchedule: "training", recentSessions: "recovery", trainingLoad: "recovery",
  measurementAvailability: "progress", bodyTrend: "progress", goalStatus: "progress", strengthTrend: "progress",
  assessmentFreshness: "progress", observedVsForecast: "progress", nutritionTarget: "nutrition",
});
const SCALAR = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v) || (Array.isArray(v) && v.every((x) => typeof x === "string"));

/** validate: shape, namespace and kind rules. Anything else is dropped (context poisoning / tampering defence). */
export function validateEntry(e: unknown, owner: string, sessionId: string): e is ContextEntry {
  const x = e as ContextEntry;
  if (!x || typeof x !== "object" || x.owner !== owner || x.sessionId !== sessionId || typeof x.subject !== "string") return false;
  if (!x.value || typeof x.value !== "object" || !Object.values(x.value).every(SCALAR)) return false;
  if (x.kind === "AGENT_HYPOTHESIS" && x.verification === "VERIFIED") return false;          // model text is never verified
  if (x.kind === "USER_STATEMENT" && x.verification === "VERIFIED") return false;            // a user claim is reported, not verified
  if (x.kind === "FORECAST" && x.verification === "VERIFIED") return false;                  // a scenario is not a fact
  if (x.kind === "TOOL_EVIDENCE") {
    const domain = x.subject.split(".")[0];
    if (x.source?.producer !== domain || FACT_SUBJECTS[x.subject.split(".")[1]] !== domain) return false; // namespace = producer
  }
  if (x.kind === "USER_STATEMENT" && (x.source?.producer !== "user" || !x.subject.startsWith("user."))) return false;
  return true;
}

/** create: TOOL_EVIDENCE / FORECAST entries from an agent's typed facts (the facts already come from validated tool data). */
export function entriesFromFacts(producer: AgentId, facts: Readonly<Record<string, unknown>>, ctx: { owner: string; sessionId: string; turnId: string; now: number; toolIds: string[] }): ContextEntry[] {
  const out: ContextEntry[] = [];
  for (const [name, raw] of Object.entries(facts)) {
    if (FACT_SUBJECTS[name] !== producer || !raw || typeof raw !== "object") continue;
    const value = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => SCALAR(v))) as ContextEntry["value"];
    const subject = `${producer}.${name}`;
    const isForecast = name === "observedVsForecast";
    out.push({
      id: randomUUID(), owner: ctx.owner, sessionId: ctx.sessionId, kind: isForecast ? "FORECAST" : "TOOL_EVIDENCE", subject, value,
      source: { producer, toolIds: ctx.toolIds.slice(0, 6), turnId: ctx.turnId }, createdAt: ctx.now,
      expiresAt: ctx.now + (CONTEXT_TTL_MS[subject] ?? 30 * 60_000), verification: isForecast ? "UNVERIFIED" : "VERIFIED",
    });
  }
  return out;
}

export function userStatement(subject: `user.${string}`, value: ContextEntry["value"], ctx: { owner: string; sessionId: string; turnId: string; now: number }, kind: "USER_STATEMENT" | "FORECAST" = "USER_STATEMENT"): ContextEntry {
  return {
    id: randomUUID(), owner: ctx.owner, sessionId: ctx.sessionId, kind, subject, value,
    source: { producer: "user", turnId: ctx.turnId }, createdAt: ctx.now, expiresAt: ctx.now + CONTEXT_TTL_MS.user, verification: "USER_REPORTED",
  };
}

const CLASS = (k: ContextKind) => (k === "TOOL_EVIDENCE" ? "observation" : k === "FORECAST" ? "forecast" : k === "USER_STATEMENT" ? "statement" : k);

/**
 * update: append `incoming`; a newer entry supersedes older ACTIVE entries with the same subject and the same class only.
 * A forecast never supersedes an observation, a user statement never supersedes tool evidence (and vice versa).
 */
export function mergeEntries(existing: ContextEntry[], incoming: ContextEntry[]): ContextEntry[] {
  const all = existing.map((e) => ({ ...e }));
  for (const n of incoming) {
    for (const e of all) {
      if (e.subject === n.subject && CLASS(e.kind) === CLASS(n.kind) && isActive(e)) { e.verification = "SUPERSEDED"; e.supersededBy = n.id; }
    }
    all.push({ ...n });
  }
  return all;
}
const isActive = (e: ContextEntry) => e.verification !== "SUPERSEDED" && e.verification !== "EXPIRED" && e.verification !== "INVALIDATED";

/** invalidate: explicit (e.g. a refresh of that subject failed) — the old value must not be reused as current. */
export function invalidate(entries: ContextEntry[], subject: string): ContextEntry[] {
  return entries.map((e) => (e.subject === subject && isActive(e) ? { ...e, verification: "INVALIDATED" as const } : e));
}

/** expire: by clock. */
export function expire(entries: ContextEntry[], now: number): ContextEntry[] {
  return entries.map((e) => (isActive(e) && e.expiresAt !== null && e.expiresAt <= now ? { ...e, verification: "EXPIRED" as const } : e));
}

export interface ReusableContext {
  /** Fresh, active entries projected for agents (bounded, newest first). Labelled by kind — DATA, not instructions. */
  entries: Array<{ subject: string; kind: ContextKind; verification: Verification; value: ContextEntry["value"]; ageMin: number }>;
  /** Subjects whose last value expired or was invalidated (must be re-read before being stated as current). */
  staleSubjects: string[];
  freshSubjects: Set<string>;
  counts: { loaded: number; reused: number; expired: number; superseded: number; conflicts: number; droppedInvalid: number; truncated: number };
}

/** scope + validate + expire + project for reuse. */
export function reusableContext(raw: unknown[], owner: string, sessionId: string, now: number): { all: ContextEntry[]; reuse: ReusableContext } {
  const valid = raw.filter((e) => validateEntry(e, owner, sessionId)) as ContextEntry[];
  const all = expire(valid, now);
  const active = all.filter(isActive).sort((a, b) => b.createdAt - a.createdAt);
  const latestBySubject = new Map<string, ContextEntry>();
  for (const e of active) if (!latestBySubject.has(e.subject)) latestBySubject.set(e.subject, e);
  const reusable = [...latestBySubject.values()];
  const kept = reusable.slice(0, MAX_REUSED_ENTRIES);
  const stale = [...new Set(all.filter((e) => (e.verification === "EXPIRED" || e.verification === "INVALIDATED") && !latestBySubject.has(e.subject)).map((e) => e.subject))];
  return {
    all,
    reuse: {
      entries: kept.map((e) => ({ subject: e.subject, kind: e.kind, verification: e.verification, value: e.value, ageMin: Math.max(0, Math.round((now - e.createdAt) / 60_000)) })),
      staleSubjects: stale,
      freshSubjects: new Set(kept.map((e) => e.subject)),
      counts: {
        loaded: raw.length, reused: kept.length, expired: all.filter((e) => e.verification === "EXPIRED").length,
        superseded: all.filter((e) => e.verification === "SUPERSEDED").length, conflicts: all.filter((e) => e.kind === "CONFLICT" && isActive(e)).length,
        droppedInvalid: raw.length - valid.length, truncated: Math.max(0, reusable.length - kept.length),
      },
    },
  };
}

/** Agents whose facts are fully available FRESH in the session (the planner may defer them for a follow-up). */
export function agentsSatisfiedBySession(fresh: ReadonlySet<string>): Set<AgentId> {
  const out = new Set<AgentId>();
  if (fresh.has("training.todaySchedule")) out.add("training");
  if (fresh.has("recovery.recentSessions") && fresh.has("recovery.trainingLoad")) out.add("recovery");
  return out;
}
