/**
 * Session-resume draft persistence (roadmap P1.7 "session resume hardening",
 * P1-A exit criteria). Persists the CURRENT, not-yet-completed active
 * exercise's editable draft (weight/reps/duration/distance/RPE/RIR — the
 * exact same shape smart-set-prefill.utils.ts initializes) to localStorage,
 * scoped per schedule + exercise, so a browser reload / app-backgrounded /
 * accidental navigation-away-and-back does not lose what the user already
 * typed before they hit "complete".
 *
 * Deliberately narrow scope, matching this project's existing
 * rest-timer-persistence precedent (WorkoutLogPage.tsx's
 * restTimerStorageKey/persistRestTimer/clearPersistedRestTimer):
 * - Never marks anything completed — this only ever restores draft INPUT
 *   state, exactly like a user re-typing the same values themselves.
 * - Scoped per (scheduleId, exerciseId) pair so switching exercises within
 *   the same day never bleeds one exercise's draft into another's, and a
 *   totally different schedule's leftover draft can never resurrect here
 *   (same isolation property already proven for the rest timer).
 * - Bounded by a max age (`MAX_DRAFT_AGE_MS`) so a long-abandoned draft is
 *   never silently resurrected days later ("do not accidentally reopen
 *   yesterday's completed workout" — roadmap P1.7's explicit warning) —
 *   the smart-prefill effect takes back over once a draft goes stale, which
 *   is exactly the desired fallback (progression/previous/prescription,
 *   not a fossil the user has long forgotten).
 *
 * `storage` is injectable (Web Storage-like: getItem/setItem/removeItem)
 * so this is directly unit-testable with a plain in-memory fake, matching
 * wake-lock.utils.ts's dependency-injection convention — this repo's
 * frontend has no jsdom/RTL, and Node's own `localStorage` global isn't
 * available in this test runner either. Every real call site in
 * WorkoutLogPage.tsx omits `storage` and gets the browser's real
 * `localStorage`. All storage access is defensively wrapped — private
 * browsing / storage-blocked contexts must never break active logging,
 * only silently skip persistence, matching every other localStorage use
 * in this file.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof localStorage !== "undefined") return localStorage;
  return null;
}

const MAX_DRAFT_AGE_MS = 12 * 60 * 60 * 1000; // 12h — well short of "next day"

export interface PersistableActiveLogDraft {
  weightKg: string;
  bodyWeightAtSetKg: string;
  durationSeconds: string;
  distanceMeters: string;
  tempo?: string;
  reps: string;
  noWeight: boolean;
  rpe: number;
  rir: number;
  setType?: string;
  setTechnique?: "STRAIGHT" | "DROP_SET" | "REST_PAUSE";
  segments?: Array<{
    reps: string;
    weightKg: string;
    restBeforeSeconds: string;
  }>;
}

interface StoredActiveLogDraft {
  savedAt: number;
  draft: PersistableActiveLogDraft;
}

export function activeLogDraftStorageKey(
  scheduleId: string | null,
  exerciseId: string,
): string {
  return `fitness-assistant:active-draft:${scheduleId ?? "freeform"}:${exerciseId}`;
}

export function persistActiveLogDraft(
  scheduleId: string | null,
  exerciseId: string,
  draft: PersistableActiveLogDraft,
  storage?: StorageLike,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    const payload: StoredActiveLogDraft = { savedAt: Date.now(), draft };
    store.setItem(activeLogDraftStorageKey(scheduleId, exerciseId), JSON.stringify(payload));
  } catch {
    // ignore — persistence is a convenience, never a hard dependency
  }
}

export function clearPersistedActiveLogDraft(
  scheduleId: string | null,
  exerciseId: string,
  storage?: StorageLike,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(activeLogDraftStorageKey(scheduleId, exerciseId));
  } catch {
    // ignore
  }
}

/**
 * Reads a persisted draft back, if one exists, is well-formed, and is not
 * older than MAX_DRAFT_AGE_MS. A stale/corrupt/missing entry returns null
 * (and, for a stale one, is proactively removed) rather than ever throwing
 * or resurrecting old data — same "silently discard, never resurrect"
 * contract as the rest timer's restore path.
 */
export function readPersistedActiveLogDraft(
  scheduleId: string | null,
  exerciseId: string,
  storage?: StorageLike,
  now: number = Date.now(),
): PersistableActiveLogDraft | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  const key = activeLogDraftStorageKey(scheduleId, exerciseId);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredActiveLogDraft;
    if (
      typeof parsed?.savedAt !== "number" ||
      !parsed.draft ||
      typeof parsed.draft !== "object"
    ) {
      store.removeItem(key);
      return null;
    }
    if (now - parsed.savedAt > MAX_DRAFT_AGE_MS) {
      store.removeItem(key);
      return null;
    }
    return parsed.draft;
  } catch {
    return null;
  }
}
