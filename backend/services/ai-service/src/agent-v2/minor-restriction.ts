/**
 * Gymini V2 (EXPERIMENTAL) — USER-SCOPED self-reported minor restriction (M8-A2, cross-session minor safety).
 *
 * WHY: until now the user's own statement of an age under 18 was kept only inside the conversation session, i.e. per
 * (userId, sessionId), and only when the client supplied a sessionId. A new / omitted sessionId therefore lifted the
 * restriction with one valid request (P1, reproduced; see agent-v2-minor-restriction-user-scope.test.ts).
 *
 * THIS MODULE is the safety state, kept SEPARATE from conversation context (it has its own interface, key space, TTL and
 * lifecycle; conversation writes can never rewrite or drop it):
 *   scope        the AUTHENTICATED userId only (from req.context through the runtime). sessionId plays no part.
 *   content      one record per user: { owner, provenance USER_REPORTED, first/last report time, which turns (turn ids, never
 *                text), count, expiresAt }. It never stores the question, the stated age, a profile age or any model text.
 *                The only fact kept is the boolean "reported under 18".
 *   TTL          MINOR_RESTRICTION_TTL_MS (30 days), SLIDING: every new minor statement extends expiresAt (it never
 *                shortens, even with a skewed clock). M8-B S1: EXPIRY IS A REVIEW POINT, NOT A PERMISSION. An expired record
 *                (status "EXPIRED") STILL RESTRICTS exactly like an active one: the user said they are under 18 and nothing
 *                that happened since is evidence of adulthood, so the clock alone never yields ADULT. Inconsistent timestamps
 *                (expiresAt <= lastReportedAt, lastReportedAt < firstReportedAt ...) are CORRUPT (fail closed), not "expired".
 *                [OWNER POLICY DECISION: the 30 days is only the review point; 30 days is a conservative placeholder.]
 *   clearing     NOTHING in this module or in the supervisor clears it. No later statement ("tôi 30 tuổi"), no verified adult
 *                profile age, no new session, and no elapsed time removes it (a profile >= 18 against a restriction is only
 *                reported as a conflict by resolveAgeVerdict, status stays MINOR). Removal = an out-of-band operator action only.
 *                [OWNER POLICY DECISION: who may clear it and how (e.g. an account-owner re-verification) is NOT implemented.]
 *   concurrency  versioned compare-and-set: a writer that read an older version is rejected and re-reads (bounded retries),
 *                the merge is monotonic (count up, first report kept, expiry only extends). Two racing writers both land.
 *   fail closed  a store error on read OR write, a malformed / foreign / corrupt record, a timeout → "UNAVAILABLE" /
 *                "CORRUPT", which the supervisor treats exactly like an unreadable session (personal advice refused,
 *                general knowledge answered general-only). It is never read as "no restriction". A corrupt record met on
 *                a WRITE (the user just stated a minor age) is replaced by a fresh valid one (strictly more restrictive).
 *   quarantine   M8-B S1: a restriction that could NOT be persisted (store write error / timeout / CAS conflict / corrupt) is not
 *                dropped: it is held in a PendingMinorRestrictions registry (write-ahead: registered BEFORE the write attempt),
 *                keyed by the authenticated owner. While an owner is pending the supervisor treats them as restricted, retries the
 *                persistence on every turn, and only removes the pending entry after a durable write. The same registry holds a
 *                restriction found in a legacy SESSION-scoped entry whose promotion to the user store failed.
 *                MULTI-INSTANCE LIMIT (honest): the registry is in-process memory. Another instance, or this one after a restart,
 *                does NOT know about it; until the store is writable the restriction is enforced only by the instance that
 *                received the statement (and by the best-effort session-scoped copy for the same sessionId). This is NOT a
 *                durable guarantee; only a persistent store satisfying the production conditions below closes it.
 *   isolation    every call carries the owner; the key embeds the owner; a record whose `owner` differs from the caller's is
 *                CORRUPT (defence in depth against a mis-keyed adapter), never applied to another user.
 *
 * STORES: this file defines the interface and an in-memory implementation (tests / local, ONE process, lost on restart).
 * The existing Redis / DynamoDB session adapters do NOT implement this interface and must not be claimed to. A persistent
 * implementation has to satisfy the PRODUCTION CONDITIONS listed on `MinorRestrictionStore`.
 */
import { SessionStoreError } from "./session-context";

export const MINOR_RESTRICTION_SCHEMA = "agent-v2-minor-restriction/1" as const;
export const MINOR_RESTRICTION_TTL_MS = 30 * 24 * 60 * 60_000;
export const MINOR_RESTRICTION_KEY_PREFIX = "gymini:agent-v2:minor-restriction:v1:";
/** CAS rounds per write (a conflict re-reads the latest record and merges again). */
export const MINOR_RESTRICTION_MAX_ATTEMPTS = 4;
const OWNER_RE = /^\S{1,128}$/;

export interface MinorRestrictionRecord {
  schema: typeof MINOR_RESTRICTION_SCHEMA;
  /** The authenticated user this record belongs to (re-checked on every read). */
  owner: string;
  kind: "SELF_REPORTED_MINOR";
  /** The restriction comes from the user's own words — it is never VERIFIED and never a profile age. */
  provenance: "USER_REPORTED";
  underEighteen: true;
  firstReportedAt: number;
  lastReportedAt: number;
  expiresAt: number;
  /** Which turns (opaque ids, no text) first / last reported it. */
  firstTurnId: string;
  lastTurnId: string;
  reportCount: number;
}

/**
 * User-scoped, versioned store of the restriction record. NOT a conversation store.
 *
 * PRODUCTION CONDITIONS for a persistent implementation (none exists yet — the Redis / DynamoDB session adapters are NOT
 * implementations of this interface):
 *   1. key per authenticated owner only, namespaced (`MINOR_RESTRICTION_KEY_PREFIX` + owner), never derived from sessionId;
 *   2. an atomic compare-and-set write on `version` ("0" = absent), exactly the semantics of `write` below;
 *   3. the TTL of the stored item is >= `expiresAt` (never evicts a live restriction early; no LRU / maxmemory eviction on this
 *      key space; a DynamoDB TTL attribute may lag but must not shorten it);
 *   4. durable across restarts and shared by every application instance (an in-process map is NOT acceptable in production);
 *   5. every failure surfaces as a thrown SessionStoreError (UNAVAILABLE / TIMEOUT / CORRUPT / ...) — never as an empty read;
 *      an absent key is the ONLY thing that reads as `{ record: null, version: "0" }`;
 *   6. reads must be strongly consistent (DynamoDB ConsistentRead; Redis primary, not a lagging replica);
 *   7. IAM / ACL limited to this key space; no scan / list by other owners; no raw question text ever stored.
 */
export interface MinorRestrictionStore {
  readonly minorRestrictionStore: true;
  /** `record: null` + version "0" = no record. The record is returned raw (unvalidated); the caller validates. */
  read(owner: string): Promise<{ record: unknown | null; version: string }>;
  /** true = written; false = the stored version is no longer `expectedVersion` (someone wrote first). Throws SessionStoreError on failure. */
  write(owner: string, expectedVersion: string, record: MinorRestrictionRecord): Promise<boolean>;
}

export type MinorRestrictionRead =
  | { status: "ACTIVE"; record: MinorRestrictionRecord }
  | { status: "NONE" }
  /**
   * The record is valid but its expiresAt is past (by the injected clock) — its REVIEW POINT passed. Not an error, and NOT permission:
   * the supervisor keeps restricting (see the header). Reported separately only so the trace shows why.
   */
  | { status: "EXPIRED" }
  | { status: "UNAVAILABLE" | "CORRUPT" };

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const isTurnId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/** Strict shape + ownership + sanity check. Anything else is CORRUPT (never silently ignored). */
export function isValidMinorRestriction(raw: unknown, owner: string): raw is MinorRestrictionRecord {
  const r = raw as Partial<MinorRestrictionRecord> | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  if (r.schema !== MINOR_RESTRICTION_SCHEMA || r.owner !== owner || r.kind !== "SELF_REPORTED_MINOR" || r.provenance !== "USER_REPORTED" || r.underEighteen !== true) return false;
  if (!isTime(r.firstReportedAt) || !isTime(r.lastReportedAt) || !isTime(r.expiresAt)) return false;
  // M8-B S1 (Codex P2): timestamps must be mutually consistent. The expiry has to lie after the LAST report (a sliding TTL can only
  // extend it), not merely after the first one — an expiresAt earlier than lastReportedAt would read as "expired" = tampering / skew.
  if (r.firstReportedAt > r.lastReportedAt || r.expiresAt <= r.lastReportedAt) return false;
  if (!isTurnId(r.firstTurnId) || !isTurnId(r.lastTurnId)) return false;
  if (typeof r.reportCount !== "number" || !Number.isSafeInteger(r.reportCount) || r.reportCount < 1) return false;
  return true;
}

const kindOf = (err: unknown): "CORRUPT" | "UNAVAILABLE" => (err instanceof SessionStoreError && (err.kind === "CORRUPT" || err.kind === "TOO_LARGE") ? "CORRUPT" : "UNAVAILABLE");

/** Read + validate + apply expiry. Never turns a failure into "no restriction". */
export async function readMinorRestriction(store: MinorRestrictionStore, owner: string, now: number): Promise<MinorRestrictionRead> {
  if (!OWNER_RE.test(owner)) return { status: "UNAVAILABLE" };
  try {
    const r = await store.read(owner);
    if (!r || typeof r !== "object" || typeof r.version !== "string") return { status: "CORRUPT" };
    if (r.record === null) return r.version === "0" ? { status: "NONE" } : { status: "CORRUPT" };
    if (!isValidMinorRestriction(r.record, owner)) return { status: "CORRUPT" };
    return r.record.expiresAt > now ? { status: "ACTIVE", record: { ...r.record } } : { status: "EXPIRED" };
  } catch (err) {
    return { status: kindOf(err) };
  }
}

/** The monotonic merge: first report kept, count up, expiry only extends, last report only moves forward. */
export function mergeMinorRestriction(existing: MinorRestrictionRecord | null, owner: string, at: { turnId: string; now: number }): MinorRestrictionRecord {
  const turnId = isTurnId(at.turnId) ? at.turnId : "unknown";
  const expiresAt = at.now + MINOR_RESTRICTION_TTL_MS;
  if (!existing) {
    return { schema: MINOR_RESTRICTION_SCHEMA, owner, kind: "SELF_REPORTED_MINOR", provenance: "USER_REPORTED", underEighteen: true, firstReportedAt: at.now, lastReportedAt: at.now, expiresAt, firstTurnId: turnId, lastTurnId: turnId, reportCount: 1 };
  }
  const earlier = at.now < existing.firstReportedAt; // a writer racing with an older clock: the first report is the earliest one
  return {
    ...existing,
    ...(earlier ? { firstReportedAt: at.now, firstTurnId: turnId } : {}),
    lastReportedAt: Math.max(existing.lastReportedAt, at.now),
    expiresAt: Math.max(existing.expiresAt, expiresAt),
    lastTurnId: at.now >= existing.lastReportedAt ? turnId : existing.lastTurnId,
    reportCount: Math.min(existing.reportCount + 1, 1_000_000),
  };
}

/**
 * Record "the user stated an age under 18" for `owner`. Read-modify-write under compare-and-set on the LATEST record
 * (re-read on conflict, bounded). A store failure is reported, never swallowed.
 *   "ok"          written (including repairing a corrupt / expired previous record);
 *   "conflict"    still losing the CAS after the bounded retries;
 *   "unavailable" the store failed (read or write);
 *   "corrupt"     the STORE reported corruption it cannot repair (not a merely malformed record, which is replaced).
 */
export async function recordMinorRestriction(store: MinorRestrictionStore, owner: string, at: { turnId: string; now: number }): Promise<"ok" | "conflict" | "unavailable" | "corrupt"> {
  if (!OWNER_RE.test(owner)) return "unavailable";
  for (let attempt = 0; attempt < MINOR_RESTRICTION_MAX_ATTEMPTS; attempt++) {
    let version: string; let existing: MinorRestrictionRecord | null = null;
    try {
      const r = await store.read(owner);
      if (!r || typeof r !== "object" || typeof r.version !== "string") return "corrupt";
      version = r.version;
      if (r.record !== null && isValidMinorRestriction(r.record, owner) && r.record.expiresAt > at.now) existing = r.record;
      // a malformed / foreign / expired record is replaced by a fresh valid one: the user JUST reported a minor age
    } catch (err) {
      return kindOf(err) === "CORRUPT" ? "corrupt" : "unavailable";
    }
    try {
      if (await store.write(owner, version, mergeMinorRestriction(existing, owner, at))) return "ok";
    } catch (err) {
      return kindOf(err) === "CORRUPT" ? "corrupt" : "unavailable";
    }
  }
  return "conflict";
}

// ── M8-B S1: pending (quarantined) restrictions ──────────────────────────────────────────────────────────────────────────
/** One report not yet durably stored: opaque turn id + report time only — never text, an age or a session id. */
export interface PendingReport { readonly turnId: string; readonly now: number }

/** Upper bound of owners held in quarantine per process (each entry is ~100 bytes). Beyond it a NEW owner cannot be quarantined (reported, see persist). */
export const PENDING_MINOR_RESTRICTION_MAX_OWNERS = 10_000;

/**
 * In-process quarantine of restrictions that could not (yet) be persisted, keyed by the AUTHENTICATED owner. Not durable, not shared
 * between instances (see the header). Entries are removed only by `remove` after a durable write of exactly that entry.
 */
export interface PendingMinorRestrictions {
  has(owner: string): boolean;
  get(owner: string): PendingReport | null;
  /** Idempotent: an owner already pending keeps its (earlier) entry. Returns the entry, or null when the registry is full. */
  add(owner: string, report: PendingReport): PendingReport | null;
  /** Removes the owner only if `entry` is still its current entry (a newer concurrent add is never lost). */
  remove(owner: string, entry: PendingReport): void;
  readonly size: number;
}

export function createPendingMinorRestrictions(maxOwners: number = PENDING_MINOR_RESTRICTION_MAX_OWNERS): PendingMinorRestrictions {
  const m = new Map<string, PendingReport>();
  return {
    has: (owner) => m.has(owner),
    get: (owner) => m.get(owner) ?? null,
    add(owner, report) {
      const cur = m.get(owner);
      if (cur) return cur;
      if (!OWNER_RE.test(owner) || m.size >= Math.max(0, maxOwners)) return null;
      const entry: PendingReport = Object.freeze({ turnId: isTurnId(report.turnId) ? report.turnId : "unknown", now: report.now });
      m.set(owner, entry);
      return entry;
    },
    remove(owner, entry) { if (m.get(owner) === entry) m.delete(owner); },
    get size() { return m.size; },
  };
}

const pendingByStore = new WeakMap<object, PendingMinorRestrictions>();
/** The quarantine that goes with a store object (one per store = one per runtime / process). */
export function pendingMinorRestrictionsFor(store: MinorRestrictionStore): PendingMinorRestrictions {
  let p = pendingByStore.get(store);
  if (!p) { p = createPendingMinorRestrictions(); pendingByStore.set(store, p); }
  return p;
}

export interface PersistResult {
  outcome: "ok" | "conflict" | "unavailable" | "corrupt";
  /** True when the owner is (still) quarantined after this call. False after "ok", or when the registry was full. */
  quarantined: boolean;
}

/**
 * Durably record a restriction for `owner`, with quarantine. `report` = a NEW report (a statement this turn, or a legacy session
 * restriction being promoted) or null (= only retry what is already pending).
 *   1. an older pending entry is retried FIRST; if it still cannot be stored, the owner stays quarantined and the store is not hit again;
 *   2. a new report is registered as pending BEFORE the write attempt (write-ahead: an exception or crash window never drops it),
 *      then written under compare-and-set; only an "ok" removes the entry.
 * Never throws. A failure is never an "ok" and never an empty state.
 */
export async function persistMinorRestriction(store: MinorRestrictionStore, pending: PendingMinorRestrictions, owner: string, report: PendingReport | null): Promise<PersistResult> {
  const old = pending.get(owner);
  if (old) {
    const r = await attempt(store, owner, old);
    if (r === "ok") pending.remove(owner, old);
    else return { outcome: r, quarantined: pending.has(owner) };
  }
  if (!report) return { outcome: "ok", quarantined: false };
  const entry = pending.add(owner, report);
  const outcome = await attempt(store, owner, entry ?? report);
  if (outcome === "ok" && entry) pending.remove(owner, entry);
  return { outcome, quarantined: pending.has(owner) };
}

/**
 * One write attempt per pending entry at a time: concurrent turns that find the same in-flight entry JOIN the running attempt instead of
 * writing it again (no double count; the monotonic merge would make a duplicate harmless, but a race should not inflate the record).
 */
const inflight = new WeakMap<object, Promise<Awaited<ReturnType<typeof recordMinorRestriction>>>>();
function attempt(store: MinorRestrictionStore, owner: string, entry: PendingReport): ReturnType<typeof recordMinorRestriction> {
  let p = inflight.get(entry);
  if (!p) {
    p = recordMinorRestriction(store, owner, entry).finally(() => { inflight.delete(entry); });
    inflight.set(entry, p);
  }
  return p;
}

/**
 * In-memory implementation (tests / local; ONE process, lost on restart — NOT a production store). Keyed by owner with the
 * namespaced prefix; values are kept as JSON text (a stored record cannot be mutated through a returned reference).
 * `raw` is exposed for tests (corrupt-entry injection, key-space assertions).
 */
export function createInMemoryMinorRestrictionStore(): MinorRestrictionStore & { raw: Map<string, { version: number; data: string }> } {
  const raw = new Map<string, { version: number; data: string }>();
  const keyOf = (owner: string): string => {
    if (!OWNER_RE.test(owner)) throw new SessionStoreError("CONFIGURATION_ERROR");
    return `${MINOR_RESTRICTION_KEY_PREFIX}${owner}`;
  };
  return {
    minorRestrictionStore: true,
    raw,
    async read(owner) {
      const e = raw.get(keyOf(owner));
      if (!e) return { record: null, version: "0" };
      let record: unknown;
      try { record = JSON.parse(e.data); } catch { record = e.data; } // unparsable text is handed back RAW: the caller's validation rejects it (CORRUPT) and a fresh report can repair it under CAS
      return { record, version: String(e.version) };
    },
    async write(owner, expectedVersion, record) {
      const key = keyOf(owner);
      const cur = raw.get(key);
      if (String(cur?.version ?? 0) !== expectedVersion) return false;
      raw.set(key, { version: (cur?.version ?? 0) + 1, data: JSON.stringify(record) });
      return true;
    },
  };
}
