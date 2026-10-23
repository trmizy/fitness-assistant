// Small deterministic helpers shared by the whole marketplace seed (no I/O, no network, no globals that change between runs).
import { createHash } from "node:crypto";

export const SEED_NAMESPACE = process.env.SEED_MARKETPLACE_NAMESPACE || "gymini-marketplace-seed-v1";
export const SEED_EMAIL_DOMAIN = "seed.gymini.test";

/** Deterministic UUID (same shape as user-service seed-agentic-demo.ts did(): sha256 -> version 5 / variant a). */
export function did(...parts) {
  const hex = createHash("sha256").update(`${SEED_NAMESPACE}:${parts.join(":")}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** mulberry32 seeded from a string - reproducible across machines. */
export function rngFrom(seedStr) {
  let a = 0;
  for (let i = 0; i < seedStr.length; i++) a = (a * 31 + seedStr.charCodeAt(i)) >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeHelpers(rng) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const int = (min, max) => Math.floor(min + rng() * (max - min + 1));
  const float = (min, max, d = 1) => Number((min + rng() * (max - min)).toFixed(d));
  const chance = (p) => rng() < p;
  /** n distinct items of arr (order follows the rng). */
  const sample = (arr, n) => {
    const copy = [...arr];
    const out = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
    return out;
  };
  const weighted = (pairs) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [v, w] of pairs) {
      r -= w;
      if (r <= 0) return v;
    }
    return pairs[pairs.length - 1][0];
  };
  return { pick, int, float, chance, sample, weighted };
}

/** "Nguyễn Trường Thành" -> "nguyen-truong-thanh" (d with stroke -> d). */
export function slugify(text) {
  return String(text)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Accent-stripped lower-case form used for the *_normalized search columns. */
export function normalizeVi(text) {
  return String(text)
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export const seedEmail = (slug) => `${slug}@${SEED_EMAIL_DOMAIN}`;
export const isSeedEmail = (email) => typeof email === "string" && email.toLowerCase().endsWith(`@${SEED_EMAIL_DOMAIN}`);

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** A date `n` days before the fixed seed epoch (NOT now()), so a re-run produces byte-identical timestamps. */
export const SEED_EPOCH = new Date(process.env.SEED_MARKETPLACE_EPOCH || "2026-10-23T00:00:00.000Z");
export const daysBefore = (n, extraHours = 0) => new Date(SEED_EPOCH.getTime() - n * 86400000 + extraHours * 3600000);
