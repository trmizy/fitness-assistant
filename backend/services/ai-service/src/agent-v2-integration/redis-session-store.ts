/**
 * Gymini V2 Multi-Agent — Redis-backed VersionedSessionStore (M7-P3, part of the approved LOCAL INTEGRATION layer).
 *
 * One Redis HASH per (authenticated userId, sessionId):
 *   key    gymini:agent-v2:session:v1:<encodeURIComponent(userId)>:<sessionId>  — its own namespace (BullMQ uses "bull:*",
 *          never touched here). The userId is the opaque account UUID V1 already uses as an identifier; no name, email,
 *          token or profile value is ever part of a key. Ownership is enforced twice: by the key and by every stored
 *          entry's owner/sessionId (agent-v2/session-context.ts validateEntry on load).
 *   fields version (integer string, "0" = absent) · schema ("agent-v2-session/1") · data (JSON array of entries)
 *   TTL    PEXPIRE SESSION_TTL_MS (6 h) on every write — sliding session lifetime; per-entry expiry stays in the entries.
 * Writes are compare-and-set in ONE Lua script (version check + HSET + PEXPIRE) — a stale writer is rejected, never a
 * blind overwrite. Reads/writes have a hard timeout; there is no retry here (the supervisor's update does at most a few
 * CAS rounds on a version conflict, never on an error); no failover to another instance; nothing is logged.
 * Only PERSISTABLE kinds and only the listed entry fields are serialized (no prompt, model text, token, secret, profile
 * or raw tool payload can enter: entries are typed scalars built by the supervisor), and the serialized session is
 * size-bounded.
 *
 * NOT VERIFIED BY REAL REDIS: tested offline against a fake client implementing the same commands.
 */
import {
  MAX_STORED_ENTRIES, PERSISTABLE_KINDS, SESSION_TTL_MS, SessionStoreError, type ContextEntry, type VersionedSessionStore,
} from "../agent-v2/session-context";

export const SESSION_KEY_PREFIX = "gymini:agent-v2:session:v1:";
export const SESSION_SCHEMA = "agent-v2-session/1";
/** Serialized bound: MAX_STORED_ENTRIES small typed entries fit comfortably; anything larger is refused. */
export const MAX_SESSION_BYTES = 64 * 1024;

/** The two commands this adapter needs. node-redis v4 (`redis` package already in ai-service) satisfies it. */
export interface SessionRedisClient {
  hmGet(key: string, fields: string[]): Promise<Array<string | null>>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

/** ARGV: expectedVersion, newVersion, schema, data, ttlMs. Returns 1 when written, 0 when the version moved. */
export const CAS_SCRIPT = [
  "local cur = redis.call('HGET', KEYS[1], 'version')",
  "if (cur or '0') ~= ARGV[1] then return 0 end",
  "redis.call('HSET', KEYS[1], 'version', ARGV[2], 'schema', ARGV[3], 'data', ARGV[4])",
  "redis.call('PEXPIRE', KEYS[1], ARGV[5])",
  "return 1",
].join("\n");

export function sessionKey(owner: string, sessionId: string): string {
  if (typeof owner !== "string" || !/^\S{1,128}$/.test(owner)) throw new SessionStoreError("CONFIGURATION_ERROR");
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) throw new SessionStoreError("CONFIGURATION_ERROR");
  return `${SESSION_KEY_PREFIX}${encodeURIComponent(owner)}:${sessionId}`;
}

const ENTRY_FIELDS = ["id", "owner", "sessionId", "kind", "subject", "value", "source", "createdAt", "expiresAt", "verification", "supersededBy"] as const;
/** Field allowlist: anything else on an entry object is dropped before serialization. */
function serializable(e: ContextEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ENTRY_FIELDS) if (e[f] !== undefined) out[f] = f === "source" ? { producer: e.source.producer, ...(e.source.toolIds ? { toolIds: e.source.toolIds.slice(0, 6) } : {}), turnId: e.source.turnId } : e[f];
  return out;
}

export interface RedisSessionStoreOptions {
  client: SessionRedisClient;
  /** Per-command timeout (default 500 ms read, 800 ms write). */
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
  ttlMs?: number;
}

async function bounded<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMED_OUT = Symbol("timeout");
  try {
    const r = await Promise.race([Promise.resolve().then(work), new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); })]);
    if (r === TIMED_OUT) throw new SessionStoreError("TIMEOUT");
    return r as T;
  } catch (err) {
    if (err instanceof SessionStoreError) throw err;
    throw new SessionStoreError("UNAVAILABLE"); // connection refused / reset / auth / cluster errors — never "empty"
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createRedisSessionStore(o: RedisSessionStoreOptions): VersionedSessionStore {
  const readMs = Math.max(1, o.readTimeoutMs ?? 500);
  const writeMs = Math.max(1, o.writeTimeoutMs ?? 800);
  const ttlMs = Math.max(60_000, o.ttlMs ?? SESSION_TTL_MS);
  return {
    versioned: true,
    async read(owner, sessionId) {
      const key = sessionKey(owner, sessionId);
      const [version, schema, data] = await bounded(() => o.client.hmGet(key, ["version", "schema", "data"]), readMs);
      if (version === null && schema === null && data === null) return { entries: [], version: "0" };
      if (schema !== SESSION_SCHEMA || typeof version !== "string" || !/^\d{1,15}$/.test(version) || typeof data !== "string") throw new SessionStoreError("CORRUPT");
      if (Buffer.byteLength(data, "utf8") > MAX_SESSION_BYTES) throw new SessionStoreError("TOO_LARGE");
      let parsed: unknown;
      try { parsed = JSON.parse(data); } catch { throw new SessionStoreError("CORRUPT"); }
      if (!Array.isArray(parsed)) throw new SessionStoreError("CORRUPT");
      return { entries: parsed, version };
    },
    async write(owner, sessionId, expectedVersion, entries) {
      const key = sessionKey(owner, sessionId);
      if (!/^\d{1,15}$/.test(expectedVersion)) throw new SessionStoreError("CONFIGURATION_ERROR");
      const clean = entries.filter((e) => PERSISTABLE_KINDS.has(e.kind) && e.owner === owner && e.sessionId === sessionId).slice(-MAX_STORED_ENTRIES).map(serializable);
      const data = JSON.stringify(clean);
      if (Buffer.byteLength(data, "utf8") > MAX_SESSION_BYTES) throw new SessionStoreError("TOO_LARGE");
      const next = String(Number(expectedVersion) + 1);
      const r = await bounded(() => o.client.eval(CAS_SCRIPT, { keys: [key], arguments: [expectedVersion, next, SESSION_SCHEMA, data, String(ttlMs)] }), writeMs);
      return Number(r) === 1;
    },
  };
}

/**
 * The real client for a configured runtime: node-redis v4 (`redis`, already an ai-service dependency). Connects lazily
 * on the first command, with a bounded connect timeout, no reconnect storm and no offline queue (a command while
 * disconnected fails fast → UNAVAILABLE). Never created when the flag is OFF or in offline tests.
 */
export function createNodeRedisSessionClient(url: string): SessionRedisClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("redis") as typeof import("redis");
  const client = createClient({ url, disableOfflineQueue: true, socket: { connectTimeout: 1_000, reconnectStrategy: (retries: number) => (retries >= 2 ? false : 200) } });
  client.on("error", () => { /* surfaced per command as UNAVAILABLE; never logged with the URL */ });
  let connecting: Promise<unknown> | null = null;
  const ready = () => (client.isReady ? Promise.resolve() : (connecting ??= client.connect().finally(() => { connecting = null; })));
  return {
    async hmGet(key, fields) { await ready(); return client.hmGet(key, fields) as Promise<Array<string | null>>; },
    async eval(script, options) { await ready(); return client.eval(script, options); },
  };
}
