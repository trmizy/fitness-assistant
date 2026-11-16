/**
 * Test-only in-memory fakes for the AI Coach bridge ports (idempotency store, history repository). NEVER imported by production
 * code (no "*.test.ts" suffix only so two test files can share them). Not a store implementation: no TTL, no persistence.
 */
import type { CoachIdempotencyStore, CoachHistoryPort, IdempotencyRecord, V2HistoryTurnInput, HistorySession } from "../services/coach-v2-continuity";

// ── fakes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function fakeStore(over: { failClaim?: boolean; failComplete?: boolean; failRelease?: boolean; corrupt?: boolean } = {}) {
  const recs = new Map<string, IdempotencyRecord>();
  const k = (u: string, id: string) => JSON.stringify([u, id]);
  const store: CoachIdempotencyStore = {
    async claim(u, id, fp) {
      if (over.failClaim) throw new Error("store down");
      const cur = recs.get(k(u, id));
      if (cur) return { claimed: false, record: over.corrupt ? ({ state: "???", fingerprint: fp } as unknown as IdempotencyRecord) : cur };
      recs.set(k(u, id), { state: "IN_PROGRESS", fingerprint: fp }); // atomic: no await between check and set
      return { claimed: true };
    },
    async complete(u, id, fp, outcome) { if (over.failComplete) throw new Error("x"); recs.set(k(u, id), { state: "COMPLETED", fingerprint: fp, outcome }); },
    async markInDoubt(u, id, fp) { recs.set(k(u, id), { state: "IN_DOUBT", fingerprint: fp }); },
    async release(u, id) { if (over.failRelease) throw new Error("x"); const c = recs.get(k(u, id)); if (c?.state === "IN_PROGRESS") recs.delete(k(u, id)); },
  };
  return { store, recs, key: k };
}

export interface Turn extends V2HistoryTurnInput { id: string; [extra: string]: unknown }
export function fakeHistory(over: { failCreateTurnTimes?: number; failFind?: boolean } = {}) {
  const sessions = new Map<string, HistorySession & { title?: string }>();
  const turns: Turn[] = [];
  const legacyEngines = new Map<string, string[]>(); // engines of turns that were not created through this port (e.g. V1 turns)
  let failTimes = over.failCreateTurnTimes ?? 0;
  const history: CoachHistoryPort = {
    async findSession(id) { if (over.failFind) throw new Error("db down"); return sessions.get(id) ?? null; },
    async listSessionTurnEngines(u, s) { return [...(legacyEngines.get(s) ?? []), ...turns.filter((t) => t.userId === u && t.sessionId === s).map((t) => t.modelUsed)]; },
    async findTurnByClientRequestId(u, id) { return turns.find((t) => t.userId === u && t.clientRequestId === id) ?? null; },
    async createSession(d) { if (sessions.has(d.id)) throw Object.assign(new Error("dup"), { code: "P2002" }); sessions.set(d.id, { id: d.id, userId: d.userId, archivedAt: null, title: d.title }); },
    async createTurn(d) {
      if (failTimes > 0) { failTimes--; throw new Error("db write failed"); }
      if (turns.some((t) => t.userId === d.userId && t.clientRequestId === d.clientRequestId)) throw Object.assign(new Error("dup"), { code: "P2002" });
      turns.push({ ...d, id: `turn-${turns.length + 1}` });
    },
    async touchSession() { /* no-op */ },
  };
  return { history, sessions, turns, legacyEngines };
}

