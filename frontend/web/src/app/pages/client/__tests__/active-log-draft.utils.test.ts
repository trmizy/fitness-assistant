/**
 * Session-resume draft persistence tests (roadmap P1.7 / P1-A). Pure-logic
 * + a plain in-memory fake storage — no jsdom/RTL, matches this frontend's
 * established convention (see wake-lock.utils.test.ts for the same
 * dependency-injection approach applied to a different browser API).
 *
 * Run with: npx tsx --test src/app/pages/client/__tests__/active-log-draft.utils.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activeLogDraftStorageKey,
  persistActiveLogDraft,
  readPersistedActiveLogDraft,
  clearPersistedActiveLogDraft,
  type PersistableActiveLogDraft,
  type StorageLike,
} from "../active-log-draft.utils";

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const SAMPLE_DRAFT: PersistableActiveLogDraft = {
  weightKg: "65",
  bodyWeightAtSetKg: "",
  durationSeconds: "",
  distanceMeters: "",
  reps: "",
  noWeight: false,
  rpe: 8,
  rir: 1,
};

describe("activeLogDraftStorageKey", () => {
  it("scopes by both scheduleId and exerciseId", () => {
    assert.equal(
      activeLogDraftStorageKey("sched-1", "ex-1"),
      "fitness-assistant:active-draft:sched-1:ex-1",
    );
  });

  it("falls back to 'freeform' when scheduleId is null (freeform/ad-hoc workout)", () => {
    assert.equal(
      activeLogDraftStorageKey(null, "ex-1"),
      "fitness-assistant:active-draft:freeform:ex-1",
    );
  });

  it("different exercises under the same schedule never collide", () => {
    assert.notEqual(
      activeLogDraftStorageKey("sched-1", "ex-1"),
      activeLogDraftStorageKey("sched-1", "ex-2"),
    );
  });

  it("the same exercise under different schedules never collides (isolation)", () => {
    assert.notEqual(
      activeLogDraftStorageKey("sched-1", "ex-1"),
      activeLogDraftStorageKey("sched-2", "ex-1"),
    );
  });
});

describe("persistActiveLogDraft / readPersistedActiveLogDraft", () => {
  it("round-trips a real draft exactly", () => {
    const storage = fakeStorage();
    persistActiveLogDraft("sched-1", "ex-1", SAMPLE_DRAFT, storage);
    const read = readPersistedActiveLogDraft("sched-1", "ex-1", storage);
    assert.deepEqual(read, SAMPLE_DRAFT);
  });

  it("returns null when nothing was ever persisted for this key", () => {
    const storage = fakeStorage();
    assert.equal(readPersistedActiveLogDraft("sched-1", "ex-1", storage), null);
  });

  it("a draft for a DIFFERENT exercise never bleeds into this one (isolation)", () => {
    const storage = fakeStorage();
    persistActiveLogDraft("sched-1", "ex-1", SAMPLE_DRAFT, storage);
    assert.equal(readPersistedActiveLogDraft("sched-1", "ex-2", storage), null);
  });

  it("a draft for a DIFFERENT schedule never bleeds into this one (isolation)", () => {
    const storage = fakeStorage();
    persistActiveLogDraft("sched-1", "ex-1", SAMPLE_DRAFT, storage);
    assert.equal(readPersistedActiveLogDraft("sched-2", "ex-1", storage), null);
  });

  it("a draft older than 12h is discarded, never resurrected — and the stale entry is actually removed", () => {
    const storage = fakeStorage();
    persistActiveLogDraft("sched-1", "ex-1", SAMPLE_DRAFT, storage);
    const thirteenHoursLater = Date.now() + 13 * 60 * 60 * 1000;
    const read = readPersistedActiveLogDraft("sched-1", "ex-1", storage, thirteenHoursLater);
    assert.equal(read, null);
    // Proves real cleanup ran, not just that nothing rendered it.
    assert.equal(storage.getItem(activeLogDraftStorageKey("sched-1", "ex-1")), null);
  });

  it("a draft just under 12h old is still restored (boundary check)", () => {
    const storage = fakeStorage();
    persistActiveLogDraft("sched-1", "ex-1", SAMPLE_DRAFT, storage);
    const elevenHoursLater = Date.now() + 11 * 60 * 60 * 1000;
    const read = readPersistedActiveLogDraft("sched-1", "ex-1", storage, elevenHoursLater);
    assert.deepEqual(read, SAMPLE_DRAFT);
  });

  it("malformed JSON is discarded, not thrown", () => {
    const storage = fakeStorage();
    storage.setItem(activeLogDraftStorageKey("sched-1", "ex-1"), "{not valid json");
    assert.equal(readPersistedActiveLogDraft("sched-1", "ex-1", storage), null);
  });

  it("well-formed JSON missing the expected shape (no savedAt/draft) is discarded, not thrown", () => {
    const storage = fakeStorage();
    storage.setItem(activeLogDraftStorageKey("sched-1", "ex-1"), JSON.stringify({ foo: "bar" }));
    assert.equal(readPersistedActiveLogDraft("sched-1", "ex-1", storage), null);
  });

  it("clearPersistedActiveLogDraft removes exactly the targeted key, leaving others intact", () => {
    const storage = fakeStorage();
    persistActiveLogDraft("sched-1", "ex-1", SAMPLE_DRAFT, storage);
    persistActiveLogDraft("sched-1", "ex-2", SAMPLE_DRAFT, storage);
    clearPersistedActiveLogDraft("sched-1", "ex-1", storage);
    assert.equal(readPersistedActiveLogDraft("sched-1", "ex-1", storage), null);
    assert.deepEqual(readPersistedActiveLogDraft("sched-1", "ex-2", storage), SAMPLE_DRAFT);
  });

  it("no storage available (undefined localStorage, e.g. SSR/non-browser) never throws", () => {
    // No global localStorage exists in this Node test runner and no
    // storage override is passed — resolveStorage() must fall back to
    // null and every function must no-op safely.
    assert.doesNotThrow(() => persistActiveLogDraft("sched-1", "ex-1", SAMPLE_DRAFT));
    assert.doesNotThrow(() => clearPersistedActiveLogDraft("sched-1", "ex-1"));
    assert.equal(readPersistedActiveLogDraft("sched-1", "ex-1"), null);
  });
});
