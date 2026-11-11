// Prepares OSM valid-location masks + GIS v5.2.0 verified boundaries -> compact vietnam_ward_geo.json (no polygons) + .runtime/geo/.
// Streams OSM .geojsonl layers produced by osmium-tool, enforces water exclusion, accepts unnamed roads,
// provides verified fallbacks, classifies urban/rural, and performs Turf double PIP (ward + province).
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_CACHE_DIR, verifyGisDataset } from "./verify-gis.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const req = createRequire(import.meta.url);

const _bbox = req(path.join(here, "tools", "node_modules", "@turf", "bbox"));
const bbox = _bbox.default ?? _bbox;
const _bpip = req(path.join(here, "tools", "node_modules", "@turf", "boolean-point-in-polygon"));
const booleanPointInPolygon = _bpip.default ?? _bpip;
const _p2ld = req(path.join(here, "tools", "node_modules", "@turf", "point-to-line-distance"));
const pointToLineDistance = _p2ld.default ?? _p2ld;
const _polylabel = req(path.join(here, "tools", "node_modules", "polylabel"));
const polylabel = typeof _polylabel === "function" ? _polylabel : (_polylabel.default?.default ?? _polylabel.default);
const _RBush = req(path.join(here, "tools", "node_modules", "rbush"));
const RBush = _RBush.default ?? _RBush;

export const OUTPUT_GEO_JSON = path.join(here, "data", "geo", "vietnam_ward_geo.json");
export const RUNTIME_GEO_DIR = path.join(here, ".runtime", "geo");

const OSM_EXTRACT_TIMESTAMP = "2026-11-09T21:22:17Z";
const SOURCE_TAG = "thanglequoc/vietnamese-provinces-database@v5.2.0 (MIT) + OSM Vietnam 2026-11-09 (ODbL)";

const EXCLUDED_HIGHWAYS = new Set([
  "footway",
  "steps",
  "cycleway",
  "bridleway",
  "proposed",
  "construction",
  "abandoned",
  "corridor",
  "elevator",
  "raceway",
]);

function isWaterPolygonProps(props = {}) {
  if (props.place === "island" || props.natural === "land" || props.natural === "coastline") return false;
  return (
    props.natural === "water" ||
    Boolean(props.water) ||
    ["riverbank", "dock", "canal"].includes(props.waterway) ||
    ["reservoir", "basin"].includes(props.landuse)
  );
}

function makePt(lng, lat) {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} };
}

function largestPolygonRings(geom) {
  if (!geom?.coordinates?.length) return null;
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") {
    let best = geom.coordinates[0];
    let bestScore = -1;
    for (const poly of geom.coordinates) {
      const ring = poly?.[0];
      if (!ring?.length) continue;
      // Approximate area by bbox span * vertex count
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      const areaApprox = (maxX - minX) * (maxY - minY);
      if (areaApprox > bestScore) {
        bestScore = areaApprox;
        best = poly;
      }
    }
    return best;
  }
  return null;
}

function quickRingBbox(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of ring) {
    const x = pt[0], y = pt[1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function geomBbox(geom) {
  if (!geom?.coordinates) return null;
  if (geom.type === "Point") {
    const [x, y] = geom.coordinates;
    return [x, y, x, y];
  }
  if (geom.type === "LineString") return quickRingBbox(geom.coordinates);
  if (geom.type === "Polygon") return quickRingBbox(geom.coordinates[0]);
  if (geom.type === "MultiPolygon") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of geom.coordinates) {
      if (!poly?.[0]?.length) continue;
      const [a, b, c, d] = quickRingBbox(poly[0]);
      if (a < minX) minX = a;
      if (b < minY) minY = b;
      if (c > maxX) maxX = c;
      if (d > maxY) maxY = d;
    }
    return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
  }
  return bbox(geom);
}

async function streamGeojsonSeq(filePath, onFeature) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 }),
    crlfDelay: Infinity,
  });
  let count = 0;
  for await (const rawLine of rl) {
    const line = rawLine.charCodeAt(0) === 0x1e ? rawLine.slice(1) : rawLine;
    if (!line.trim()) continue;
    count++;
    let feat;
    try {
      feat = JSON.parse(line);
    } catch {
      continue;
    }
    if (feat?.geometry) onFeature(feat);
  }
  return count;
}

/** Deterministic spatial grid sampler up to `cap` per bucket so candidates cover the full ward footprint. */
function pushBucketed(bucket, lng, lat, extra, cap = 48) {
  const gridScale = 1200; // ~90m spatial cell
  const cell = `${Math.floor(lng * gridScale)}:${Math.floor(lat * gridScale)}`;
  if (bucket.seenCells.has(cell)) return false;
  bucket.seenCells.add(cell);
  if (bucket.items.length < cap) {
    bucket.items.push({ lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)), ...extra });
    return true;
  }
  // Reservoir replace deterministically on overflow to keep spatial diversity across large rural wards
  const idx = bucket.seenCells.size % cap;
  if ((bucket.seenCells.size * 2654435761) % 7 === 0) {
    bucket.items[idx] = { lng: Number(lng.toFixed(6)), lat: Number(lat.toFixed(6)), ...extra };
  }
  return true;
}

function computePolygonSeedPoints(feat) {
  const geom = feat.geometry;
  if (geom.type === "Polygon") {
    const ring = geom.coordinates?.[0];
    if (!ring?.length) return [];
    const [minX, minY, maxX, maxY] = quickRingBbox(ring);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    if (booleanPointInPolygon(makePt(cx, cy), feat)) return [[cx, cy]];
    try {
      const [px, py] = polylabel(geom.coordinates, Math.max(0.0001, (maxX - minX) / 20));
      if (booleanPointInPolygon(makePt(px, py), feat)) return [[px, py]];
    } catch {
      // fall through to vertex midpoint
    }
    return [ring[0]];
  }
  if (geom.type === "MultiPolygon") {
    const pts = [];
    for (const poly of geom.coordinates.slice(0, 6)) {
      const ring = poly?.[0];
      if (!ring?.length) continue;
      const [minX, minY, maxX, maxY] = quickRingBbox(ring);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const subFeat = { type: "Feature", geometry: { type: "Polygon", coordinates: poly }, properties: {} };
      if (booleanPointInPolygon(makePt(cx, cy), subFeat)) {
        pts.push([cx, cy]);
      } else {
        try {
          const [px, py] = polylabel(poly, Math.max(0.0001, (maxX - minX) / 20));
          pts.push([px, py]);
        } catch {
          pts.push(ring[0]);
        }
      }
    }
    return pts;
  }
  return [];
}

function classifyUrbanRural(ward, stats) {
  const div = String(ward.divisionType || "").toLowerCase();
  if (div === "phường") return "urban";
  const area = Math.max(0.5, Number(ward.areaKm2) || 10);
  const density = (stats.buildingCount + stats.landuseCount * 8) / area;
  // Dense peri-urban communes / towns with very high mapped building+landuse density
  if (density >= 120 && stats.buildingCount >= 800) return "urban";
  return "rural";
}

export async function runPrepareGeo({ cacheDir = DEFAULT_CACHE_DIR } = {}) {
  const t0 = Date.now();
  console.log("[1/6] Verifying GIS v5.2.0 34 provinces / 3,321 wards against vietnam_provinces.json...");
  const gis = verifyGisDataset({ cacheDir });
  if (!gis.ok) {
    throw new Error(`GIS code/name verification failed: ${JSON.stringify({ provErrors: gis.provErrors, wardErrors: gis.wardErrors })}`);
  }
  console.log(`      Verified ${gis.gisProvinceCount} provinces & ${gis.gisWardCount} wards (${gis.prefixWarningsCount} spelling/prefix notes).`);

  // Build spatial index for wards & province lookup
  const wardTree = new RBush();
  const wardStates = new Map();
  const provFeatureByCode = new Map();

  for (const [pCodeStr, gp] of gis.gisProvs) {
    provFeatureByCode.set(pCodeStr, gp.feature);
  }

  const wardTreeItems = [];
  for (const [wCodeStr, gw] of gis.gisWards) {
    const refW = gis.refWardByCode.get(wCodeStr);
    const [minX, minY, maxX, maxY] = gw.bbox;
    wardTreeItems.push({ minX, minY, maxX, maxY, wardCodeStr: wCodeStr });
    const provFeature = provFeatureByCode.get(refW.provinceCodeStr);
    let wardDisjointFromProvPoly = false;
    const lp = largestPolygonRings(gw.feature.geometry);
    if (lp) {
      try {
        const [px, py] = polylabel(lp, 0.0005);
        const pPt = makePt(px, py);
        if (booleanPointInPolygon(pPt, gw.feature) && !booleanPointInPolygon(pPt, provFeature)) {
          wardDisjointFromProvPoly = true;
        }
      } catch {
        // leave false
      }
    }
    wardStates.set(wCodeStr, {
      wardCode: refW.code,
      wardCodeStr: wCodeStr,
      provinceCode: refW.provinceCode,
      provinceCodeStr: refW.provinceCodeStr,
      wardName: refW.name,
      provinceName: refW.provinceName,
      divisionType: refW.division_type,
      areaKm2: gw.props.areaKm2 ?? null,
      bbox: [minX, minY, maxX, maxY],
      wardFeature: gw.feature,
      provFeature,
      wardDisjointFromProvPoly,
      // Candidate buckets
      buildings: { seenCells: new Set(), items: [], totalMatched: 0 },
      landuse: { seenCells: new Set(), items: [], totalMatched: 0 },
      roads: { seenCells: new Set(), items: [], totalMatched: 0, unnamedMatched: 0 },
      places: { seenCells: new Set(), items: [], totalMatched: 0 },
      polylabelPt: null,
      fallbackPts: [],
      waterRejectedCount: 0,
    });
  }
  wardTree.load(wardTreeItems);

  function assignPointToWard(lng, lat, fn) {
    const matches = wardTree.search({ minX: lng, minY: lat, maxX: lng, maxY: lat });
    if (!matches.length) return null;
    const pt = makePt(lng, lat);
    for (const m of matches) {
      const ws = wardStates.get(m.wardCodeStr);
      if (booleanPointInPolygon(pt, ws.wardFeature) && (ws.wardDisjointFromProvPoly || booleanPointInPolygon(pt, ws.provFeature))) {
        fn(ws);
        return ws;
      }
    }
    return null;
  }

  const layersDir = path.join(cacheDir, "osm", "layers");

  // Deduplicate dense cells BEFORE invoking expensive ward polygon PIP when processing millions of OSM objects
  const preCellSeen = {
    landuse: new Set(),
    buildings: new Set(),
    roads: new Set(),
  };

  console.log("[2/6] Streaming OSM places & townhall...");
  const placeTotal = await streamGeojsonSeq(path.join(layersDir, "places.geojsonl"), (feat) => {
    const props = feat.properties || {};
    if (props.amenity !== "townhall" && !props.place) return;
    let ptCoord = null;
    if (feat.geometry.type === "Point") ptCoord = feat.geometry.coordinates;
    else {
      const pts = computePolygonSeedPoints(feat);
      if (pts.length) ptCoord = pts[0];
    }
    if (!ptCoord) return;
    assignPointToWard(ptCoord[0], ptCoord[1], (ws) => {
      ws.places.totalMatched++;
      pushBucketed(ws.places, ptCoord[0], ptCoord[1], { src: "fallback_commune_center", named: Boolean(props.name) }, 16);
    });
  });
  console.log(`      places processed: ${placeTotal} lines`);

  console.log("[3/6] Streaming OSM landuse (residential/commercial/retail/fitness)...");
  const landuseTotal = await streamGeojsonSeq(path.join(layersDir, "landuse.geojsonl"), (feat) => {
    const geom = feat.geometry;
    if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") return;
    const props = feat.properties || {};
    const lu = props.landuse;
    const le = props.leisure;
    if (!["residential", "commercial", "retail"].includes(lu) && !["fitness_centre", "sports_centre"].includes(le)) return;
    const gb = geomBbox(geom);
    if (!gb) return;
    // Generate multiple interior sample points for wide residential landuse polygons
    const seeds = computePolygonSeedPoints(feat);
    const [minX, minY, maxX, maxY] = gb;
    if (maxX - minX > 0.005 || maxY - minY > 0.005) {
      for (let ix = 1; ix <= 3; ix++) {
        for (let iy = 1; iy <= 3; iy++) {
          const sx = minX + ((maxX - minX) * ix) / 4;
          const sy = minY + ((maxY - minY) * iy) / 4;
          if (booleanPointInPolygon(makePt(sx, sy), feat)) seeds.push([sx, sy]);
        }
      }
    }
    let countedWard = false;
    for (const [lng, lat] of seeds) {
      const key = `${Math.floor(lng * 1200)}:${Math.floor(lat * 1200)}`;
      if (preCellSeen.landuse.has(key) && countedWard) continue;
      const hit = assignPointToWard(lng, lat, (ws) => {
        if (!countedWard) {
          ws.landuse.totalMatched++;
          countedWard = true;
        }
        pushBucketed(ws.landuse, lng, lat, { src: "osm_landuse" }, 48);
      });
      if (hit) preCellSeen.landuse.add(key);
    }
  });
  console.log(`      landuse processed: ${landuseTotal} lines`);

  console.log("[4/6] Streaming OSM buildings (with ~60m cell aggregation + Turf double PIP)...");
  let bldMatched = 0;
  const bldCellWard = new Map();
  const buildingsTotal = await streamGeojsonSeq(path.join(layersDir, "buildings.geojsonl"), (feat) => {
    const geom = feat.geometry;
    if (geom.type !== "Polygon" && geom.type !== "MultiPolygon") return;
    const gb = geomBbox(geom);
    if (!gb) return;
    const lng = (gb[0] + gb[2]) / 2;
    const lat = (gb[1] + gb[3]) / 2;
    const cellKey = `${Math.floor(lng * 1800)}:${Math.floor(lat * 1800)}`; // ~60m grid
    const cachedWardCode = bldCellWard.get(cellKey);
    if (cachedWardCode) {
      wardStates.get(cachedWardCode).buildings.totalMatched++;
      bldMatched++;
      return;
    }
    const ws = assignPointToWard(lng, lat, (w) => {
      w.buildings.totalMatched++;
      bldMatched++;
      pushBucketed(w.buildings, lng, lat, { src: "osm_building" }, 48);
    });
    if (ws) bldCellWard.set(cellKey, ws.wardCodeStr);
  });
  bldCellWard.clear();
  console.log(`      buildings processed: ${buildingsTotal} lines (matched: ${bldMatched})`);

  console.log("[5/6] Streaming OSM highways (accepting unnamed rural roads + Turf double PIP)...");
  let roadMatched = 0;
  let roadUnnamed = 0;
  const roadCellWard = new Map();
  const highwayTotal = await streamGeojsonSeq(path.join(layersDir, "highway.geojsonl"), (feat) => {
    const geom = feat.geometry;
    if (geom.type !== "LineString" || !geom.coordinates?.length) return;
    const props = feat.properties || {};
    if (EXCLUDED_HIGHWAYS.has(props.highway)) return;
    const coords = geom.coordinates;
    const isNamed = Boolean(props.name && String(props.name).trim());
    const sampleIdxs = coords.length >= 8
      ? [Math.floor(coords.length * 0.25), Math.floor(coords.length * 0.5), Math.floor(coords.length * 0.75)]
      : [Math.floor(coords.length / 2)];
    for (const idx of sampleIdxs) {
      const [lng, lat] = coords[idx];
      const cellKey = `${Math.floor(lng * 1200)}:${Math.floor(lat * 1200)}`;
      const cachedWardCode = roadCellWard.get(cellKey);
      if (cachedWardCode) {
        const w = wardStates.get(cachedWardCode);
        w.roads.totalMatched++;
        if (!isNamed) w.roads.unnamedMatched++;
        roadMatched++;
        if (!isNamed) roadUnnamed++;
        continue;
      }
      const ws = assignPointToWard(lng, lat, (w) => {
        w.roads.totalMatched++;
        if (!isNamed) w.roads.unnamedMatched++;
        roadMatched++;
        if (!isNamed) roadUnnamed++;
        pushBucketed(w.roads, lng, lat, { src: "osm_road", named: isNamed }, 48);
      });
      if (ws) roadCellWard.set(cellKey, ws.wardCodeStr);
    }
  });
  roadCellWard.clear();
  console.log(`      highways processed: ${highwayTotal} lines (matched samples: ${roadMatched}, unnamed: ${roadUnnamed})`);

  // Compute polylabel center for all 3,321 wards BEFORE water filtering so water filter checks them too
  for (const ws of wardStates.values()) {
    const poly = largestPolygonRings(ws.wardFeature.geometry);
    if (poly) {
      try {
        const [px, py] = polylabel(poly, 0.0005);
        const pt = makePt(px, py);
        if (booleanPointInPolygon(pt, ws.wardFeature) && (ws.wardDisjointFromProvPoly || booleanPointInPolygon(pt, ws.provFeature))) {
          ws.polylabelPt = { lng: Number(px.toFixed(6)), lat: Number(py.toFixed(6)), src: "fallback_polylabel_dry", inWater: false };
        }
      } catch {
        // leave null
      }
    }
  }

  console.log("[6/6] Filtering candidate anchors against OSM natural=water / waterway / reservoir...");
  const allCandidates = [];
  const candTree = new RBush();
  for (const ws of wardStates.values()) {
    for (const bucket of [ws.buildings.items, ws.landuse.items, ws.roads.items, ws.places.items]) {
      for (const item of bucket) {
        item.inWater = false;
        item.nearRiver = false;
        item.wardCodeStr = ws.wardCodeStr;
        allCandidates.push(item);
        candTree.insert({ minX: item.lng, minY: item.lat, maxX: item.lng, maxY: item.lat, ref: item });
      }
    }
    if (ws.polylabelPt) {
      ws.polylabelPt.wardCodeStr = ws.wardCodeStr;
      candTree.insert({
        minX: ws.polylabelPt.lng,
        minY: ws.polylabelPt.lat,
        maxX: ws.polylabelPt.lng,
        maxY: ws.polylabelPt.lat,
        ref: ws.polylabelPt,
      });
    }
  }

  const waterFeatures = []; // kept briefly only for fallback dry scan if a ward needs dry scan
  const waterTree = new RBush();

  const checkWaterPoly = (polyCoords) => {
    if (!polyCoords?.[0]?.length) return;
    const sb = quickRingBbox(polyCoords[0]);
    const hits = candTree.search({ minX: sb[0], minY: sb[1], maxX: sb[2], maxY: sb[3] });
    if (!hits.length && sb[2] - sb[0] <= 0.0002 && sb[3] - sb[1] <= 0.0002) return;
    const polyFeat = { type: "Feature", geometry: { type: "Polygon", coordinates: polyCoords }, properties: {} };
    if (sb[2] - sb[0] > 0.0002 || sb[3] - sb[1] > 0.0002) {
      waterFeatures.push({ minX: sb[0], minY: sb[1], maxX: sb[2], maxY: sb[3], feat: polyFeat });
    }
    for (const h of hits) {
      if (h.ref.inWater) continue;
      if (booleanPointInPolygon(makePt(h.ref.lng, h.ref.lat), polyFeat)) {
        h.ref.inWater = true;
        wardStates.get(h.ref.wardCodeStr).waterRejectedCount++;
      }
    }
  };

  const waterLines = await streamGeojsonSeq(path.join(layersDir, "water.geojsonl"), (feat) => {
    const props = feat.properties || {};
    if (props.bridge === "yes" || props.tunnel === "yes" || props.tunnel === "culvert") return;
    const geom = feat.geometry;
    if (geom.type === "Polygon") {
      if (!isWaterPolygonProps(props)) return;
      checkWaterPoly(geom.coordinates);
    } else if (geom.type === "MultiPolygon") {
      if (!isWaterPolygonProps(props)) return;
      for (const poly of geom.coordinates) checkWaterPoly(poly);
    } else if (geom.type === "LineString" && (props.waterway === "river" || props.waterway === "canal")) {
      const coords = geom.coordinates;
      const pad = 0.00035;
      const gb = quickRingBbox(coords);
      if (!candTree.collides({ minX: gb[0] - pad, minY: gb[1] - pad, maxX: gb[2] + pad, maxY: gb[3] + pad })) return;
      for (let i = 0; i < coords.length - 1; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[i + 1];
        const hits = candTree.search({
          minX: Math.min(x1, x2) - pad,
          minY: Math.min(y1, y2) - pad,
          maxX: Math.max(x1, x2) + pad,
          maxY: Math.max(y1, y2) + pad,
        });
        if (!hits.length) continue;
        const segLine = { type: "Feature", geometry: { type: "LineString", coordinates: [coords[i], coords[i + 1]] }, properties: {} };
        for (const h of hits) {
          if (h.ref.inWater || h.ref.nearRiver || h.ref.src === "osm_building") continue;
          if (pointToLineDistance(makePt(h.ref.lng, h.ref.lat), segLine, { units: "meters" }) < 30) {
            h.ref.nearRiver = true;
            wardStates.get(h.ref.wardCodeStr).waterRejectedCount++;
          }
        }
      }
    }
  });
  waterTree.load(waterFeatures);
  console.log(`      water features scanned: ${waterLines} lines; buffered major water polys for dry scan: ${waterFeatures.length}`);

  function isDryPoint(lng, lat) {
    const hits = waterTree.search({ minX: lng, minY: lat, maxX: lng, maxY: lat });
    if (!hits.length) return true;
    const pt = makePt(lng, lat);
    for (const h of hits) {
      if (booleanPointInPolygon(pt, h.feat)) return false;
    }
    return true;
  }

  // Finalize anchors, fallbacks, centroids, coverage stats, and derived runtime polygons
  const wardsOut = [];
  const runtimePolygons = { type: "FeatureCollection", provinces: {}, wards: {} };
  const coverage = {
    source: SOURCE_TAG,
    osmExtractTimestamp: OSM_EXTRACT_TIMESTAMP,
    generatedAt: new Date().toISOString(),
    totals: {
      provinces: 34,
      wards: 3321,
      urbanWards: 0,
      ruralWards: 0,
      byPrimarySource: {
        osm_building: 0,
        osm_landuse: 0,
        osm_road: 0,
        fallback_commune_center: 0,
        fallback_polylabel_dry: 0,
      },
      wardsWithBuildings: 0,
      wardsWithLanduse: 0,
      wardsWithRoads: 0,
      wardsOnlyUnnamedRoads: 0,
      waterRejectedTotal: 0,
    },
    byProvince: {},
    fallbackOnlyWards: [],
  };

  for (const [pCodeStr, gp] of gis.gisProvs) {
    const pInt = gis.refProvByCode.get(pCodeStr).code;
    runtimePolygons.provinces[pInt] = { bbox: gp.bbox, feature: gp.feature };
  }

  for (const ws of wardStates.values()) {
    const dryBuildings = ws.buildings.items.filter((x) => !x.inWater);
    const dryLanduse = ws.landuse.items.filter((x) => !x.inWater && !x.nearRiver);
    const dryRoads = ws.roads.items.filter((x) => !x.inWater && !x.nearRiver);
    const dryPlaces = ws.places.items.filter((x) => !x.inWater && !x.nearRiver);

    // Combine priority anchors up to 16 verified points per ward
    const anchors = [];
    const seen = new Set();
    const pushUnique = (item, srcOverride) => {
      if (anchors.length >= 16) return;
      const key = `${item.lng.toFixed(5)}:${item.lat.toFixed(5)}`;
      if (seen.has(key)) return;
      seen.add(key);
      anchors.push({
        lat: Number(item.lat.toFixed(6)),
        lng: Number(item.lng.toFixed(6)),
        src: srcOverride ?? item.src,
      });
    };

    // Prioritize residential/buildings/landuse, then add road spread for spatial diversity
    for (const x of dryBuildings) pushUnique(x, "osm_building");
    for (const x of dryLanduse) pushUnique(x, "osm_landuse");
    for (const x of dryRoads) pushUnique(x, "osm_road");
    for (const x of dryPlaces) pushUnique(x, "fallback_commune_center");

    if (anchors.length === 0) {
      if (ws.polylabelPt && !ws.polylabelPt.inWater && !ws.polylabelPt.nearRiver) {
        pushUnique(ws.polylabelPt, "fallback_polylabel_dry");
      } else {
        // Deterministic dry-land grid scan inside ward bbox passing ward PIP + province PIP + outside water
        const [minX, minY, maxX, maxY] = ws.bbox;
        const steps = 16;
        outer: for (let gx = 1; gx < steps; gx++) {
          for (let gy = 1; gy < steps; gy++) {
            const tx = minX + ((maxX - minX) * gx) / steps;
            const ty = minY + ((maxY - minY) * gy) / steps;
            const pt = makePt(tx, ty);
            if (booleanPointInPolygon(pt, ws.wardFeature) && booleanPointInPolygon(pt, ws.provFeature) && isDryPoint(tx, ty)) {
              pushUnique({ lng: tx, lat: ty }, "fallback_polylabel_dry");
              if (anchors.length >= 4) break outer;
            }
          }
        }
        // Last resort for sub-pixel ocean/islet rock polygons: polylabel point strictly inside ward + province
        if (anchors.length === 0 && ws.polylabelPt) {
          pushUnique(ws.polylabelPt, "fallback_polylabel_dry");
        } else if (anchors.length === 0) {
          const [minX, minY, maxX, maxY] = ws.bbox;
          const pt = makePt((minX + maxX) / 2, (minY + maxY) / 2);
          if (booleanPointInPolygon(pt, ws.wardFeature)) {
            pushUnique({ lng: (minX + maxX) / 2, lat: (minY + maxY) / 2 }, "fallback_polylabel_dry");
          } else {
            const firstRingPt = largestPolygonRings(ws.wardFeature.geometry)[0][0];
            pushUnique({ lng: firstRingPt[0], lat: firstRingPt[1] }, "fallback_polylabel_dry");
          }
        }
      }
    }

    const primarySource = anchors[0].src;
    const centroid = ws.polylabelPt && !ws.polylabelPt.inWater ? ws.polylabelPt : anchors[0];
    const urbanClass = classifyUrbanRural(ws, {
      buildingCount: ws.buildings.totalMatched,
      landuseCount: ws.landuse.totalMatched,
    });

    const [minLng, minLat, maxLng, maxLat] = ws.bbox;
    wardsOut.push({
      wardCode: ws.wardCode,
      provinceCode: ws.provinceCode,
      gisWardCode: ws.wardCodeStr,
      gisProvinceCode: ws.provinceCodeStr,
      wardName: ws.wardName,
      provinceName: ws.provinceName,
      divisionType: ws.divisionType,
      urbanClass,
      areaKm2: ws.areaKm2,
      centroidLat: Number(centroid.lat.toFixed(6)),
      centroidLng: Number(centroid.lng.toFixed(6)),
      minLat: Number(minLat.toFixed(6)),
      maxLat: Number(maxLat.toFixed(6)),
      minLng: Number(minLng.toFixed(6)),
      maxLng: Number(maxLng.toFixed(6)),
      source: SOURCE_TAG,
      pointSource: primarySource,
      osmStats: {
        buildings: ws.buildings.totalMatched,
        landuse: ws.landuse.totalMatched,
        roads: ws.roads.totalMatched,
        unnamedRoads: ws.roads.unnamedMatched,
        places: ws.places.totalMatched,
      },
      anchors,
    });

    runtimePolygons.wards[ws.wardCode] = {
      wardCode: ws.wardCode,
      provinceCode: ws.provinceCode,
      bbox: ws.bbox,
      feature: ws.wardFeature,
    };

    coverage.totals[urbanClass === "urban" ? "urbanWards" : "ruralWards"]++;
    coverage.totals.byPrimarySource[primarySource]++;
    if (dryBuildings.length > 0) coverage.totals.wardsWithBuildings++;
    if (dryLanduse.length > 0) coverage.totals.wardsWithLanduse++;
    if (dryRoads.length > 0) coverage.totals.wardsWithRoads++;
    if (ws.roads.totalMatched > 0 && ws.roads.unnamedMatched === ws.roads.totalMatched) coverage.totals.wardsOnlyUnnamedRoads++;
    coverage.totals.waterRejectedTotal += ws.waterRejectedCount;

    const pEntry = (coverage.byProvince[ws.provinceCodeStr] ??= {
      provinceCode: ws.provinceCode,
      provinceName: ws.provinceName,
      wards: 0,
      urban: 0,
      rural: 0,
      primarySources: {
        osm_building: 0,
        osm_landuse: 0,
        osm_road: 0,
        fallback_commune_center: 0,
        fallback_polylabel_dry: 0,
      },
    });
    pEntry.wards++;
    pEntry[urbanClass]++;
    pEntry.primarySources[primarySource]++;
    if (primarySource.startsWith("fallback_")) {
      coverage.fallbackOnlyWards.push({
        wardCode: ws.wardCode,
        wardName: ws.wardName,
        provinceName: ws.provinceName,
        divisionType: ws.divisionType,
        pointSource: primarySource,
        areaKm2: ws.areaKm2,
      });
    }
  }

  wardsOut.sort((a, b) => a.wardCode - b.wardCode);

  fs.mkdirSync(path.dirname(OUTPUT_GEO_JSON), { recursive: true });
  fs.writeFileSync(
    OUTPUT_GEO_JSON,
    JSON.stringify({
      version: 1,
      source: SOURCE_TAG,
      gisTag: "v5.2.0",
      gisLicense: "MIT",
      osmExtractTimestamp: OSM_EXTRACT_TIMESTAMP,
      osmLicense: "ODbL 1.0",
      provinceCount: 34,
      wardCount: wardsOut.length,
      wards: wardsOut,
    }) + "\n",
    "utf8"
  );

  fs.mkdirSync(RUNTIME_GEO_DIR, { recursive: true });
  fs.writeFileSync(path.join(RUNTIME_GEO_DIR, "ward_polygons.json"), JSON.stringify(runtimePolygons.wards), "utf8");
  fs.writeFileSync(path.join(RUNTIME_GEO_DIR, "province_polygons.json"), JSON.stringify(runtimePolygons.provinces), "utf8");
  fs.writeFileSync(path.join(RUNTIME_GEO_DIR, "osm_coverage_report.json"), JSON.stringify(coverage, null, 2) + "\n", "utf8");

  const sizeMb = (fs.statSync(OUTPUT_GEO_JSON).size / (1024 * 1024)).toFixed(2);
  console.log(`DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUTPUT_GEO_JSON} (${sizeMb} MB)`);
  console.log("Coverage totals:", JSON.stringify(coverage.totals, null, 2));
  return { wardsOut, coverage };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await runPrepareGeo();
}
