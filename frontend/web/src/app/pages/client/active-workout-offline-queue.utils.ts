// Roadmap P1.4 "Active-workout offline resilience"
// (docs/features/ACTIVE_WORKOUT_OFFLINE_RESILIENCE_IMPACT_ANALYSIS.md).
//
// A durable local queue for active-workout mutations (set complete/undo)
// that couldn't reach the server, backed by IndexedDB — unlike
// localStorage (used by active-log-draft.utils.ts / rest-timer
// persistence for small, ephemeral state), IndexedDB survives a hard
// refresh AND a browser crash/reopen, which "the completed set must
// survive reload" requires.
//
// Same DI-testable shape this project already established
// (wake-lock.utils.ts / active-log-draft.utils.ts): every function that
// touches the real browser API takes an optional override, defaulting to
// the real global — but the actual QUEUE LOGIC (ordering, event shape)
// is split into pure functions below that need no IndexedDB at all, so
// unit tests exercise them directly without a fake-indexeddb dependency.
// The I/O functions themselves are only proven by real-browser E2E.

export type QueuedWorkoutEventType = "SET_COMPLETED" | "SET_UNDONE" | "EXERCISE_COMPLETED";

export interface QueuedWorkoutEvent {
  eventId: string;
  type: QueuedWorkoutEventType;
  createdAt: number;
  method: "PATCH" | "POST";
  url: string;
  body: Record<string, unknown>;
}

const DB_NAME = "fitness-assistant-offline-queue";
const STORE_NAME = "pending-events";
const DB_VERSION = 1;

function resolveIndexedDB(indexedDBImpl?: IDBFactory | null): IDBFactory | null {
  if (indexedDBImpl) return indexedDBImpl;
  if (indexedDBImpl === null) return null; // explicit override to "unavailable", for tests
  if (typeof window !== "undefined" && window.indexedDB) return window.indexedDB;
  return null;
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "eventId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Pure — no IndexedDB, no Date.now() ambient call — safe to unit test
 * directly. Oldest first, so a drain replays events in the order they
 * actually happened (a completed set's undo, if also queued, must never
 * replay before the completion it's undoing). */
export function sortWorkoutEventsChronologically(
  events: QueuedWorkoutEvent[],
): QueuedWorkoutEvent[] {
  return [...events].sort((a, b) => a.createdAt - b.createdAt);
}

/** Pure — builds the exact request shape a per-set completion/undo needs,
 * including the eventId inside the body (the field workout.controller.ts
 * reads as the idempotency key). Kept separate from the actual
 * workoutService call so it's testable without touching axios/the API. */
export function buildQueuedSetEvent(params: {
  eventId: string;
  setId: string;
  type: QueuedWorkoutEventType;
  patch: Record<string, unknown>;
  now?: number;
}): QueuedWorkoutEvent {
  return {
    eventId: params.eventId,
    type: params.type,
    createdAt: params.now ?? Date.now(),
    method: "PATCH",
    url: `/workouts/sets/${params.setId}`,
    body: { ...params.patch, eventId: params.eventId },
  };
}

/** Never throws — matches this project's established "storage helpers
 * degrade silently, never break the active workout" convention (see
 * active-log-draft.utils.ts's own doc comment). A browser with no
 * IndexedDB (or one that throws, e.g. private-mode Safari quirks) just
 * means this event isn't durably queued — the caller's own optimistic
 * local state still shows it as done; it will simply need a real
 * connection to actually sync, same as if IndexedDB didn't exist at all. */
export async function enqueueWorkoutEvent(
  event: QueuedWorkoutEvent,
  indexedDBImpl?: IDBFactory | null,
): Promise<void> {
  try {
    const idb = resolveIndexedDB(indexedDBImpl);
    if (!idb) return;
    const db = await openDb(idb);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(event);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-critical — see doc comment above.
  }
}

export async function getPendingWorkoutEvents(
  indexedDBImpl?: IDBFactory | null,
): Promise<QueuedWorkoutEvent[]> {
  try {
    const idb = resolveIndexedDB(indexedDBImpl);
    if (!idb) return [];
    const db = await openDb(idb);
    const events = await new Promise<QueuedWorkoutEvent[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result ?? []) as QueuedWorkoutEvent[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return sortWorkoutEventsChronologically(events);
  } catch {
    return [];
  }
}

export async function removeWorkoutEvent(
  eventId: string,
  indexedDBImpl?: IDBFactory | null,
): Promise<void> {
  try {
    const idb = resolveIndexedDB(indexedDBImpl);
    if (!idb) return;
    const db = await openDb(idb);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(eventId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Non-critical.
  }
}
