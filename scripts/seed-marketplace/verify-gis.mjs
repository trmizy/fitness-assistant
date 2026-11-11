// Verifies GIS v5.2.0 GeoJSON dataset (34 provinces / 3,321 wards) 100% matches vietnam_provinces.json.
// Never executes any script/SQL from the GIS repository; reads JSON/GeoJSON data only.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const req = createRequire(import.meta.url);
const _bbox = req(path.join(here, "tools", "node_modules", "@turf", "bbox"));
const bbox = _bbox.default ?? _bbox;
const _bpip = req(path.join(here, "tools", "node_modules", "@turf", "boolean-point-in-polygon"));
const booleanPointInPolygon = _bpip.default ?? _bpip;
const _polylabel = req(path.join(here, "tools", "node_modules", "polylabel"));
const polylabel = typeof _polylabel === "function" ? _polylabel : (_polylabel.default?.default ?? _polylabel.default);

export const DEFAULT_CACHE_DIR = process.env.GYMINI_S0_CACHE_DIR || "D:\\FitnessAssistant-cache\\s0";
export const REF_PROVINCES_PATH = path.join(repoRoot, "backend", "services", "user-service", "prisma", "data", "vietnam_provinces.json");

export function resolveGisGeojsonRoot(cacheDir = DEFAULT_CACHE_DIR) {
  const candidates = [
    path.join(cacheDir, "gis-v5.2.0", "geojson", "geojson"),
    path.join(cacheDir, "gis-v5.2.0", "geojson"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.readdirSync(c).some((d) => /^\d+_/.test(d))) return c;
  }
  throw new Error(`GIS GeoJSON root not found under ${cacheDir}/gis-v5.2.0`);
}

function normalizeCoreUnitName(fullName = "") {
  return String(fullName)
    .normalize("NFC")
    .trim()
    .replace(/^(Thành phố|Tỉnh|Phường|Xã|Thị trấn|Đặc khu)\s+/iu, "")
    .replace(/[’‘`]/g, "'")
    .replace(/oà/g, "òa").replace(/oá/g, "óa").replace(/oả/g, "ỏa").replace(/oã/g, "õa").replace(/oạ/g, "ọa")
    .replace(/uỳ/g, "ùy").replace(/uý/g, "úy").replace(/uỷ/g, "ủy").replace(/uỹ/g, "ũy").replace(/uỵ/g, "ụy")
    .replace(/Oà/g, "Òa").replace(/Oá/g, "Óa").replace(/Uỳ/g, "Ùy").replace(/Uý/g, "Úy")
    .toLowerCase();
}

/** Checks 100% exact code & parent-province match across all 34 provinces and 3,321 wards. */
export function verifyGisDataset({ cacheDir = DEFAULT_CACHE_DIR, refPath = REF_PROVINCES_PATH } = {}) {
  const refProvinces = JSON.parse(fs.readFileSync(refPath, "utf8"));
  const gisRoot = resolveGisGeojsonRoot(cacheDir);

  const refProvByCode = new Map();
  const refWardByCode = new Map();
  for (const p of refProvinces) {
    const pCode = String(p.code).padStart(2, "0");
    refProvByCode.set(pCode, { code: p.code, codeStr: pCode, name: p.name, division_type: p.division_type, codename: p.codename, wards: p.wards });
    for (const w of p.wards) {
      const wCode = String(w.code).padStart(5, "0");
      refWardByCode.set(wCode, { code: w.code, codeStr: wCode, provinceCodeStr: pCode, provinceCode: p.code, provinceName: p.name, name: w.name, division_type: w.division_type, codename: w.codename });
    }
  }

  const provDirs = fs.readdirSync(gisRoot).filter((d) => fs.statSync(path.join(gisRoot, d)).isDirectory()).sort();
  const gisProvs = new Map();
  const gisWards = new Map();

  const provErrors = [];
  const wardErrors = [];
  const prefixWarnings = [];

  for (const dir of provDirs) {
    const provGeoPath = path.join(gisRoot, dir, `${dir}.geojson`);
    if (!fs.existsSync(provGeoPath)) {
      provErrors.push({ type: "MISSING_PROVINCE_FILE", dir });
      continue;
    }
    const pJson = JSON.parse(fs.readFileSync(provGeoPath, "utf8"));
    const pFeat = pJson.features?.[0];
    const pCode = String(pFeat?.properties?.code ?? pFeat?.id ?? "").padStart(2, "0");
    if (!pFeat?.geometry || !pCode) {
      provErrors.push({ type: "INVALID_PROVINCE_GEOJSON", dir });
      continue;
    }
    gisProvs.set(pCode, { dir, file: provGeoPath, feature: pFeat, props: pFeat.properties, bbox: pJson.bbox ?? bbox(pFeat) });

    const refP = refProvByCode.get(pCode);
    if (!refP) {
      provErrors.push({ type: "EXTRA_IN_GIS", code: pCode, gisName: pFeat.properties.fullName });
    } else if (normalizeCoreUnitName(refP.name) !== normalizeCoreUnitName(pFeat.properties.fullName)) {
      provErrors.push({ type: "CORE_NAME_MISMATCH", code: pCode, refName: refP.name, gisName: pFeat.properties.fullName });
    } else if (refP.name.trim() !== String(pFeat.properties.fullName).trim()) {
      prefixWarnings.push({ level: "province", code: pCode, refName: refP.name, gisName: pFeat.properties.fullName });
    }

    const wardsDir = path.join(gisRoot, dir, "wards");
    const wFiles = fs.existsSync(wardsDir) ? fs.readdirSync(wardsDir).filter((f) => f.endsWith(".geojson")).sort() : [];
    for (const wf of wFiles) {
      const wPath = path.join(wardsDir, wf);
      const wJson = JSON.parse(fs.readFileSync(wPath, "utf8"));
      const wFeat = wJson.features?.[0];
      const wCode = String(wFeat?.properties?.code ?? wFeat?.id ?? "").padStart(5, "0");
      if (!wFeat?.geometry || !wCode) {
        wardErrors.push({ type: "INVALID_WARD_GEOJSON", file: wPath });
        continue;
      }
      if (gisWards.has(wCode)) {
        wardErrors.push({ type: "DUPLICATE_WARD_IN_GIS", code: wCode, file: wPath });
        continue;
      }
      const wBbox = wJson.bbox ?? bbox(wFeat);
      gisWards.set(wCode, { provinceCodeStr: pCode, file: wPath, feature: wFeat, props: wFeat.properties, bbox: wBbox });

      const refW = refWardByCode.get(wCode);
      if (!refW) {
        wardErrors.push({ type: "EXTRA_WARD_IN_GIS", code: wCode, provinceCode: pCode, gisName: wFeat.properties.fullName });
      } else {
        if (refW.provinceCodeStr !== pCode) {
          wardErrors.push({ type: "PROVINCE_LINK_MISMATCH", code: wCode, refProv: refW.provinceCodeStr, gisProv: pCode, name: refW.name });
        }
        if (normalizeCoreUnitName(refW.name) !== normalizeCoreUnitName(wFeat.properties.fullName)) {
          wardErrors.push({ type: "WARD_CORE_NAME_MISMATCH", code: wCode, refName: refW.name, gisName: wFeat.properties.fullName });
        } else if (refW.name.trim() !== String(wFeat.properties.fullName).trim()) {
          prefixWarnings.push({ level: "ward", code: wCode, refName: refW.name, gisName: wFeat.properties.fullName });
        }
      }
    }
  }

  for (const [pCode, refP] of refProvByCode) {
    if (!gisProvs.has(pCode)) provErrors.push({ type: "MISSING_IN_GIS", code: pCode, refName: refP.name });
  }
  for (const [wCode, refW] of refWardByCode) {
    if (!gisWards.has(wCode)) wardErrors.push({ type: "MISSING_IN_GIS", code: wCode, provinceCode: refW.provinceCodeStr, refName: refW.name });
  }

  return {
    refProvinceCount: refProvByCode.size,
    refWardCount: refWardByCode.size,
    gisProvinceCount: gisProvs.size,
    gisWardCount: gisWards.size,
    provErrors,
    wardErrors,
    prefixWarningsCount: prefixWarnings.length,
    ok: provErrors.length === 0 && wardErrors.length === 0 && gisProvs.size === 34 && gisWards.size === 3321,
    refProvByCode,
    refWardByCode,
    gisProvs,
    gisWards,
  };
}

/** Selects ~20 diverse sample wards (urban + mountainous + island/special zones) and inspects centroid vs polylabel + PIP. */
export function checkSampleWards(verified) {
  const sampleQueries = [
    // Urban (Ha Noi, TP.HCM, Da Nang, Hai Phong, Can Tho, Hue)
    { tag: "urban", match: (w) => w.code === 70 && w.provinceCode === 1 }, // Hoàn Kiếm, Hà Nội
    { tag: "urban", match: (w) => w.code === 4 && w.provinceCode === 1 }, // Ba Đình, Hà Nội
    { tag: "urban", match: (w) => w.name === "Phường Sài Gòn" && w.provinceCode === 79 }, // Sài Gòn, HCM
    { tag: "urban", match: (w) => w.name === "Phường Bến Thành" && w.provinceCode === 79 }, // Bến Thành, HCM
    { tag: "urban", match: (w) => w.name === "Phường Hải Châu" && w.provinceCode === 48 }, // Hải Châu, Đà Nẵng
    { tag: "urban", match: (w) => w.name === "Phường Ninh Kiều" && w.provinceCode === 92 }, // Ninh Kiều, Cần Thơ
    { tag: "urban", match: (w) => w.name === "Phường Phú Xuân" && w.provinceCode === 46 }, // Phú Xuân, Huế
    // Mountainous / Border / Highland
    { tag: "mountain", match: (w) => w.name.includes("Sa Pa") && w.provinceCode === 15 }, // Sa Pa, Lào Cai
    { tag: "mountain", match: (w) => w.name.includes("Lũng Cú") }, // Lũng Cú, Hà Giang/Tuyên Quang
    { tag: "mountain", match: (w) => w.name.includes("Mù Cang Chải") }, // Mù Cang Chải
    { tag: "mountain", match: (w) => w.name.includes("Mộc Châu") && w.provinceCode === 14 }, // Mộc Châu, Sơn La
    { tag: "mountain", match: (w) => w.name.includes("Y Tý") }, // Y Tý, Lào Cai
    { tag: "mountain", match: (w) => w.name.includes("Măng Đen") }, // Măng Đen (Kon Tum / Quảng Ngãi)
    { tag: "mountain", match: (w) => w.name.includes("Bờ Y") }, // Bờ Y ngã ba Đông Dương
    // Island / Đặc khu / Archipelago
    { tag: "island", match: (w) => w.name.includes("Phú Quốc") },
    { tag: "island", match: (w) => w.name.includes("Côn Đảo") },
    { tag: "island", match: (w) => w.name.includes("Lý Sơn") },
    { tag: "island", match: (w) => w.name.includes("Cát Hải") },
    { tag: "island", match: (w) => w.name.includes("Cô Tô") },
    { tag: "island", match: (w) => w.name.includes("Phú Quý") },
    { tag: "island", match: (w) => w.name.includes("Vân Đồn") },
    { tag: "island", match: (w) => w.name.includes("Bạch Long Vĩ") },
    { tag: "island", match: (w) => w.name.includes("Hoàng Sa") },
    { tag: "island", match: (w) => w.name.includes("Trường Sa") },
  ];

  const picked = [];
  const used = new Set();
  for (const q of sampleQueries) {
    for (const [wCode, refW] of verified.refWardByCode) {
      if (used.has(wCode)) continue;
      if (q.match(refW)) {
        used.add(wCode);
        const gw = verified.gisWards.get(wCode);
        const gp = verified.gisProvs.get(refW.provinceCodeStr);
        const geom = gw.feature.geometry;
        let largestPoly = geom.coordinates[0];
        if (geom.type === "MultiPolygon") {
          let maxLen = 0;
          for (const poly of geom.coordinates) {
            if ((poly[0]?.length ?? 0) > maxLen) {
              maxLen = poly[0].length;
              largestPoly = poly;
            }
          }
        } else {
          largestPoly = geom.coordinates;
        }
        const [lng, lat] = polylabel(largestPoly, 0.0005);
        const pt = { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: {} };
        const inWard = booleanPointInPolygon(pt, gw.feature);
        const inProv = booleanPointInPolygon(pt, gp.feature);
        picked.push({
          tag: q.tag,
          wardCode: wCode,
          wardName: refW.name,
          provinceCode: refW.provinceCodeStr,
          provinceName: refW.provinceName,
          divisionType: refW.division_type,
          areaKm2: gw.props.areaKm2,
          polylabel: [Number(lat.toFixed(6)), Number(lng.toFixed(6))],
          inWard,
          inProv,
          bbox: gw.bbox,
        });
        break;
      }
    }
    if (picked.length >= 20) break;
  }
  return picked;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const res = verifyGisDataset();
  console.log(JSON.stringify({
    ok: res.ok,
    refProvinces: res.refProvinceCount,
    gisProvinces: res.gisProvinceCount,
    refWards: res.refWardCount,
    gisWards: res.gisWardCount,
    provErrors: res.provErrors,
    wardErrors: res.wardErrors,
    spellingOrPrefixDiffs: res.prefixWarningsCount,
  }, null, 2));
  if (!res.ok) {
    console.error("HALT: GIS code mismatch detected vs vietnam_provinces.json!");
    process.exit(1);
  }
  const samples = checkSampleWards(res);
  console.log("\n=== 20+ SAMPLE WARDS (URBAN / MOUNTAIN / ISLAND) ===");
  for (const s of samples) {
    console.log(
      `[${s.tag}] ${s.wardCode} ${s.wardName} (${s.provinceName}, ${s.divisionType}, ${s.areaKm2} km2) -> (${s.polylabel[0]}, ${s.polylabel[1]}) inWard=${s.inWard} inProv=${s.inProv}`
    );
  }
}
