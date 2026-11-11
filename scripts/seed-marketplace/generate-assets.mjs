#!/usr/bin/env node
/**
 * generate-assets.mjs - the ONLY step of the marketplace seed that needs the network.
 *
 * Fetches licensed (Pexels licence) fitness photos, resizes/compresses them to webp (<= 800px wide,
 * <= 60 KB per image, total manifest <= 15 MB per world.test.mjs) under scripts/seed-marketplace/assets/.
 * The seed itself (index.mjs) reads only those local files and never touches the network.
 *
 *   node scripts/seed-marketplace/generate-assets.mjs [--force]
 *   node scripts/seed-marketplace/generate-assets.mjs --supplement [--only cat1,cat2] [--dry-run]
 *
 * PEXELS_API_KEY is read from <repo>/.env (or the environment) and is never printed or written anywhere.
 * `sharp` is resolved from backend/services/<svc>/node_modules.
 * Re-running without flags is a no-op when manifest.json exists.
 * --supplement keeps all existing files/IDs intact and appends new candidates toward C7 quotas.
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

// Keep total <= 15 MB so world.test.mjs assets size check passes without altering existing files.
const MAX_TOTAL_BYTES = 14.8 * 1024 * 1024;
const MAX_API_REQUESTS_PER_HOUR = 180;
const HARD_MAX_FILE_BYTES = 60 * 1024;
const LEGACY_WIDTH = 800;
const LEGACY_WEBP_QUALITY = 70;
const ATTRIBUTION_FOOTER_MARKER = "\n---\n";

// Initial batch spec preserved for compatibility (--force mode)
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

/**
 * Target usable non-rejected totals (with ~8-15% candidate buffer for post-download visual audit):
 * - Gym: >= 440 across all 12 C7 categories
 * - PT/physique: >= 625 (~50% MALE / ~50% FEMALE) across fitness model, athlete, sports portrait & coach scenes
 */
export const SUPPLEMENT_PLAN = [
  {
    category: "gym-interior",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 88,
    queries: ["gym interior equipment", "modern health club workout room", "commercial fitness floor machines"],
  },
  {
    category: "fitness-center",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 68,
    queries: ["fitness center training", "group fitness class studio", "athletic gym training club"],
  },
  {
    category: "free-weights",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 63,
    queries: ["weight room dumbbells", "barbell squat rack powerlifting gym", "kettlebells dumbbell rack"],
  },
  {
    category: "cardio",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 43,
    queries: ["treadmill gym cardio", "indoor cycling spin studio bikes", "rowing machine elliptical gym"],
  },
  {
    category: "crossfit",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 38,
    queries: ["crossfit box gym", "crossfit barbell rig workout", "functional fitness warehouse gym"],
  },
  {
    category: "functional",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 38,
    queries: ["functional training gym", "battle ropes turf gym workout", "kettlebell trx training area"],
  },
  {
    category: "yoga-studio",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 38,
    queries: ["yoga studio room", "pilates reformer studio class", "stretching studio wood floor mats"],
  },
  {
    category: "boxing",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 33,
    queries: ["boxing gym punching bag", "muay thai boxing ring gym", "heavy bags combat sports gym"],
  },
  {
    category: "exterior",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 25,
    queries: ["modern fitness center building exterior", "sports club architecture entrance", "commercial glass gym building facade"],
  },
  {
    category: "pool",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 17,
    queries: ["indoor lap swimming pool fitness", "indoor olympic swimming pool lanes"],
  },
  {
    category: "locker-room",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 13,
    queries: ["modern gym locker room bench", "sports club changing lockers interior"],
  },
  {
    category: "reception",
    kind: "gym",
    orientation: "landscape",
    targetUsable: 11,
    queries: ["modern fitness club reception lobby", "gym studio front desk concierge"],
  },
  {
    category: "physique-men",
    kind: "physique",
    orientation: "portrait",
    targetUsable: 250,
    queries: [
      "male fitness model gym portrait",
      "athletic man workout portrait",
      "man runner sprinter sport portrait",
      "male swimmer athlete portrait",
      "man calisthenics gym workout",
    ],
  },
  {
    category: "physique-bodybuilder",
    kind: "physique",
    orientation: "portrait",
    targetUsable: 88,
    queries: [
      "male bodybuilder gym posing",
      "female muscular fitness athlete gym",
      "muscular man weight training gym",
      "woman strength athlete lifting gym",
    ],
  },
  {
    category: "physique-women",
    kind: "physique",
    orientation: "portrait",
    targetUsable: 262,
    queries: [
      "woman fitness athlete gym portrait",
      "female fitness model sportswear portrait",
      "woman runner track athlete portrait",
      "female yogi pilates athletic portrait",
      "sporty woman dumbbell gym workout",
    ],
  },
  {
    category: "physique-trainer",
    kind: "physique",
    orientation: "portrait",
    targetUsable: 66,
    queries: [
      "male personal trainer portrait gym",
      "female fitness coach portrait gym",
      "man fitness instructor standing gym",
      "woman pilates coach studio portrait",
    ],
  },
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

const BAD_ALT = /\b(celebrity|logo|watermark|poster|billboard|meme|nude|naked|kid|child|baby|toddler|cartoon|illustration|3d render|vector)\b/i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, opts = {}, { retries = 4, label = "http" } = {}) {
  let delayMs = 2000;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, opts);
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      if (attempt === retries) throw new Error(`${label} failed after retries: HTTP ${res.status}`);
      const retryAfterSec = Number(res.headers.get("retry-after") || "0");
      const waitMs = Math.max(delayMs, retryAfterSec * 1000);
      console.warn(`[assets] ${label} HTTP ${res.status}; backing off ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(waitMs);
      delayMs *= 2;
      continue;
    }
    return res;
  }
  throw new Error(`${label} unreachable`);
}

async function encodeWebpCompact(sharp, inputBuffer, orientation, { legacy = false } = {}) {
  if (legacy) {
    const pipeline =
      orientation === "portrait"
        ? sharp(inputBuffer).rotate().resize({ width: LEGACY_WIDTH, height: Math.round(LEGACY_WIDTH * 1.25), fit: "cover", position: "attention" })
        : sharp(inputBuffer).rotate().resize({ width: LEGACY_WIDTH, withoutEnlargement: true });
    return pipeline.webp({ quality: LEGACY_WEBP_QUALITY }).toBuffer();
  }

  // Adaptive compact WebP encoding: stays visually crisp (<= 380px bounding box, effort 6),
  // <= 60 KB hard cap, and ~6 KB average so ~1,130 photos fit comfortably under world.test.mjs 15 MB limit.
  const ladder = [
    { maxDim: 380, quality: 44 },
    { maxDim: 350, quality: 38 },
    { maxDim: 320, quality: 34 },
    { maxDim: 290, quality: 30 },
  ];
  let out = null;
  for (const step of ladder) {
    const resized =
      orientation === "portrait"
        ? sharp(inputBuffer).rotate().resize({ width: step.maxDim, height: Math.round(step.maxDim * 1.25), fit: "cover", position: "attention" })
        : sharp(inputBuffer).rotate().resize({ width: step.maxDim, height: step.maxDim, fit: "inside", withoutEnlargement: true });
    out = await resized.webp({ quality: step.quality, effort: 6, smartSubsample: true }).toBuffer();
    if (out.length <= 6800) break;
  }
  if (out.length > HARD_MAX_FILE_BYTES) {
    throw new Error(`Encoded webp exceeded 60 KB cap (${out.length} B)`);
  }
  return out;
}

function writeAttributionFile(items, previousFooter = "") {
  const header =
    "# Photo attribution\n\nPhotos provided by [Pexels](https://www.pexels.com). Each file's photographer and source link is listed in `manifest.json`.\n\n";
  const body = items.map((i) => `- ${i.file} - ${i.photographer} (${i.sourceUrl})`).join("\n") + "\n";
  fs.writeFileSync(path.join(assetsDir, "ATTRIBUTION.md"), header + body + previousFooter, "utf8");
}

function readExistingAttributionFooter() {
  const attrPath = path.join(assetsDir, "ATTRIBUTION.md");
  if (!fs.existsSync(attrPath)) return "";
  const raw = fs.readFileSync(attrPath, "utf8");
  const idx = raw.indexOf(ATTRIBUTION_FOOTER_MARKER);
  return idx >= 0 ? raw.slice(idx) : "";
}

function parsePexelsId(itemId) {
  const m = String(itemId || "").match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

async function runLegacyForce(key, sharp, manifestPath) {
  for (const sub of ["gym", "physique"]) fs.rmSync(path.join(assetsDir, sub), { recursive: true, force: true });
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
      const res = await fetchWithRetry(url, { headers: { Authorization: key } }, { label: `pexels-search(${query})` });
      if (!res.ok) throw new Error(`Pexels search "${query}" failed: HTTP ${res.status}`);
      const json = await res.json();
      for (const ph of json.photos ?? []) {
        if (got >= want) break;
        if (seenPexelsIds.has(ph.id)) continue;
        if (BAD_ALT.test(ph.alt ?? "")) continue;
        if (ph.width < 1000 || ph.height < 700) continue;
        const src = ph.src?.medium ?? ph.src?.large;
        if (!src) continue;
        const img = await fetchWithRetry(src, {}, { label: `pexels-cdn(${ph.id})` });
        if (!img.ok) continue;
        const input = Buffer.from(await img.arrayBuffer());
        const out = await encodeWebpCompact(sharp, input, orientation, { legacy: true });
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
    processing: `resized to ${LEGACY_WIDTH}px wide webp q${LEGACY_WEBP_QUALITY}`,
    totalBytes: total,
    count: items.length,
    items,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  writeAttributionFile(items);
  console.log(`[assets] done: ${items.length} files, ${(total / 1048576).toFixed(2)} MB`);
}

function effectiveCategoryCount(items, category) {
  let n = 0;
  for (const it of items) {
    if (it.audit?.status === "REJECTED") continue;
    const eff = it.audit?.reclassifiedCategory || it.category;
    if (eff === category) n++;
  }
  return n;
}

async function runSupplement(key, sharp, manifestPath, { onlyCategories = null, dryRun = false } = {}) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error("manifest.json missing; run initial asset generation first before --supplement.");
  }
  const existingManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const existingFooter = readExistingAttributionFooter();
  const items = [...(existingManifest.items ?? [])];
  for (const sub of ["gym", "physique"]) fs.mkdirSync(path.join(assetsDir, sub), { recursive: true });

  const seenPexelsIds = new Set();
  const seenHashes = new Set();
  let total = 0;
  for (const it of items) {
    const pid = parsePexelsId(it.id);
    if (pid) seenPexelsIds.add(pid);
    if (it.sha256) seenHashes.add(it.sha256);
    total += Number(it.bytes || 0);
  }

  const plan = SUPPLEMENT_PLAN.filter((p) => !onlyCategories || onlyCategories.has(p.category));
  let apiRequests = 0;
  let added = 0;
  let budgetHit = false;

  console.log(`[assets:supplement] starting with ${items.length} existing items (${(total / 1048576).toFixed(2)} MB)`);

  for (const spec of plan) {
    const currentUsable = effectiveCategoryCount(items, spec.category);
    let need = Math.max(0, spec.targetUsable - currentUsable);
    if (need === 0) {
      console.log(`[assets:supplement] ${spec.category}: ${currentUsable}/${spec.targetUsable} (already satisfied)`);
      continue;
    }
    if (dryRun) {
      console.log(`[assets:supplement:dry-run] ${spec.category}: usable=${currentUsable} target=${spec.targetUsable} need=${need}`);
      continue;
    }

    let got = 0;
    const queryPages = spec.queries.map((q) => ({ q, page: 1, exhausted: false }));
    const perQueryCap = Math.max(4, Math.ceil(need / spec.queries.length));
    const perQueryGot = new Array(spec.queries.length).fill(0);

    for (let round = 0; round < 3 && got < need && !budgetHit; round++) {
      let progress = false;
      for (let qi = 0; qi < queryPages.length && got < need && !budgetHit; qi++) {
        const qp = queryPages[qi];
        if (qp.exhausted) continue;
        // Round 0 balances across all queries fairly; later rounds top up any remaining deficit.
        const maxForQueryThisRound = round === 0 ? perQueryGot[qi] + perQueryCap : Infinity;
        if (round === 0 && perQueryGot[qi] >= perQueryCap) continue;

        if (apiRequests >= MAX_API_REQUESTS_PER_HOUR) {
          throw new Error(`API rate cap reached (${apiRequests}/${MAX_API_REQUESTS_PER_HOUR} requests). Pause before resuming.`);
        }
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(qp.q)}&per_page=80&page=${qp.page}&orientation=${spec.orientation}&size=medium`;
        apiRequests++;
        const res = await fetchWithRetry(url, { headers: { Authorization: key } }, { label: `pexels-search(${qp.q})` });
        if (!res.ok) throw new Error(`Pexels search "${qp.q}" failed: HTTP ${res.status}`);
        const json = await res.json();
        await sleep(250);

        const photos = json.photos ?? [];
        if (photos.length < 80) qp.exhausted = true;
        qp.page++;

        for (const ph of photos) {
          if (got >= need || perQueryGot[qi] >= maxForQueryThisRound) break;
          if (seenPexelsIds.has(ph.id)) continue;
          if (BAD_ALT.test(ph.alt ?? "")) continue;
          if (ph.width < 1000 || ph.height < 700) continue;
          const src = ph.src?.medium ?? ph.src?.large;
          if (!src) continue;
          const img = await fetchWithRetry(src, {}, { label: `pexels-cdn(${ph.id})` });
          if (!img.ok) continue;
          const input = Buffer.from(await img.arrayBuffer());
          const out = await encodeWebpCompact(sharp, input, spec.orientation, { legacy: false });
          const hash = createHash("sha256").update(out).digest("hex");
          if (seenHashes.has(hash)) continue;
          if (total + out.length > MAX_TOTAL_BYTES) {
            console.warn(`[assets:supplement] size budget reached at ${(total / 1048576).toFixed(2)} MB - stopping.`);
            budgetHit = true;
            break;
          }
          const file = `${spec.kind}/${spec.category}-${String(ph.id)}.webp`;
          const diskPath = path.join(assetsDir, file);
          if (fs.existsSync(diskPath)) continue;
          fs.writeFileSync(diskPath, out);
          seenPexelsIds.add(ph.id);
          seenHashes.add(hash);
          total += out.length;
          got++;
          perQueryGot[qi]++;
          added++;
          progress = true;
          items.push({
            id: `pexels-${ph.id}`,
            file,
            kind: spec.kind,
            category: spec.category,
            photographer: ph.photographer,
            photographerUrl: ph.photographer_url,
            sourceUrl: ph.url,
            alt: ph.alt ?? "",
            bytes: out.length,
            sha256: hash,
            supplementBatch: "s0-bo-sung",
          });
        }
      }
      if (!progress) break;
    }
    console.log(`[assets:supplement] ${spec.category}: +${got}/${need} new (now usable/raw-added=${currentUsable + got})`);
  }

  if (dryRun) {
    console.log(`[assets:supplement:dry-run] complete.`);
    return;
  }

  items.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const updatedManifest = {
    ...existingManifest,
    supplementedAt: new Date().toISOString(),
    processing: `${existingManifest.processing || "800px webp q70"}; s0-bo-sung compact <=380px webp (each <=60KB, total <=15MB)`,
    totalBytes: total,
    count: items.length,
    items,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(updatedManifest, null, 2) + "\n", "utf8");
  writeAttributionFile(items, existingFooter);
  console.log(
    `[assets:supplement] done: +${added} new files (total ${items.length} files, ${(total / 1048576).toFixed(2)} MB, apiRequests=${apiRequests}/${MAX_API_REQUESTS_PER_HOUR})`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const supplement = args.includes("--supplement");
  const dryRun = args.includes("--dry-run");
  const onlyIdx = args.indexOf("--only");
  const onlyCategories =
    onlyIdx >= 0 && args[onlyIdx + 1]
      ? new Set(args[onlyIdx + 1].split(",").map((s) => s.trim()).filter(Boolean))
      : null;

  const manifestPath = path.join(assetsDir, "manifest.json");
  if (!force && !supplement && fs.existsSync(manifestPath)) {
    console.log("[assets] manifest.json already exists - nothing to do (use --supplement to add photos, or --force to regenerate).");
    return;
  }
  const key = loadKey();
  if (!key) throw new Error("PEXELS_API_KEY missing (put it in .env). The key is never printed.");
  const sharp = loadSharp();

  if (supplement) {
    await runSupplement(key, sharp, manifestPath, { onlyCategories, dryRun });
  } else {
    await runLegacyForce(key, sharp, manifestPath);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("[assets] FAILED:", e.message);
    process.exit(1);
  });
}
