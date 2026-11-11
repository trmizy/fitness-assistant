// Deterministic ward-level geo sampler backed by prepare-geo.mjs output (vietnam_ward_geo.json + optional .runtime/geo/ polygons).
// Never touches network at runtime; enforces Turf double point-in-polygon (ward + province) whenever runtime polygons are loaded.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
const _bpip = req(path.join(here, "..", "tools", "node_modules", "@turf", "boolean-point-in-polygon"));
const booleanPointInPolygon = _bpip.default ?? _bpip;

export const DEFAULT_WARD_GEO_PATH = path.join(here, "..", "data", "geo", "vietnam_ward_geo.json");
export const DEFAULT_RUNTIME_GEO_DIR = path.join(here, "..", ".runtime", "geo");

let _geoCache = null;
let _polyCache = null;

export function resetGeoSamplerCache() {
  _geoCache = null;
  _polyCache = null;
}

function makeSeededRng(seedInput) {
  const s = String(seedInput ?? "gymini-geo");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let state = h >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveRng(rngOrSeed) {
  if (typeof rngOrSeed === "function") return rngOrSeed;
  return makeSeededRng(rngOrSeed);
}

/** Loads vietnam_ward_geo.json and builds O(1) ward & province lookup maps. */
export function loadWardGeo(dataPath = DEFAULT_WARD_GEO_PATH) {
  if (_geoCache && _geoCache.dataPath === dataPath) return _geoCache;
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Missing ${dataPath}. Run prepare-geo.mjs first.`);
  }
  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const byWardCode = new Map();
  const byGisWardCode = new Map();
  const byProvinceCode = new Map();

  for (const w of raw.wards) {
    byWardCode.set(Number(w.wardCode), w);
    if (w.gisWardCode) byGisWardCode.set(String(w.gisWardCode), w);
    const pList = byProvinceCode.get(Number(w.provinceCode)) ?? [];
    pList.push(w);
    byProvinceCode.set(Number(w.provinceCode), pList);
  }

  _geoCache = {
    dataPath,
    meta: {
      source: raw.source,
      gisTag: raw.gisTag,
      osmExtractTimestamp: raw.osmExtractTimestamp,
      provinceCount: raw.provinceCount,
      wardCount: raw.wardCount,
    },
    wards: raw.wards,
    byWardCode,
    byGisWardCode,
    byProvinceCode,
  };
  return _geoCache;
}

/** Loads optional derived runtime polygons (.runtime/geo/ward_polygons.json + province_polygons.json) when available. */
export function loadRuntimePolygons(runtimeDir = DEFAULT_RUNTIME_GEO_DIR) {
  if (_polyCache && _polyCache.runtimeDir === runtimeDir) return _polyCache;
  const wardFile = path.join(runtimeDir, "ward_polygons.json");
  const provFile = path.join(runtimeDir, "province_polygons.json");
  if (!fs.existsSync(wardFile) || !fs.existsSync(provFile)) {
    _polyCache = { runtimeDir, available: false, wards: null, provinces: null };
    return _polyCache;
  }
  const wards = JSON.parse(fs.readFileSync(wardFile, "utf8"));
  const provinces = JSON.parse(fs.readFileSync(provFile, "utf8"));
  _polyCache = { runtimeDir, available: true, wards, provinces };
  return _polyCache;
}

/** Looks up a ward record by numeric code (e.g. 4, 26740) or padded GIS string code ("00004"). */
export function getWardGeo(wardCode, dataPath = DEFAULT_WARD_GEO_PATH) {
  const index = loadWardGeo(dataPath);
  const str = String(wardCode ?? "").trim();
  const num = Number(str);
  return index.byWardCode.get(num) ?? index.byGisWardCode.get(str) ?? null;
}

/** Double Turf point-in-polygon check (inside BOTH ward polygon AND parent province polygon). */
export function isPointInWardAndProvince(lng, lat, wardCode, opts = {}) {
  const polys = loadRuntimePolygons(opts.runtimeDir ?? DEFAULT_RUNTIME_GEO_DIR);
  if (!polys.available) {
    throw new Error(`Runtime polygons not found in ${polys.runtimeDir}; run prepare-geo.mjs first.`);
  }
  const ward = getWardGeo(wardCode, opts.dataPath);
  if (!ward) return false;
  const wPoly = polys.wards[String(ward.wardCode)];
  const pPoly = polys.provinces[String(ward.provinceCode)];
  if (!wPoly?.feature || !pPoly?.feature) return false;
  const pt = { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} };
  return booleanPointInPolygon(pt, wPoly.feature) && booleanPointInPolygon(pt, pPoly.feature);
}

/**
 * Samples a verified point inside a ward using pre-validated land/building/road anchors
 * with optional micro-jitter validated via Turf double PIP when runtime polygons are present.
 */
export function samplePointInWard(wardCode, rngOrSeed, opts = {}) {
  const ward = getWardGeo(wardCode, opts.dataPath);
  if (!ward) throw new Error(`geo-sampler: unknown wardCode "${wardCode}"`);
  const rng = resolveRng(rngOrSeed);
  const anchors = Array.isArray(ward.anchors) && ward.anchors.length
    ? ward.anchors
    : [{ lat: ward.centroidLat, lng: ward.centroidLng, src: ward.pointSource }];

  const anchor = anchors[Math.floor(rng() * anchors.length)];
  const polys = loadRuntimePolygons(opts.runtimeDir ?? DEFAULT_RUNTIME_GEO_DIR);
  const canVerifyLivePip = polys.available && Boolean(polys.wards[String(ward.wardCode)]);

  // Tiny footprint micro-jitter (~3.5m) avoids riverbank hop while giving distinct pins
  const defaultJitter = ward.urbanClass === "urban" ? 0.00003 : 0.00003;
  const maxJitterDeg = opts.maxJitterDeg ?? (canVerifyLivePip ? defaultJitter : 0);

  let lat = anchor.lat;
  let lng = anchor.lng;

  if (maxJitterDeg > 0 && !String(anchor.src).startsWith("fallback_")) {
    const attempts = canVerifyLivePip ? 8 : 1;
    for (let i = 0; i < attempts; i++) {
      const candLat = Number((anchor.lat + (rng() - 0.5) * 2 * maxJitterDeg).toFixed(6));
      const candLng = Number((anchor.lng + (rng() - 0.5) * 2 * maxJitterDeg).toFixed(6));
      if (!canVerifyLivePip || isPointInWardAndProvince(candLng, candLat, ward.wardCode, opts)) {
        lat = candLat;
        lng = candLng;
        break;
      }
    }
  }

  return {
    wardCode: ward.wardCode,
    provinceCode: ward.provinceCode,
    wardName: ward.wardName,
    provinceName: ward.provinceName,
    urbanClass: ward.urbanClass,
    pointSource: anchor.src,
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lng.toFixed(6)),
  };
}

/** Builds a stratified sample set across urban, rural, mountainous, and special island wards for map verification. */
export function sampleStratifiedPoints(count = 300, seed = "s0-verify-300", opts = {}) {
  const { wards } = loadWardGeo(opts.dataPath);
  const rng = makeSeededRng(seed);
  const urban = wards.filter((w) => w.urbanClass === "urban");
  const rural = wards.filter((w) => w.urbanClass === "rural");
  const islandOrFallback = wards.filter((w) => String(w.divisionType).toLowerCase() === "đặc khu" || String(w.pointSource).startsWith("fallback_"));

  const pickedWards = [];
  const used = new Set();

  // Include all island/đặc khu & fallback wards first (up to ~35) so edge cases are audited thoroughly
  for (const w of islandOrFallback) {
    if (pickedWards.length >= Math.min(35, Math.floor(count * 0.15))) break;
    used.add(w.wardCode);
    pickedWards.push(w);
  }

  const targetUrban = Math.floor(count * 0.45);
  let urbanAdded = 0;
  let guard = 0;
  while (urbanAdded < targetUrban && pickedWards.length < count && guard++ < count * 20) {
    const w = urban[Math.floor(rng() * urban.length)];
    if (!w || used.has(w.wardCode)) continue;
    used.add(w.wardCode);
    pickedWards.push(w);
    urbanAdded++;
  }

  guard = 0;
  while (pickedWards.length < count && guard++ < count * 20) {
    const w = rural[Math.floor(rng() * rural.length)];
    if (!w || used.has(w.wardCode)) continue;
    used.add(w.wardCode);
    pickedWards.push(w);
  }

  return pickedWards.map((w, idx) => samplePointInWard(w.wardCode, `${seed}:${w.wardCode}:${idx}`, opts));
}

