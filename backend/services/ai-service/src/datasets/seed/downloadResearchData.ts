/**
 * download-research-data.ts
 * ─────────────────────────
 * Downloads NHANES XPT datasets and evidence-based research PDFs from
 * authoritative public sources (CDC, ESPEN, HHS, WHO, ISSN).
 *
 * Usage:
 *   npm run data:download            # skip already-downloaded files
 *   npm run data:download -- --force # re-download everything
 *
 * All downloads are idempotent; re-running is safe.
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const ROOT = path.resolve(process.cwd(), "..", "..", "..", "data");
const RAW_NHANES = path.join(ROOT, "raw", "nhanes");
const RAW_PAPERS = path.join(ROOT, "raw", "papers");
const SOURCES_FILE = path.join(ROOT, "sources.json");

const FORCE = process.argv.includes("--force");

// ── Source definitions ────────────────────────────────────────────────────────

interface SourceDef {
  id: string;
  title: string;
  url: string;
  localPath: string;
  category:
    | "nhanes"
    | "bia_guideline"
    | "physical_activity"
    | "nutrition_paper"
    | "training_paper";
  evidenceLevel: string;
  note: string;
}

const SOURCES: SourceDef[] = [
  // NHANES 2021-2023 Body Measures
  {
    id: "nhanes-2021-bmx",
    title: "NHANES 2021-2023 Body Measures (BMX_L)",
    url: "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2021/DataFiles/BMX_L.xpt",
    localPath: path.join(RAW_NHANES, "BMX_L.xpt"),
    category: "nhanes",
    evidenceLevel: "population_normative",
    note: "National Health and Nutrition Examination Survey – Body Measurements 2021-2023. Public domain (US Gov).",
  },
  // NHANES 2017-2018 — DXA + Body Measures + Demographics
  {
    id: "nhanes-2017-dxx",
    title: "NHANES 2017-2018 Dual-Energy X-ray Absorptiometry (DXX_J)",
    url: "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/DXX_J.xpt",
    localPath: path.join(RAW_NHANES, "DXX_J.xpt"),
    category: "nhanes",
    evidenceLevel: "population_normative",
    note: "NHANES 2017-18 DXA whole-body composition. Public domain.",
  },
  {
    id: "nhanes-2017-dxxag",
    title: "NHANES 2017-2018 DXA Android/Gynoid (DXXAG_J)",
    url: "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/DXXAG_J.xpt",
    localPath: path.join(RAW_NHANES, "DXXAG_J.xpt"),
    category: "nhanes",
    evidenceLevel: "population_normative",
    note: "NHANES 2017-18 DXA android/gynoid fat. Public domain.",
  },
  {
    id: "nhanes-2017-bmx",
    title: "NHANES 2017-2018 Body Measures (BMX_J)",
    url: "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/BMX_J.xpt",
    localPath: path.join(RAW_NHANES, "BMX_J.xpt"),
    category: "nhanes",
    evidenceLevel: "population_normative",
    note: "NHANES 2017-18 body measurements. Public domain.",
  },
  {
    id: "nhanes-2017-demo",
    title: "NHANES 2017-2018 Demographics (DEMO_J)",
    url: "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/2017/DataFiles/DEMO_J.xpt",
    localPath: path.join(RAW_NHANES, "DEMO_J.xpt"),
    category: "nhanes",
    evidenceLevel: "population_normative",
    note: "NHANES 2017-18 demographics. Public domain.",
  },
  // ESPEN BIA Guidelines
  {
    id: "espen-bia-guidelines-1",
    title: "ESPEN Bioelectrical Impedance Analysis: Part I Guidelines (2019)",
    url: "https://espen.org/documents/BIA1.pdf",
    localPath: path.join(RAW_PAPERS, "ESPEN_BIA_Part1_2019.pdf"),
    category: "bia_guideline",
    evidenceLevel: "clinical_guideline",
    note: "European clinical nutrition standard for BIA interpretation.",
  },
  {
    id: "espen-bia-guidelines-2",
    title: "ESPEN Bioelectrical Impedance Analysis: Part II Guidelines (2019)",
    url: "https://espen.org/documents/BIA2.pdf",
    localPath: path.join(RAW_PAPERS, "ESPEN_BIA_Part2_2019.pdf"),
    category: "bia_guideline",
    evidenceLevel: "clinical_guideline",
    note: "ESPEN BIA Part II — disease-specific reference values.",
  },
  // Physical Activity Guidelines
  {
    id: "hhs-physical-activity-guidelines-2018",
    title: "Physical Activity Guidelines for Americans 2nd Edition (HHS 2018)",
    url: "https://health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf",
    localPath: path.join(
      RAW_PAPERS,
      "HHS_Physical_Activity_Guidelines_2018.pdf",
    ),
    category: "physical_activity",
    evidenceLevel: "government_guideline",
    note: "US Department of Health and Human Services — authoritative PA guidelines.",
  },
  {
    id: "who-physical-activity-guidelines-2020",
    title: "WHO Guidelines on Physical Activity and Sedentary Behaviour (2020)",
    url: "https://iris.who.int/server/api/core/bitstreams/faa83413-d89e-4be9-bb01-b24671aef7ca/content",
    localPath: path.join(
      RAW_PAPERS,
      "WHO_Physical_Activity_Guidelines_2020.pdf",
    ),
    category: "physical_activity",
    evidenceLevel: "government_guideline",
    note: "World Health Organization — global PA guidelines. CC BY-NC-SA 3.0 IGO.",
  },
  // ISSN Sports Nutrition Papers
  // ISSN open-access papers via Europe PubMed Central (avoids Springer redirect loops)
  {
    id: "issn-protein-2017",
    title: "ISSN Position Stand: Protein and Exercise (2017)",
    url: "https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC5477153&blobtype=pdf",
    localPath: path.join(RAW_PAPERS, "ISSN_Protein_Exercise_2017.pdf"),
    category: "nutrition_paper",
    evidenceLevel: "expert_consensus",
    note: "ISSN position stand — dietary protein for muscle gain, recovery. CC BY 4.0. DOI: 10.1186/s12970-017-0177-8",
  },
  {
    id: "issn-diet-composition-2017",
    title: "ISSN Position Stand: Diets and Body Composition (2017)",
    url: "https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC5470183&blobtype=pdf",
    localPath: path.join(RAW_PAPERS, "ISSN_Diets_Body_Composition_2017.pdf"),
    category: "nutrition_paper",
    evidenceLevel: "expert_consensus",
    note: "ISSN position on diet approaches for body composition. CC BY 4.0. DOI: 10.1186/s12970-017-0174-y",
  },
  {
    id: "issn-energy-2017",
    title:
      "ISSN Position Stand: Nutritional Considerations for Performance (2017)",
    url: "https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC5545206&blobtype=pdf",
    localPath: path.join(RAW_PAPERS, "ISSN_Nutritional_Performance_2017.pdf"),
    category: "nutrition_paper",
    evidenceLevel: "expert_consensus",
    note: "ISSN sports nutrition for performance overview. CC BY 4.0. DOI: 10.1186/s12970-017-0189-4",
  },
  {
    id: "issn-exercise-metabolism-2014",
    title: "ISSN Position Stand: Nutrient Timing (2014)",
    url: "https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC4042570&blobtype=pdf",
    localPath: path.join(RAW_PAPERS, "ISSN_Nutrient_Timing_2014.pdf"),
    category: "nutrition_paper",
    evidenceLevel: "expert_consensus",
    note: "ISSN nutrient timing around exercise. CC BY 4.0. DOI: 10.1186/1550-2783-11-20",
  },
  // Muscle asymmetry / unilateral training papers (added for InBody segmental
  // muscle imbalance coaching — see body_composition_rules.ts Rule H/I)
  {
    id: "asymmetry-thresholds-2021",
    title:
      "The Calculation, Thresholds and Reporting of Inter-Limb Strength Asymmetry: A Systematic Review (2021)",
    url: "https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC8488821&blobtype=pdf",
    localPath: path.join(
      RAW_PAPERS,
      "Parkinson_InterLimb_Asymmetry_2021.pdf",
    ),
    category: "training_paper",
    evidenceLevel: "systematic_review",
    note: "Parkinson et al., J Sports Sci Med 2021. Open access. DOI: 10.52082/jssm.2021.594",
  },
  {
    id: "unilateral-bilateral-training-2022",
    title:
      "Effects of Unilateral vs. Bilateral Resistance Training Interventions on Strength, Jump, and Speed: Systematic Review and Meta-Analysis (2022)",
    url: "https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC9331349&blobtype=pdf",
    localPath: path.join(
      RAW_PAPERS,
      "Liao_Unilateral_Bilateral_Training_2022.pdf",
    ),
    category: "training_paper",
    evidenceLevel: "systematic_review",
    note: "Liao et al., Biology of Sport 2022. Open access. DOI: 10.5114/biolsport.2022.107024",
  },
  {
    id: "unilateral-plyometric-asymmetry-2025",
    title:
      "Unilateral Plyometric Training Effectively Reduces Lower Limb Asymmetry in Athletes: A Meta-Analysis (2025)",
    url: "https://europepmc.org/backend/ptpmcrender.fcgi?accid=PMC12014563&blobtype=pdf",
    localPath: path.join(
      RAW_PAPERS,
      "Sun_Unilateral_Plyometric_Asymmetry_2025.pdf",
    ),
    category: "training_paper",
    evidenceLevel: "systematic_review",
    note: "Sun et al., Frontiers in Physiology 2025. Open access CC BY. DOI: 10.3389/fphys.2025.1551523",
  },
];

// ── Utilities ─────────────────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function downloadFile(
  url: string,
  dest: string,
  retries = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => {
        const protocol = url.startsWith("https") ? https : http;
        const file = fs.createWriteStream(dest + ".tmp");

        const req = protocol.get(
          url,
          {
            timeout: 60000,
            headers: {
              "User-Agent": "fitness-assistant-research-pipeline/1.0",
            },
          },
          (res) => {
            if (
              res.statusCode === 301 ||
              res.statusCode === 302 ||
              res.statusCode === 303 ||
              res.statusCode === 307 ||
              res.statusCode === 308
            ) {
              file.close();
              fs.unlinkSync(dest + ".tmp");
              // Follow redirect
              downloadFile(res.headers.location!, dest, retries - attempt + 1)
                .then(resolve)
                .catch(reject);
              return;
            }
            if (res.statusCode !== 200) {
              file.close();
              fs.unlinkSync(dest + ".tmp");
              reject(new Error(`HTTP ${res.statusCode} for ${url}`));
              return;
            }
            finished(Readable.from(res).pipe(file))
              .then(() => {
                fs.renameSync(dest + ".tmp", dest);
                resolve();
              })
              .catch(reject);
          },
        );

        req.on("error", (err) => {
          file.close();
          if (fs.existsSync(dest + ".tmp")) fs.unlinkSync(dest + ".tmp");
          reject(err);
        });
        req.on("timeout", () => {
          req.destroy();
          file.close();
          if (fs.existsSync(dest + ".tmp")) fs.unlinkSync(dest + ".tmp");
          reject(new Error(`Timeout downloading ${url}`));
        });
      });
      return; // success
    } catch (err: any) {
      const isLast = attempt === retries;
      if (isLast) throw err;
      console.warn(
        `  ⚠  Attempt ${attempt}/${retries} failed: ${err.message} — retrying…`,
      );
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

// ── Source registry ────────────────────────────────────────────────────────────

function loadSources(): Record<string, any> {
  if (fs.existsSync(SOURCES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveSources(registry: Record<string, any>) {
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(registry, null, 2), "utf-8");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📥  Research Data Downloader");
  console.log(`    Force re-download: ${FORCE}`);
  console.log("");

  ensureDir(RAW_NHANES);
  ensureDir(RAW_PAPERS);

  const registry = loadSources();
  let downloaded = 0,
    skipped = 0,
    failed = 0;

  for (const src of SOURCES) {
    const exists = fs.existsSync(src.localPath);
    if (exists && !FORCE) {
      const size = (fs.statSync(src.localPath).size / 1024).toFixed(0);
      console.log(`  ⏭  ${src.id} — already exists (${size} KB), skipping`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ⬇  ${src.id} — downloading…`);
    try {
      await downloadFile(src.url, src.localPath);
      const size = (fs.statSync(src.localPath).size / 1024).toFixed(0);
      console.log(` ✅  ${size} KB`);

      registry[src.id] = {
        ...src,
        localPath: path.relative(process.cwd(), src.localPath),
        processedPath: null,
        downloadedAt: new Date().toISOString(),
      };
      saveSources(registry);
      downloaded++;
    } catch (err: any) {
      console.log(` ❌  FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log("");
  console.log(
    `✅  Done — downloaded: ${downloaded}, skipped: ${skipped}, failed: ${failed}`,
  );
  console.log(`📋  Registry: ${SOURCES_FILE}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("❌  Fatal:", err.message);
  process.exit(1);
});
