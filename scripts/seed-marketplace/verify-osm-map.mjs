// Verifies 300 stratified points against Turf double PIP (ward + province) and OSM water exclusion,
// writes an interactive offline HTML map + PNG screenshot to _warroom/evidence/discovery-scale/.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_CACHE_DIR } from "./verify-gis.mjs";
import { loadRuntimePolygons, loadWardGeo, sampleStratifiedPoints } from "./lib/geo-sampler.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const req = createRequire(import.meta.url);
const _bpip = req(path.join(here, "tools", "node_modules", "@turf", "boolean-point-in-polygon"));
const booleanPointInPolygon = _bpip.default ?? _bpip;
const _p2ld = req(path.join(here, "tools", "node_modules", "@turf", "point-to-line-distance"));
const pointToLineDistance = _p2ld.default ?? _p2ld;
const _RBush = req(path.join(here, "tools", "node_modules", "rbush"));
const RBush = _RBush.default ?? _RBush;

export const EVIDENCE_DIR = path.join(repoRoot, "_warroom", "evidence", "discovery-scale");
export const MAP_HTML_PATH = path.join(EVIDENCE_DIR, "osm-verification-map.html");
export const MAP_PNG_PATH = path.join(EVIDENCE_DIR, "osm-verification-overview.png");
export const AUDIT_JSON_PATH = path.join(here, ".runtime", "geo", "osm_300pt_audit.json");

const SPOTLIGHTS = [
  { id: "hanoi", title: "Hà Nội Urban (Hoàn Kiếm / Tây Hồ / Sông Hồng)", minLng: 105.78, minLat: 20.99, maxLng: 105.89, maxLat: 21.08 },
  { id: "hcm", title: "TP.HCM Urban (Sài Gòn / Bến Thành / Thủ Đức)", minLng: 106.64, minLat: 10.74, maxLng: 106.78, maxLat: 10.85 },
  { id: "danang", title: "Đà Nẵng Coastal & Urban", minLng: 108.13, minLat: 15.98, maxLng: 108.30, maxLat: 16.12 },
  { id: "phuquoc", title: "Phú Quốc Đặc khu (Island)", minLng: 103.82, minLat: 10.00, maxLng: 104.08, maxLat: 10.46 },
];

function quickPolyBbox(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (ring) => {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  };
  if (geom.type === "Point") return [geom.coordinates[0], geom.coordinates[1], geom.coordinates[0], geom.coordinates[1]];
  if (geom.type === "LineString") scan(geom.coordinates);
  else if (geom.type === "Polygon") scan(geom.coordinates[0]);
  else if (geom.type === "MultiPolygon") for (const p of geom.coordinates) if (p[0]) scan(p[0]);
  return [minX, minY, maxX, maxY];
}

function simplifyRing(ring, maxPts = 120) {
  if (!ring || ring.length <= maxPts) return ring;
  const step = Math.max(1, Math.floor(ring.length / maxPts));
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  out.push(ring[0]);
  return out;
}

function extractRenderLoops(geom, maxPts = 100) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [simplifyRing(geom.coordinates[0], maxPts)];
  if (geom.type === "MultiPolygon") return geom.coordinates.map((p) => simplifyRing(p[0], maxPts)).filter(Boolean);
  return [];
}

function findChromeBinary() {
  const candidates = [
    "C:\\Users\\Windows\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe",
    "C:\\Users\\Windows\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export async function runOsmMapVerification({ cacheDir = DEFAULT_CACHE_DIR } = {}) {
  const geo = loadWardGeo();
  const polys = loadRuntimePolygons();
  if (!polys.available) throw new Error("Runtime polygons missing; run prepare-geo.mjs first.");

  const points = sampleStratifiedPoints(300, "s0-verify-300");
  // Also add ~8-12 extra points in each spotlight region just for dense visual backdrop if needed? No, stick strictly to 300 audited points!
  const ptTree = new RBush();
  const auditRows = points.map((pt, idx) => ({
    idx,
    ...pt,
    inWard: false,
    inProvince: false,
    inWater: false,
    errorReason: null,
  }));

  for (const r of auditRows) {
    const tPt = { type: "Feature", geometry: { type: "Point", coordinates: [r.longitude, r.latitude] }, properties: {} };
    const wPoly = polys.wards[String(r.wardCode)];
    const pPoly = polys.provinces[String(r.provinceCode)];
    r.inWard = Boolean(wPoly?.feature && booleanPointInPolygon(tPt, wPoly.feature));
    r.inProvince = Boolean(pPoly?.feature && booleanPointInPolygon(tPt, pPoly.feature));
    ptTree.insert({ minX: r.longitude, minY: r.latitude, maxX: r.longitude, maxY: r.latitude, ref: r });
  }

  // Stream water.geojsonl once: verify ALL 300 points + collect water loops inside spotlights for visual map
  const spotlightWaterPolys = Object.fromEntries(SPOTLIGHTS.map((s) => [s.id, []]));
  const waterPath = path.join(cacheDir, "osm", "layers", "water.geojsonl");
  if (!fs.existsSync(waterPath)) throw new Error(`Missing water.geojsonl at ${waterPath}`);

  const rl = readline.createInterface({
    input: fs.createReadStream(waterPath, { encoding: "utf8", highWaterMark: 1024 * 1024 }),
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    const line = rawLine.charCodeAt(0) === 0x1e ? rawLine.slice(1) : rawLine;
    if (!line.trim()) continue;
    let feat;
    try {
      feat = JSON.parse(line);
    } catch {
      continue;
    }
    const props = feat?.properties || {};
    if (!feat?.geometry || props.bridge === "yes" || props.tunnel === "yes" || props.tunnel === "culvert") continue;
    const geom = feat.geometry;
    const gb = quickPolyBbox(geom);
    if (!Number.isFinite(gb[0])) continue;

    const handlePoly = (polyCoords) => {
      if (!polyCoords?.[0]?.length) return;
      let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
      for (const [x, y] of polyCoords[0]) {
        if (x < sMinX) sMinX = x;
        if (y < sMinY) sMinY = y;
        if (x > sMaxX) sMaxX = x;
        if (y > sMaxY) sMaxY = y;
      }
      const hits = ptTree.search({ minX: sMinX, minY: sMinY, maxX: sMaxX, maxY: sMaxY });
      if (!hits.length) return;
      const polyFeat = { type: "Feature", geometry: { type: "Polygon", coordinates: polyCoords }, properties: {} };
      for (const h of hits) {
        if (h.ref.inWater) continue;
        if (booleanPointInPolygon({ type: "Feature", geometry: { type: "Point", coordinates: [h.ref.longitude, h.ref.latitude] }, properties: {} }, polyFeat)) {
          h.ref.inWater = true;
        }
      }
    };

    if (geom.type === "Polygon" || geom.type === "MultiPolygon") {
      const isWaterPoly =
        props.place !== "island" &&
        props.natural !== "land" &&
        props.natural !== "coastline" &&
        (props.natural === "water" ||
          Boolean(props.water) ||
          ["riverbank", "dock", "canal"].includes(props.waterway) ||
          ["reservoir", "basin"].includes(props.landuse));
      if (!isWaterPoly) continue;
      // Save water loops overlapping spotlight boxes (cap per spotlight to keep HTML compact)
      for (const s of SPOTLIGHTS) {
        if (spotlightWaterPolys[s.id].length < 400 && gb[2] >= s.minLng && gb[0] <= s.maxLng && gb[3] >= s.minLat && gb[1] <= s.maxLat) {
          for (const ring of extractRenderLoops(geom, 60)) spotlightWaterPolys[s.id].push(ring);
        }
      }
      if (geom.type === "Polygon") handlePoly(geom.coordinates);
      else for (const poly of geom.coordinates) handlePoly(poly);
    } else if (geom.type === "LineString" && (props.waterway === "river" || props.waterway === "canal")) {
      const pad = 0.0003;
      if (!ptTree.collides({ minX: gb[0] - pad, minY: gb[1] - pad, maxX: gb[2] + pad, maxY: gb[3] + pad })) continue;
      const coords = geom.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[i + 1];
        const hits = ptTree.search({ minX: Math.min(x1, x2) - pad, minY: Math.min(y1, y2) - pad, maxX: Math.max(x1, x2) + pad, maxY: Math.max(y1, y2) + pad });
        if (!hits.length) continue;
        const segLine = { type: "Feature", geometry: { type: "LineString", coordinates: [coords[i], coords[i + 1]] }, properties: {} };
        for (const h of hits) {
          if (h.ref.inWater || h.ref.pointSource === "osm_building") continue;
          const d = pointToLineDistance({ type: "Feature", geometry: { type: "Point", coordinates: [h.ref.longitude, h.ref.latitude] }, properties: {} }, segLine, { units: "meters" });
          if (d < 25) h.ref.inWater = true;
        }
      }
    }
  }

  let errorCount = 0;
  const bySource = {};
  const byUrban = { urban: 0, rural: 0 };
  const errorPoints = [];

  for (const r of auditRows) {
    bySource[r.pointSource] = (bySource[r.pointSource] || 0) + 1;
    byUrban[r.urbanClass] = (byUrban[r.urbanClass] || 0) + 1;
    const errs = [];
    if (!r.inWard) errs.push("outside_ward");
    if (!r.inProvince) errs.push("outside_province");
    if (r.inWater) errs.push("in_water");
    if (errs.length) {
      r.errorReason = errs.join("+");
      errorCount++;
      errorPoints.push(r);
    }
  }

  const errorRate = errorCount / auditRows.length;
  const auditSummary = {
    totalChecked: auditRows.length,
    passedCount: auditRows.length - errorCount,
    errorCount,
    errorRatePct: Number((errorRate * 100).toFixed(2)),
    thresholdPct: 1.0,
    passedThreshold: errorRate < 0.01,
    bySource,
    byUrban,
    osmExtractTimestamp: geo.meta.osmExtractTimestamp,
    gisTag: geo.meta.gisTag,
    errorPoints,
  };

  fs.mkdirSync(path.dirname(AUDIT_JSON_PATH), { recursive: true });
  fs.writeFileSync(AUDIT_JSON_PATH, JSON.stringify({ auditSummary, points: auditRows }, null, 2) + "\n", "utf8");

  // Prepare simplified province polygons & sampled ward loops for standalone offline HTML map
  const provinceLoops = Object.values(polys.provinces).map((p) => ({
    code: p.feature.properties.code,
    loops: extractRenderLoops(p.feature.geometry, 120),
  }));
  const spotlightWardLoops = Object.fromEntries(SPOTLIGHTS.map((s) => [s.id, []]));
  for (const w of Object.values(polys.wards)) {
    const wb = w.bbox;
    for (const s of SPOTLIGHTS) {
      if (wb[2] >= s.minLng && wb[0] <= s.maxLng && wb[3] >= s.minLat && wb[1] <= s.maxLat) {
        const wMeta = geo.byWardCode.get(w.wardCode);
        spotlightWardLoops[s.id].push({
          wardCode: w.wardCode,
          wardName: wMeta?.wardName ?? String(w.wardCode),
          urbanClass: wMeta?.urbanClass ?? "rural",
          loops: extractRenderLoops(w.feature.geometry, 90),
        });
      }
    }
  }

  const mapDataPayload = {
    summary: auditSummary,
    provinceLoops,
    points: auditRows,
    spotlights: SPOTLIGHTS.map((s) => ({
      ...s,
      wards: spotlightWardLoops[s.id],
      water: spotlightWaterPolys[s.id],
      points: auditRows.filter((p) => p.longitude >= s.minLng && p.longitude <= s.maxLng && p.latitude >= s.minLat && p.latitude <= s.maxLat),
    })),
  };

  const html = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Gymini S0 Geo Verification — 300 Stratified OSM Points</title>
<style>
  :root {
    --bg: #0a0a0a; --panel: #111111; --card: #18181b; --border: #27272a;
    --text: #f8fafc; --muted: #94a3b8; --green: #22c55e; --emerald: #10b981;
    --violet: #a78bfa; --amber: #f59e0b; --red: #ef4444; --water: #0284c7;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, Segoe UI, sans-serif; padding: 16px; }
  .header { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
  .header h1 { font-size: 18px; font-weight: 700; }
  .sub { font-size: 12px; color: var(--muted); }
  .badges { display: flex; flex-wrap: wrap; gap: 8px; }
  .badge { background: var(--card); border: 1px solid var(--border); border-radius: 999px; padding: 5px 12px; font-size: 12px; font-weight: 600; }
  .badge.ok { border-color: var(--green); color: var(--green); }
  .badge.err { border-color: var(--red); color: var(--red); }
  .grid { display: grid; grid-template-columns: 520px 1fr; gap: 14px; align-items: start; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 12px; }
  .panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 8px; }
  canvas { display: block; width: 100%; border-radius: 8px; background: #070b12; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 11px; color: var(--muted); }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
  .insets { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .inset-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 8px; }
  .inset-card h3 { font-size: 12px; color: var(--text); margin-bottom: 6px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .kpi { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
  .kpi .val { font-size: 20px; font-weight: 700; color: var(--green); }
  .kpi .lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }
  #tip { position: fixed; pointer-events: none; background: rgba(17,17,17,0.95); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font-size: 11px; display: none; z-index: 20; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Gymini S0-prepare — 300-Point OSM + GIS Boundary Verification Map</h1>
      <div class="sub">Boundaries: thanglequoc/vietnamese-provinces-database ${auditSummary.gisTag} (MIT, 34 provinces / 3,321 wards) &bull; Settlement/Water Mask: OSM Vietnam ${auditSummary.osmExtractTimestamp} (ODbL)</div>
    </div>
    <div class="badges">
      <span class="badge ${auditSummary.passedThreshold ? "ok" : "err"}">Error Rate: ${auditSummary.errorRatePct}% (${auditSummary.errorCount}/300) &lt; 1%</span>
      <span class="badge">Urban: ${auditSummary.byUrban.urban} | Rural: ${auditSummary.byUrban.rural}</span>
      <span class="badge">Turf Double PIP (Ward + Prov)</span>
    </div>
  </div>

  <div class="grid">
    <div class="panel">
      <h2>All-Vietnam Overview (34 Provinces + 300 Stratified Points)</h2>
      <canvas id="vnCanvas" width="496" height="740"></canvas>
      <div class="legend">
        <span><i class="dot" style="background:#22c55e"></i>osm_building (${auditSummary.bySource.osm_building || 0})</span>
        <span><i class="dot" style="background:#38bdf8"></i>osm_landuse (${auditSummary.bySource.osm_landuse || 0})</span>
        <span><i class="dot" style="background:#a78bfa"></i>osm_road (${auditSummary.bySource.osm_road || 0})</span>
        <span><i class="dot" style="background:#f59e0b"></i>fallback_commune (${auditSummary.bySource.fallback_commune_center || 0})</span>
        <span><i class="dot" style="background:#f472b6"></i>fallback_polylabel_dry (${auditSummary.bySource.fallback_polylabel_dry || 0})</span>
        <span><i class="dot" style="background:#ef4444"></i>Error (${auditSummary.errorCount})</span>
      </div>
    </div>

    <div>
      <div class="panel">
        <h2>QA Audit Summary (n = 300)</h2>
        <div class="kpis">
          <div class="kpi"><div class="val">${auditSummary.passedCount}/300</div><div class="lbl">Double PIP + Dry Verified</div></div>
          <div class="kpi"><div class="val" style="color:${auditSummary.errorCount ? '#ef4444' : '#22c55e'}">${auditSummary.errorRatePct}%</div><div class="lbl">Error Rate (&lt; 1% gate)</div></div>
          <div class="kpi"><div class="val">${auditSummary.byUrban.urban}</div><div class="lbl">Urban Sample Points</div></div>
          <div class="kpi"><div class="val">${auditSummary.byUrban.rural}</div><div class="lbl">Rural / Island Sample Points</div></div>
        </div>
      </div>

      <div class="insets">
        ${SPOTLIGHTS.map((s) => `
          <div class="inset-card">
            <h3>${s.title}</h3>
            <canvas id="inset_${s.id}" width="460" height="310"></canvas>
          </div>
        `).join("")}
      </div>
      <div class="legend" style="margin-top:8px;">
        <span><i class="dot" style="background:#0c4a6e; border:1px solid #0284c7"></i>OSM Water / Riverbank / Coast Mask</span>
        <span><i class="dot" style="background:#1e293b; border:1px solid #475569"></i>GIS Ward Boundaries</span>
        <span><i class="dot" style="background:#22c55e"></i>Verified Land Sample Pin</span>
      </div>
    </div>
  </div>
  <div id="tip"></div>

<script>
const DATA = ${JSON.stringify(mapDataPayload)};
const SRC_COLOR = {
  osm_building: "#22c55e",
  osm_landuse: "#38bdf8",
  osm_road: "#a78bfa",
  fallback_commune_center: "#f59e0b",
  fallback_polylabel_dry: "#f472b6",
};

function makeProj(minLng, minLat, maxLng, maxLat, width, height, pad = 16) {
  const cosLat = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const dx = (maxLng - minLng) * cosLat;
  const dy = maxLat - minLat;
  const scale = Math.min((width - pad * 2) / dx, (height - pad * 2) / dy);
  const ox = (width - dx * scale) / 2;
  const oy = (height - dy * scale) / 2;
  return (lng, lat) => [
    ox + (lng - minLng) * cosLat * scale,
    height - oy - (lat - minLat) * scale,
  ];
}

function drawLoops(ctx, loops, proj, fill, stroke, lineWidth = 0.8) {
  ctx.beginPath();
  for (const ring of loops) {
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = proj(ring[i][0], ring[i][1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function drawOverview() {
  const canvas = document.getElementById("vnCanvas");
  const ctx = canvas.getContext("2d");
  const proj = makeProj(102.0, 8.2, 114.6, 23.5, canvas.width, canvas.height, 14);
  for (const prov of DATA.provinceLoops) {
    drawLoops(ctx, prov.loops, proj, "#131c2b", "#334155", 0.7);
  }
  for (const pt of DATA.points) {
    const [x, y] = proj(pt.longitude, pt.latitude);
    ctx.beginPath();
    if (pt.errorReason) {
      ctx.strokeStyle = "#ef4444"; ctx.lineWidth = 2;
      ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4);
      ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4);
      ctx.stroke();
    } else {
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = SRC_COLOR[pt.pointSource] || "#22c55e";
      ctx.fill();
      ctx.strokeStyle = "#0a0a0a";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    let best = null, bestD = 100;
    for (const pt of DATA.points) {
      const [x, y] = proj(pt.longitude, pt.latitude);
      const d = (x - sx) ** 2 + (y - sy) ** 2;
      if (d < bestD) { bestD = d; best = pt; }
    }
    const tip = document.getElementById("tip");
    if (best) {
      tip.style.display = "block";
      tip.style.left = (e.clientX + 12) + "px";
      tip.style.top = (e.clientY + 12) + "px";
      tip.innerHTML = "<b>" + best.wardName + "</b> (" + best.provinceName + ")<br/>" +
        best.urbanClass + " | " + best.pointSource + "<br/>" +
        best.latitude + ", " + best.longitude + (best.errorReason ? " <span style='color:#ef4444'>[" + best.errorReason + "]</span>" : " [OK]");
    } else {
      tip.style.display = "none";
    }
  });
}

function drawInsets() {
  for (const sp of DATA.spotlights) {
    const canvas = document.getElementById("inset_" + sp.id);
    const ctx = canvas.getContext("2d");
    const proj = makeProj(sp.minLng, sp.minLat, sp.maxLng, sp.maxLat, canvas.width, canvas.height, 10);
    for (const w of sp.wards) {
      const fill = w.urbanClass === "urban" ? "#1e293b" : "#17202b";
      drawLoops(ctx, w.loops, proj, fill, "#475569", 0.9);
    }
    if (sp.water.length) {
      drawLoops(ctx, sp.water, proj, "rgba(2, 132, 199, 0.55)", "#0284c7", 0.6);
    }
    for (const pt of sp.points) {
      const [x, y] = proj(pt.longitude, pt.latitude);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = pt.errorReason ? "#ef4444" : (SRC_COLOR[pt.pointSource] || "#22c55e");
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

drawOverview();
drawInsets();
</script>
</body>
</html>`;

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(MAP_HTML_PATH, html, "utf8");

  const chromeBin = findChromeBinary();
  let screenshotCreated = false;
  if (chromeBin) {
    const fileUrl = `file:///${MAP_HTML_PATH.replace(/\\/g, "/")}`;
    execFileSync(chromeBin, [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--window-size=1560,980",
      "--virtual-time-budget=2000",
      `--screenshot=${MAP_PNG_PATH}`,
      fileUrl,
    ]);
    screenshotCreated = fs.existsSync(MAP_PNG_PATH);
  }

  console.log(JSON.stringify({ ...auditSummary, htmlMap: MAP_HTML_PATH, screenshot: screenshotCreated ? MAP_PNG_PATH : null }, null, 2));
  if (!auditSummary.passedThreshold) {
    process.exitCode = 1;
  }
  return auditSummary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await runOsmMapVerification();
}
