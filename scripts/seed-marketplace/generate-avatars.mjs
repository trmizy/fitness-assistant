// Offline deterministic avatar generator using CC0 DiceBear styles (lorelei, notionists, open-peeps) + Sharp (256x256 WebP).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function loadTools() {
  const toolsNm = path.join(here, "tools", "node_modules");
  const corePath = pathToFileURL(path.join(toolsNm, "@dicebear", "core", "lib", "index.js")).href;
  const loreleiPath = pathToFileURL(path.join(toolsNm, "@dicebear", "lorelei", "lib", "index.js")).href;
  const notionistsPath = pathToFileURL(path.join(toolsNm, "@dicebear", "notionists", "lib", "index.js")).href;
  const openPeepsPath = pathToFileURL(path.join(toolsNm, "@dicebear", "open-peeps", "lib", "index.js")).href;
  return Promise.all([
    import(corePath),
    import(loreleiPath),
    import(notionistsPath),
    import(openPeepsPath),
  ]);
}

function loadSharp() {
  const candidates = [
    path.join(repoRoot, "backend", "services", "user-service", "node_modules", "sharp"),
    path.join(repoRoot, "backend", "services", "gym-service", "node_modules", "sharp"),
  ];
  const req = createRequire(import.meta.url);
  for (const c of candidates) {
    if (fs.existsSync(c)) return req(c);
  }
  throw new Error("sharp not found in backend/services/{user,gym}-service/node_modules");
}

const sharp = loadSharp();
let _dicebearPromise;
async function getDicebear() {
  if (!_dicebearPromise) _dicebearPromise = loadTools();
  const [core, lorelei, notionists, openPeeps] = await _dicebearPromise;
  return {
    createAvatar: core.createAvatar,
    styles: {
      lorelei,
      notionists,
      "open-peeps": openPeeps,
    },
  };
}

/** CC0-only DiceBear style keys. */
export const AVATAR_STYLES = ["lorelei", "notionists", "open-peeps"];

/**
 * High-contrast light/emerald/lavender/amber background swatches aligned with Gymini palette tokens
 * so dark ink outlines in lorelei / notionists / open-peeps stay legible in both light & dark UI cards.
 */
export const GYMINI_AVATAR_BACKGROUNDS = [
  "dcfce7", // soft emerald tint matching #22c55e
  "d1fae5", // emerald-100 matching #10b981 / #059669
  "ede9fe", // soft violet matching #a78bfa
  "fef3c7", // soft amber matching #f59e0b
  "f1f5f9", // light zinc/slate (#f1f5f9 from theme.css)
  "e0f2fe", // clean sky tint
];

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Picks deterministic style & background swatch from id while keeping opts overrides explicit. */
export function resolveAvatarOptions(id, opts = {}) {
  const key = String(id ?? "");
  const h = fnv1a(key);
  const style = opts.style && AVATAR_STYLES.includes(opts.style)
    ? opts.style
    : AVATAR_STYLES[h % AVATAR_STYLES.length];
  const bg = opts.backgroundColor ?? [GYMINI_AVATAR_BACKGROUNDS[(h >>> 4) % GYMINI_AVATAR_BACKGROUNDS.length]];
  const size = Number.isFinite(opts.size) ? opts.size : 256;
  const seed = String(opts.seed ?? key);
  return { style, backgroundColor: Array.isArray(bg) ? bg : [String(bg).replace(/^#/, "")], size, seed };
}

/**
 * Generates a deterministic 256x256 WebP avatar buffer for a user/PT/owner/client id.
 * Completely offline, CC0 style-locked, and stable across repeated calls.
 */
export async function generateAvatarBuffer(id, opts = {}) {
  if (id === undefined || id === null || String(id).trim() === "") {
    throw new Error("generateAvatarBuffer requires a non-empty id");
  }
  const { createAvatar, styles } = await getDicebear();
  const resolved = resolveAvatarOptions(id, opts);
  const styleModule = styles[resolved.style];
  const avatar = createAvatar(styleModule, {
    seed: resolved.seed,
    size: resolved.size,
    backgroundColor: resolved.backgroundColor,
    radius: opts.radius ?? 0,
  });
  const svg = avatar.toString();
  return sharp(Buffer.from(svg, "utf8"))
    .resize(resolved.size, resolved.size, { fit: "cover" })
    .webp({ quality: opts.quality ?? 85, effort: 4 })
    .toBuffer();
}

/** Generates 24 sample avatars (8 per CC0 style) into .runtime/avatars/ and optional contact sheet WebP. */
export async function generateSampleBatch({
  outDir = path.join(here, ".runtime", "avatars"),
  sheetPath = path.resolve(repoRoot, "_warroom", "evidence", "discovery-scale", "avatars-sample.webp"),
  perStyle = 8,
} = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const samples = [];
  for (const style of AVATAR_STYLES) {
    for (let i = 1; i <= perStyle; i++) {
      const id = `gymini-${style}-${String(i).padStart(2, "0")}`;
      const buf = await generateAvatarBuffer(id, { style, size: 256 });
      const fileName = `${id}.webp`;
      const outPath = path.join(outDir, fileName);
      fs.writeFileSync(outPath, buf);
      samples.push({
        id,
        style,
        file: outPath,
        bytes: buf.length,
        sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      });
    }
  }

  if (sheetPath) {
    fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
    const cols = perStyle;
    const rows = AVATAR_STYLES.length;
    const tile = 160;
    const gap = 12;
    const labelH = 26;
    const pad = 20;
    const width = pad * 2 + cols * tile + (cols - 1) * gap;
    const height = pad * 2 + rows * (tile + labelH) + (rows - 1) * gap + 44;

    const composites = [];
    // Header + row labels rendered via SVG
    const svgTexts = [
      `<text x="${pad}" y="30" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#f8fafc">Gymini Seed Avatars Sample (24 = 8 x 3 CC0 DiceBear Styles, 256x256 WebP)</text>`,
    ];
    for (let r = 0; r < rows; r++) {
      const style = AVATAR_STYLES[r];
      const yBase = pad + 44 + r * (tile + labelH + gap);
      svgTexts.push(
        `<text x="${pad}" y="${yBase + 16}" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#22c55e">${style} (CC0)</text>`
      );
      for (let c = 0; c < cols; c++) {
        const s = samples[r * cols + c];
        const x = pad + c * (tile + gap);
        const y = yBase + labelH;
        const resized = await sharp(s.file).resize(tile, tile).png().toBuffer();
        composites.push({ input: resized, left: x, top: y });
      }
    }

    const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#0a0a0a"/>
      ${svgTexts.join("\n")}
    </svg>`;
    await sharp(Buffer.from(bgSvg, "utf8"))
      .composite(composites)
      .webp({ quality: 88 })
      .toFile(sheetPath);
  }

  return { samples, sheetPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const result = await generateSampleBatch();
  console.log(`Generated ${result.samples.length} sample avatars in .runtime/avatars/`);
  console.log(`Contact sheet saved to ${result.sheetPath}`);
}

