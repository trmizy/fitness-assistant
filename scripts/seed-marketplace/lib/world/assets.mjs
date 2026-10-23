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

/** items grouped by category, sorted by file name so every run sees the same order. */
export function gymPhotoPool() {
  const by = {};
  for (const it of manifest().items.filter((i) => i.kind === "gym")) (by[it.category] ??= []).push(it);
  return by;
}
export function physiquePool() {
  return manifest().items.filter((i) => i.kind === "physique");
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

/** Physique photos: handed out in a rotating fashion; one PT never gets the same photo twice. */
let _physCursor = 0;
export function resetPhysiqueCursor() {
  _physCursor = 0;
}
export function pickPhysique(gender, n) {
  const pool = physiquePool();
  const men = pool.filter((p) => p.category !== "physique-women");
  const women = pool.filter((p) => p.category === "physique-women");
  const src = gender === "FEMALE" ? women : men;
  const out = [];
  for (let i = 0; i < n; i++) out.push(src[(_physCursor++) % src.length]);
  return [...new Map(out.map((o) => [o.id, o])).values()];
}
