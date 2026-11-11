// Reads assets/manifest.json (generated once by generate-assets.mjs). Offline: only local files are touched.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ASSETS_DIR = path.resolve(here, "..", "..", "assets");

let _manifest;
export function manifest() {
  if (!_manifest) {
    const p = path.join(ASSETS_DIR, "manifest.json");
    if (!fs.existsSync(p)) throw new Error("assets/manifest.json missing - run generate-assets.mjs once (needs network + PEXELS_API_KEY)");
    _manifest = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  return _manifest;
}

export const assetPath = (item) => path.join(ASSETS_DIR, ...item.file.split("/"));
export const readAsset = (item) => fs.readFileSync(assetPath(item));

/** items grouped by effective category (excluding REJECTED), sorted by file name so every run sees the same order. */
export function gymPhotoPool() {
  const by = {};
  for (const it of manifest().items) {
    if (it.kind !== "gym") continue;
    if (it.audit?.status === "REJECTED") continue;
    const cat = it.audit?.reclassifiedCategory || it.category;
    (by[cat] ??= []).push(it);
  }
  return by;
}
/** Physique photos: excludes REJECTED; allows portraits/faces as long as audit.gender matches the PT. */
export function physiquePool() {
  return manifest().items.filter((i) => {
    if (i.kind !== "physique") return false;
    return i.audit?.status !== "REJECTED";
  });
}

/**
 * n distinct photos for one branch, round-robin over the preferred categories, never reusing a photo already given to
 * ANOTHER branch (a global cursor per category) as long as the pool lasts; after that, reuse starts but never inside one branch.
 */
const _cursor = new Map();
export function resetPoolCursors() {
  _cursor.clear();
}
export function pickDistinct(pool, cats, n, h) {
  const chosen = [];
  const seen = new Set();
  const allCats = [...cats, ...Object.keys(pool).filter((c) => !cats.includes(c))];
  let guard = 0;
  while (chosen.length < n && guard++ < n * allCats.length * 4 + 50) {
    const cat = chosen.length < cats.length * 4 ? cats[chosen.length % cats.length] : allCats[(chosen.length + guard) % allCats.length];
    const list = pool[cat];
    if (!list?.length) continue;
    const idx = (_cursor.get(cat) ?? 0) % list.length;
    _cursor.set(cat, idx + 1);
    const item = list[idx];
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    chosen.push(item);
  }
  return chosen;
}

/** Physique photos: handed out in a rotating fashion strictly matching audit.gender; one PT never gets the same photo twice. */
const _physCursor = { MALE: 0, FEMALE: 0 };
export function resetPhysiqueCursor() {
  _physCursor.MALE = 0;
  _physCursor.FEMALE = 0;
}
export function pickPhysique(gender, n) {
  const g = gender === "FEMALE" ? "FEMALE" : "MALE";
  const src = physiquePool().filter((p) => p.audit?.gender === g);
  if (!src.length) return [];
  const take = Math.min(n, src.length);
  const out = [];
  for (let i = 0; i < take; i++) {
    out.push(src[_physCursor[g] % src.length]);
    _physCursor[g]++;
  }
  return [...new Map(out.map((o) => [o.id, o])).values()];
}
