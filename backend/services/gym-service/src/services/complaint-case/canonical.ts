import { createHash } from "node:crypto";

/**
 * Canonical JSON for evidence hashing (DISPUTE CASE slice 1): keys sorted recursively, `undefined` dropped, Date / Prisma.Decimal
 * (anything with toJSON) turned into their JSON form first. Two payloads with the same content in a different key order, or read
 * back from a jsonb column, hash identically; that is what lets "recollect" tell a real change from a re-read.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function") {
    return canonicalize((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) return value.map((v) => (typeof v === "undefined" ? null : canonicalize(v)));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const v = canonicalize((value as Record<string, unknown>)[key]);
      if (typeof v !== "undefined") out[key] = v;
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value) ?? null);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 (hex) of the canonical JSON of a payload: the `contentHash` of an evidence row / statement. */
export function contentHashOf(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}
