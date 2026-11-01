import { createHash } from "node:crypto";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k])).join(",") + "}";
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error("NonJsonValue");
  return result;
}
export const digest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
