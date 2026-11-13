/**
 * Gymini V2 Multi-Agent — DynamoDB-backed VersionedSessionStore (M7-P3.1, part of the approved LOCAL INTEGRATION layer).
 *
 * WHY DynamoDB: the AWS deployment has no Redis / ElastiCache (rate limits already use DynamoDB, the queue uses SQS).
 * Its OWN table — not the rate-limit table (different key schema, and AI roles there may only UpdateItem one table).
 *
 * Item (one per authenticated userId + sessionId; partition key `pk`, no sort key, PAY_PER_REQUEST):
 *   pk        "S#<encodeURIComponent(userId)>#<sessionId>"  (opaque account UUID; no name, email, token or profile value)
 *   gen       random id of THIS incarnation of the session (a re-created session after expiry gets a new one)
 *   ver       Number, incremented on every write
 *   schema    "agent-v2-session/1"
 *   data      String, JSON array of entries (field / kind allowlist, ≤ 64 KB, ≤ 48 entries)
 *   expiresAt Number, epoch SECONDS = last write + 6 h (sliding) — the table's TTL attribute
 * Version token handed to the supervisor: "0" (no live session) or "<gen>.<ver>".
 *
 * Reads are GetItem with ConsistentRead (CAS needs the latest value). Expiry is enforced HERE: an item whose
 * expiresAt has passed is treated as no live session even while DynamoDB's asynchronous TTL sweep has not deleted it
 * yet — its entries are never returned (no resurrection of stale evidence).
 * Writes are one conditional PutItem — never a blind overwrite:
 *   expected "0"          → attribute_not_exists(pk) OR expiresAt <= :now          (create, or replace an EXPIRED item)
 *   expected "<gen>.<ver>"→ gen = :gen AND ver = :ver AND expiresAt > :now           (same live incarnation only)
 * so a writer that read an older version, an expired session, or a session another writer re-created is rejected
 * (ConditionalCheckFailed → false); the supervisor's updateSession re-reads, re-validates, re-merges (≤ 3 rounds).
 * Errors are typed SessionStoreError — never "empty". Hard timeout per call (AbortSignal + race); the SDK's own
 * bounded retry (maxAttempts 2) is the only retry. Nothing is logged.
 *
 * NOT VERIFIED BY REAL DYNAMODB: tested offline with the SDK `send` mocked at the transport boundary.
 */
import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  MAX_STORED_ENTRIES, PERSISTABLE_KINDS, SESSION_TTL_MS, SessionStoreError, type ContextEntry, type SessionStoreErrorKind, type VersionedSessionStore,
} from "../agent-v2/session-context";
import { MAX_SESSION_BYTES, SESSION_SCHEMA } from "./redis-session-store";

/** The transport seam (the DocumentClient's `send`). Tests replace it; nothing else of the SDK is used. */
export type DynamoSend = (command: GetCommand | PutCommand, options: { abortSignal: AbortSignal }) => Promise<any>;

export function dynamoSessionKey(owner: string, sessionId: string): string {
  if (typeof owner !== "string" || !/^\S{1,128}$/.test(owner)) throw new SessionStoreError("CONFIGURATION_ERROR");
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(sessionId)) throw new SessionStoreError("CONFIGURATION_ERROR");
  return `S#${encodeURIComponent(owner)}#${sessionId}`;
}

/** SDK error → typed store error (by error NAME, never message text). */
export function classifyDynamoError(err: unknown): SessionStoreError {
  if (err instanceof SessionStoreError) return err;
  const name = String((err as { name?: unknown } | null)?.name ?? "");
  const kind: SessionStoreErrorKind =
    /^(AccessDeniedException|UnrecognizedClientException|InvalidSignatureException|ExpiredTokenException|CredentialsProviderError)$/.test(name) ? "ACCESS_DENIED"
    : /^(ProvisionedThroughputExceededException|ThrottlingException|RequestLimitExceeded|LimitExceededException)$/.test(name) ? "THROTTLED"
    : /^(TimeoutError|AbortError|RequestTimeout|RequestTimeoutException)$/.test(name) ? "TIMEOUT"
    : /^(ResourceNotFoundException|ValidationException)$/.test(name) ? "CONFIGURATION_ERROR"
    : name === "ItemCollectionSizeLimitExceededException" ? "TOO_LARGE"
    : "UNAVAILABLE";
  return new SessionStoreError(kind);
}

const ENTRY_FIELDS = ["id", "owner", "sessionId", "kind", "subject", "value", "source", "createdAt", "expiresAt", "verification", "supersededBy"] as const;
function serializable(e: ContextEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of ENTRY_FIELDS) if (e[f] !== undefined) out[f] = f === "source" ? { producer: e.source.producer, ...(e.source.toolIds ? { toolIds: e.source.toolIds.slice(0, 6) } : {}), turnId: e.source.turnId } : e[f];
  return out;
}

export interface DynamoSessionStoreOptions {
  tableName: string;
  send: DynamoSend;
  now?: () => number;
  /** Per-call timeout (default 800 ms). */
  timeoutMs?: number;
  ttlMs?: number;
}

export function createDynamoSessionStore(o: DynamoSessionStoreOptions): VersionedSessionStore {
  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(o.tableName ?? "")) throw new SessionStoreError("CONFIGURATION_ERROR");
  const now = o.now ?? Date.now;
  const timeoutMs = Math.max(1, o.timeoutMs ?? 800);
  const ttlMs = Math.max(60_000, o.ttlMs ?? SESSION_TTL_MS);
  const call = async (command: GetCommand | PutCommand): Promise<any> => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const TIMED_OUT = Symbol("timeout");
    try {
      const r = await Promise.race([
        Promise.resolve().then(() => o.send(command, { abortSignal: ctl.signal })),
        new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(TIMED_OUT); }, timeoutMs); }),
      ]);
      if (r === TIMED_OUT) throw new SessionStoreError("TIMEOUT");
      return r;
    } catch (err) {
      if ((err as { name?: unknown })?.name === "ConditionalCheckFailedException") throw err; // handled by write()
      throw classifyDynamoError(err);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    versioned: true,
    async read(owner, sessionId) {
      const pk = dynamoSessionKey(owner, sessionId);
      const res = await call(new GetCommand({ TableName: o.tableName, Key: { pk }, ConsistentRead: true }));
      if (!res || typeof res !== "object") throw new SessionStoreError("INVALID_RESPONSE");
      const item = res.Item as Record<string, unknown> | undefined;
      if (item === undefined) return { entries: [], version: "0" };
      if (!item || typeof item !== "object" || item.pk !== pk) throw new SessionStoreError("CORRUPT");
      const exp = Number(item.expiresAt);
      if (!Number.isFinite(exp)) throw new SessionStoreError("CORRUPT");
      if (exp * 1000 <= now()) return { entries: [], version: "0" }; // expired but not yet swept: no live session, entries ignored
      if (item.schema !== SESSION_SCHEMA || typeof item.gen !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(item.gen)
        || !Number.isInteger(Number(item.ver)) || Number(item.ver) < 1 || typeof item.data !== "string") throw new SessionStoreError("CORRUPT");
      if (Buffer.byteLength(item.data, "utf8") > MAX_SESSION_BYTES) throw new SessionStoreError("TOO_LARGE");
      let parsed: unknown;
      try { parsed = JSON.parse(item.data); } catch { throw new SessionStoreError("CORRUPT"); }
      if (!Array.isArray(parsed)) throw new SessionStoreError("CORRUPT");
      return { entries: parsed, version: `${item.gen}.${Number(item.ver)}` };
    },
    async write(owner, sessionId, expectedVersion, entries) {
      const pk = dynamoSessionKey(owner, sessionId);
      const m = /^(?:0|([A-Za-z0-9-]{8,64})\.(\d{1,15}))$/.exec(expectedVersion ?? "");
      if (!m) throw new SessionStoreError("CONFIGURATION_ERROR");
      const clean = entries.filter((e) => PERSISTABLE_KINDS.has(e.kind) && e.owner === owner && e.sessionId === sessionId).slice(-MAX_STORED_ENTRIES).map(serializable);
      const data = JSON.stringify(clean);
      if (Buffer.byteLength(data, "utf8") > MAX_SESSION_BYTES) throw new SessionStoreError("TOO_LARGE");
      const t = now();
      const nowSec = Math.floor(t / 1000);
      const creating = expectedVersion === "0";
      const gen = creating ? randomUUID() : m[1];
      const ver = creating ? 1 : Number(m[2]) + 1;
      const command = new PutCommand({
        TableName: o.tableName,
        Item: { pk, gen, ver, schema: SESSION_SCHEMA, data, expiresAt: Math.ceil((t + ttlMs) / 1000) },
        ...(creating
          ? { ConditionExpression: "attribute_not_exists(pk) OR expiresAt <= :now", ExpressionAttributeValues: { ":now": nowSec } }
          : { ConditionExpression: "gen = :gen AND ver = :ver AND expiresAt > :now", ExpressionAttributeValues: { ":gen": m[1], ":ver": Number(m[2]), ":now": nowSec } }),
      });
      try {
        await call(command);
        return true;
      } catch (err) {
        if ((err as { name?: unknown })?.name === "ConditionalCheckFailedException") return false;
        throw err;
      }
    },
  };
}

/** The real transport for a configured runtime: the DocumentClient over the SDK default credential chain (the Lambda
 * execution role) — never static keys; bounded SDK retry. Never created when the flag is OFF or in offline tests. */
export function createDynamoSessionSend(region: string): DynamoSend {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region, maxAttempts: 2 }));
  return (command, options) => client.send(command as any, options) as Promise<any>;
}
