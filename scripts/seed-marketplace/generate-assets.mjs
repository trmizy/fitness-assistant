#!/usr/bin/env node
/**
 * generate-assets.mjs - the ONLY step of the marketplace seed that needs the network.
 *
 * Fetches licensed (Pexels licence) fitness photos ONCE, resizes them to ~800px webp and stores them
 * (with manifest.json: id, photographer, source url, sha256, licence) under scripts/seed-marketplace/assets/.
 * The seed itself (index.mjs) reads only those local files and never touches the network.
 *
 *   node scripts/seed-marketplace/generate-assets.mjs [--force]
 *
 * PEXELS_API_KEY is read from <repo>/.env (or the environment) and is never printed or written anywhere.
 * `sharp` is resolved from backend/services/*\/node_modules (already installed there; nothing is added at the root).
 * Re-running is a no-op when manifest.json exists, unless --force is given (--force replaces the whole asset set).
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const assetsDir = path.join(here, "assets");
const require = createRequire(import.meta.url);

const MAX_TOTAL_BYTES = 14.5 * 1024 * 1024; // "<= ~15 MB"
const WIDTH = 800;
const WEBP_QUALITY = 70;

// category -> [name, pexels query, wanted count, orientation, assets sub-folder]
export const CATEGORIES = [
  ["gym-interior", "gym interior", 40, "landscape", "gym"],
  ["fitness-center", "fitness center", 30, "landscape", "gym"],
  ["free-weights", "weight room dumbbells", 30, "landscape", "gym"],
  ["cardio", "treadmill gym cardio", 18, "landscape", "gym"],
  ["crossfit", "crossfit box gym", 16, "landscape", "gym"],
  ["yoga-studio", "yoga studio", 18, "landscape", "gym"],
  ["boxing", "boxing gym", 14, "landscape", "gym"],
  ["pool", "gym swimming pool", 12, "landscape", "gym"],
  ["locker-room", "gym locker room", 8, "landscape", "gym"],
  ["reception", "gym reception desk", 6, "landscape", "gym"],
  ["functional", "functional training gym", 16, "landscape", "gym"],
  ["exterior", "gym building exterior", 12, "landscape", "gym"],
  ["physique-men", "fitness athlete physique man", 55, "portrait", "physique"],
  ["physique-bodybuilder", "bodybuilder gym", 20, "portrait", "physique"],
  ["physique-women", "woman athlete fitness", 55, "portrait", "physique"],
  ["physique-trainer", "personal trainer", 15, "portrait", "physique"],
];

function loadKey() {
  if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY;
  const envFile = path.join(repoRoot, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*PEXELS_API_KEY\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  }
  return "";
}

function loadSharp() {
  const base = path.join(repoRoot, "backend", "services");
  for (const svc of fs.readdirSync(base)) {
    const p = path.join(base, svc, "node_modules", "sharp");
    if (fs.existsSync(p)) return require(p);
  }
  throw new Error("sharp not found under backend/services/*/node_modules");
}

const BAD_ALT = /\b(celebrity|logo|watermark|poster|billboard|meme|nude|naked|kid|child|baby)\b/i;

async function main() {
  const force = process.argv.includes("--force");
  const manifestPath = path.join(assetsDir, "manifest.json");
  if (fs.existsSync(manifestPath) && !force) {
    console.log("[assets] manifest.json already exists - nothing to do (use --force to regenerate).");
    return;
  }
  const key = loadKey();
  if (!key) throw new Error("PEXELS_API_KEY missing (put it in .env). The key is never printed.");
  const sharp = loadSharp();

  if (force && fs.existsSync(assetsDir)) {
    for (const sub of ["gym", "physique"]) fs.rmSync(path.join(assetsDir, sub), { recursive: true, force: true });
  }
  for (const sub of ["gym", "physique"]) fs.mkdirSync(path.join(assetsDir, sub), { recursive: true });

  const seenPexelsIds = new Set();
  const seenHashes = new Set();
  const items = [];
  let total = 0;
  let budgetHit = false;

  for (const [category, query, want, orientation, folder] of CATEGORIES) {
    let got = 0;
    for (let page = 1; page <= 4 && got < want && !budgetHit; page++) {
      const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=40&page=${page}&orientation=${orientation}&size=medium`;
      const res = await fetch(url, { headers: { Authorization: key } });
      if (!res.ok) throw new Error(`Pexels search "${query}" failed: HTTP ${res.status}`);
      const json = await res.json();
      for (const ph of json.photos ?? []) {
        if (got >= want) break;
        if (seenPexelsIds.has(ph.id)) continue;
        if (BAD_ALT.test(ph.alt ?? "")) continue;
        if (ph.width < 1000 || ph.height < 700) continue;
        const src = ph.src?.large ?? ph.src?.medium;
        if (!src) continue;
        const img = await fetch(src);
        if (!img.ok) continue;
        const input = Buffer.from(await img.arrayBuffer());
        const pipeline =
          orientation === "portrait"
            ? sharp(input).rotate().resize({ width: WIDTH, height: Math.round(WIDTH * 1.25), fit: "cover", position: "attention" })
            : sharp(input).rotate().resize({ width: WIDTH, withoutEnlargement: true });
        const out = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
        const hash = createHash("sha256").update(out).digest("hex");
        if (seenHashes.has(hash)) continue;
        if (total + out.length > MAX_TOTAL_BYTES) {
          console.log(`[assets] size budget reached at ${(total / 1048576).toFixed(2)} MB - stopping.`);
          budgetHit = true;
          break;
        }
        const file = `${folder}/${category}-${String(ph.id)}.webp`;
        fs.writeFileSync(path.join(assetsDir, file), out);
        seenPexelsIds.add(ph.id);
        seenHashes.add(hash);
        total += out.length;
        got++;
        items.push({
          id: `pexels-${ph.id}`,
          file,
          kind: folder,
          category,
          photographer: ph.photographer,
          photographerUrl: ph.photographer_url,
          sourceUrl: ph.url,
          alt: ph.alt ?? "",
          bytes: out.length,
          sha256: hash,
        });
      }
    }
    console.log(`[assets] ${category}: ${got}/${want}`);
  }

  items.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "Pexels (https://www.pexels.com)",
    licence: "Pexels License - free to use, attribution to the photographers listed below is appreciated. https://www.pexels.com/license/",
    note: "Seed-only demo imagery. Generated once by generate-assets.mjs; the seed runtime is offline.",
    processing: `resized to ${WIDTH}px wide webp q${WEBP_QUALITY}`,
    totalBytes: total,
    count: items.length,
    items,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(
    path.join(assetsDir, "ATTRIBUTION.md"),
    "# Photo attribution\n\nPhotos provided by [Pexels](https://www.pexels.com). Each file's photographer and source link is listed in `manifest.json`.\n\n" +
      items.map((i) => `- ${i.file} - ${i.photographer} (${i.sourceUrl})`).join("\n") +
      "\n",
  );
  console.log(`[assets] done: ${items.length} files, ${(total / 1048576).toFixed(2)} MB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("[assets] FAILED:", e.message);
    process.exit(1);
  });
}
