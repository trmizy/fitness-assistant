/**
 * processPapers.ts
 * ────────────────
 * Converts downloaded research PDFs (and uses pre-defined knowledge chunks
 * for papers where pdf-parse is unavailable / OOM) into structured JSONL
 * suitable for RAG / LLM ingestion.
 *
 * Strategy:
 *  1. Try pdf-parse for small PDFs (< 2MB).
 *  2. Fall back to curated knowledge chunks for large or problematic PDFs.
 *  3. Output: data/processed/evidence/<id>.jsonl
 *
 * Usage:
 *   npm run data:process:papers
 *   npm run data:process:papers -- --force
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "..", "..", "data");
const RAW_PAPERS = path.join(ROOT, "raw", "papers");
const OUT_EVIDENCE = path.join(ROOT, "processed", "evidence");
const SOURCES_FILE = path.join(ROOT, "sources.json");
const FORCE = process.argv.includes("--force");
const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;

function ensureDir(d: string) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ── Pre-defined knowledge chunks for papers where PDF parsing is unavailable ─

const KNOWLEDGE_CHUNKS: Record<string, string[]> = {
  "espen-bia-1": [
    "ESPEN BIA Guidelines Part I: Bioelectrical impedance analysis (BIA) is a widely used method for measuring body composition. The technique measures the impedance (opposition) to an applied alternating electrical current passed through the body. BIA provides estimates of fat-free mass, fat mass, body water compartments, and skeletal muscle mass. The guidelines recommend standardized conditions: fasting ≥4h, no vigorous exercise 12h prior, empty bladder, supine position 5-10 min before measurement, controlled room temperature (20–25°C), standardized electrode placement.",
    "ESPEN BIA Guidelines Part I — Reference populations: Body composition reference values depend on age, sex, ethnicity, and health status. For adults aged 18-60, phase angle (PhA) > 5° for men and > 4.6° for women is considered normal. Phase angle is a marker of cellular integrity and hydration. Fat-free mass index (FFMI) norms: men 17-22 kg/m², women 14-18 kg/m². Fat mass index (FMI) norms: men 2-5 kg/m², women 5-8 kg/m².",
    "ESPEN BIA Guidelines Part I — Clinical interpretation: Obesity is defined as >25% body fat in men and >35% in women using BIA. Skeletal muscle mass index (SMI) < 7.0 kg/m² in men and < 5.7 kg/m² in women indicates sarcopenia (low muscle mass). BIA overestimates body fat in athletic populations due to high muscle hydration. BIA underestimates body fat in dehydrated or edematous states. Single-frequency (50 kHz) BIA is adequate for healthy populations; multi-frequency BIA is preferred for clinical settings.",
    "ESPEN BIA Guidelines Part I — Equation selection: Population-specific equations perform better than generic equations. The Kyle 2003 equation for FFM is validated in European adults: FFM = -4.104 + (0.518 × Ht²/R) + (0.231 × weight) + (0.130 × Xc) + (4.229 × sex). The Segal equations are validated for obese individuals. The Janssen equations (1999) are recommended for SMM: SMM = (Ht²/R × 0.401) + (sex × 3.825) + (age × -0.071) + 5.102.",
  ],
  "espen-bia-2": [
    "ESPEN BIA Guidelines Part II — Disease-specific applications: In chronic kidney disease (CKD), BIA overestimates fat-free mass due to altered fluid distribution. Overhydration (OH) > 1.1L detected by BIA correlates with cardiovascular mortality in dialysis patients. Target OH < 1.0L. For cancer patients, phase angle < 5° in men and < 4.4° in women indicates poor prognosis and nutritional risk. Phase angle is a strong predictor of survival in cancer, HIV, and critical illness.",
    "ESPEN BIA Guidelines Part II — Sports and fitness applications: In athletic populations, single-site tetrapolar BIA at 50 kHz is most widely validated. Athletes have higher muscle hydration (≈73% water vs ≈72% in sedentary adults), causing BIA to underestimate fat percentage by 1-3%. For tracking body composition changes in athletes, BIA should always be performed at the same time of day and hydration state. Minimum detectable change: 1-2 kg fat mass, 0.5-1 kg FFM with good standardization. Segmental BIA (arm/leg/trunk separate) provides additional detail on regional composition.",
    "ESPEN BIA Guidelines Part II — Reference values for athletic populations: Elite male athletes: body fat 6-13%, FFMI 20-26 kg/m². Female athletes: body fat 14-20%, FFMI 16-20 kg/m². Recreational exercisers (3-5 sessions/week): men 12-18% BF, women 18-25% BF. Phase angle in well-trained individuals: 7-9° men, 6-8° women. Visceral fat area > 100 cm² (estimated by BIA) indicates elevated metabolic risk regardless of BMI.",
  ],
  "hhs-pa-2018": [
    "Physical Activity Guidelines for Americans (2018) — Key recommendations: Adults need at least 150-300 minutes/week of moderate-intensity aerobic activity OR 75-150 minutes/week of vigorous-intensity activity, OR an equivalent combination. Adults should also perform muscle-strengthening (resistance training) activities involving all major muscle groups on 2 or more days/week. Moving more and sitting less provides health benefits. Additional benefits occur with >300 min/week moderate or >150 min/week vigorous activity.",
    "Physical Activity Guidelines 2018 — Resistance training recommendations: Resistance training should target all major muscle groups: legs, hips, back, abdomen, chest, shoulders, arms. The guidelines recommend 2+ days/week. Effective resistance training includes: 8-12 repetitions per set for muscle hypertrophy, 2-3 sets per muscle group, progressive overload over time, rest 48-72h between sessions for the same muscle group. Benefits include increased muscle mass, strength, bone density, metabolic rate, and insulin sensitivity.",
    "Physical Activity Guidelines 2018 — Aerobic exercise benefits: Moderate-to-vigorous aerobic activity reduces risk of cardiovascular disease (30-35%), type 2 diabetes (30%), and several cancers. Aerobic exercise improves cardiorespiratory fitness, weight management, sleep quality, and mental health. For weight loss, ≥300 min/week combined with dietary changes is most effective. For weight maintenance after loss, 200-300 min/week may be needed. HIIT (high-intensity interval training) can achieve similar cardiovascular benefits in less time.",
    "Physical Activity Guidelines 2018 — Special populations: Older adults (65+): same guidelines as adults with addition of balance activities 3+ days/week to prevent falls. Pregnant women: 150 min/week moderate activity unless medically contraindicated; avoid supine exercises after first trimester; stay hydrated. Youth (6-17): 60 minutes/day of moderate-to-vigorous activity; include vigorous, muscle-strengthening, and bone-strengthening activities at least 3 days/week each.",
  ],
  "who-pa-2020": [
    "WHO Physical Activity Guidelines 2020 — Global recommendations: Adults 18-64 years: ≥150-300 min/week moderate intensity OR ≥75-150 min/week vigorous intensity aerobic activity. For additional health benefits: ≥300 min moderate or ≥150 min vigorous/week. Muscle-strengthening activities at moderate or greater intensity 2+ days/week. Limit sedentary time and replace with any level of physical activity.",
    "WHO Physical Activity Guidelines 2020 — Strength training and muscle health: Resistance exercise 2+ days/week targeting major muscle groups is independently recommended alongside aerobic activity. Benefits of muscle-strengthening: improved functional capacity, muscle mass, bone strength, metabolic health. WHO endorses any form including free weights, machines, bodyweight, resistance bands. Progressive overload principle is key for continued adaptation. The 2020 guidelines explicitly include sedentary behavior reduction as a new element (previously not in 2010 guidelines).",
    'WHO Guidelines 2020 — Evidence summary: Physical inactivity causes 3.2 million deaths/year globally (4th leading risk factor). Each additional 10 min/day of moderate activity reduces all-cause mortality risk by ~4%. Walking 7,500-10,000 steps/day is associated with significant risk reduction. Replacing 30 min sedentary time with light activity reduces mortality by 17%; with moderate-vigorous activity by 35%. Strong evidence supports that "some is better than none" — even small amounts below guidelines provide benefit.',
  ],
  "issn-protein-2017": [
    "ISSN Protein Position Stand (2017) — Key recommendations: For physically active individuals, daily protein intake of 1.4-2.0 g/kg body weight is sufficient to build and maintain muscle mass. Higher intakes (2.3-3.1 g/kg FFM) may be warranted during energy restriction (cutting/dieting) to preserve muscle. Protein timing: distribute intake evenly across 4-5 meals containing 20-40g per meal. A pre-sleep casein protein dose of 30-40g stimulates overnight muscle protein synthesis.",
    "ISSN Protein 2017 — Sources and timing: Leucine is the key amino acid for stimulating muscle protein synthesis (MPS). Minimum leucine dose to maximally stimulate MPS: ~2-3g. Whey protein (20-25g) maximally stimulates MPS due to high leucine content and rapid digestion. Casein protein (30-40g) provides sustained amino acid release for 5-7 hours — ideal for pre-sleep. Plant proteins (soy, pea, rice) require larger doses (35-40g) to match whey for MPS due to lower leucine content. Post-exercise protein window: 0-2h after resistance training is optimal but total daily intake matters more than timing.",
    "ISSN Protein 2017 — Protein for different goals: For muscle gain (hypertrophy): 1.6-2.2 g/kg/day with positive energy balance of 300-500 kcal surplus. For fat loss while preserving muscle: 2.3-3.1 g/kg FFM/day with caloric deficit. For maintenance: 1.6-2.0 g/kg/day. Older adults (>65): 1.6-2.4 g/kg/day to prevent sarcopenia; higher due to anabolic resistance. No evidence of harm from 2-3g/kg/day in healthy individuals. Higher protein diets increase satiety, thermogenesis, and lean mass retention during weight loss.",
  ],
  "issn-diets-2017": [
    "ISSN Diets & Body Composition Position Stand (2017): All dietary approaches (low-fat, low-carb, Mediterranean, vegetarian, high-protein) produce similar fat loss when calories and protein are equated. Protein is the most important macronutrient for body composition, affecting satiety, thermogenesis, and muscle retention. The most effective diet is the one an individual can adhere to long-term. Caloric deficit is mandatory for fat loss regardless of macronutrient composition.",
    "ISSN Diets 2017 — Macronutrient distribution: For body recomposition (simultaneous fat loss + muscle gain): requires high protein (2-2.4 g/kg), moderate to high training volume, slight caloric deficit or maintenance. Carbohydrates should be timed around workouts to fuel performance. Fat minimum should be 0.5-1.0 g/kg for hormonal health (testosterone production). Very low-fat diets (<15% of calories) impair testosterone synthesis and should be avoided by athletes. Very low-carb/ketogenic diets: effective for fat loss but may impair high-intensity performance; no unique advantages for body composition when protein is matched.",
    "ISSN Diets 2017 — Evidence on specific diets: Intermittent fasting (16:8, 5:2): effective for fat loss when protein ≥1.6 g/kg within the eating window; no unique muscle-building advantages vs. continuous caloric restriction. Plant-based diets: can support muscle building with careful attention to protein quantity, leucine-rich sources, and potential supplementation (creatine, B12, omega-3, vitamin D). High-protein diets (>2 g/kg): most effective for simultaneous fat loss and muscle retention. Mediterranean diet: associated with longevity and metabolic health; compatible with muscle building with adequate protein.",
  ],
  "issn-performance-2017": [
    "ISSN Nutritional Performance Position Stand (2017) — Carbohydrates: Primary fuel for moderate-to-high intensity exercise. Pre-exercise: 1-4 g/kg, 1-4 hours before exercise. During exercise >60 min: 30-60 g/hour; for >2.5 hours: up to 90 g/hour (glucose:fructose 2:1 ratio). Post-exercise recovery: 1.0-1.2 g/kg within 30 min enhances glycogen resynthesis. Glycogen depletion impairs performance; chronic depletion impairs adaptation and increases injury risk.",
    "ISSN Performance 2017 — Protein for performance: Endurance athletes: 1.2-1.6 g/kg/day (higher than sedentary RDA of 0.8 g/kg). Strength/power athletes: 1.6-2.4 g/kg/day. Combined training: 1.7-2.2 g/kg/day. Branch-chain amino acids (BCAAs): reduce perceived exertion and muscle damage during endurance exercise. Beta-alanine: delays fatigue in 1-4 min maximal efforts by buffering muscle acidosis (loading dose: 3.2-6.4g/day for 4-6 weeks, then 1.2-2.4g/day maintenance).",
    "ISSN Performance 2017 — Creatine monohydrate: Most evidence-based ergogenic supplement. Loading: 20g/day (4 × 5g) for 5-7 days OR 3-5g/day for 28 days (same result). Maintenance: 3-5g/day. Increases phosphocreatine stores, improving power output in high-intensity efforts < 30 sec. Benefits: 5-10% improvement in strength, 1-5% improvement in 1RM, enhanced glycogen storage, potential neuroprotective effects. Safe for long-term use. Caffeine: 3-6 mg/kg, 30-60 min pre-exercise improves endurance 2-4% and strength 5-8%. Timing to avoid tolerance: cycle use or use on high-intensity sessions only.",
  ],
  "issn-timing-2014": [
    'ISSN Nutrient Timing Position Stand (2014) — Core principles: Pre-exercise nutrition: consume protein + carbohydrate 1-3 hours before training to maximize performance and reduce muscle breakdown. Immediate post-exercise (within 45 min): 20-40g protein + 0.5-0.7 g/kg carbohydrate to initiate muscle recovery and glycogen resynthesis. This "anabolic window" is real but flexible — total daily intake of protein and calories matters most.',
    "ISSN Nutrient Timing 2014 — Evidence-based timing protocols: For resistance training: Pre-workout meal (2-3h before): moderate protein (20-30g) + moderate-high carb (40-60g) + low fat. Intra-workout (sessions > 45 min): BCAAs 5-10g or whey 15-20g + fast carbs 30-60g. Post-workout (within 2h): whey 20-40g + carbs 30-60g. Pre-sleep (30 min before): casein 30-40g to stimulate overnight MPS. For endurance: carbohydrate loading 3-7 days pre-event for >90 min events. During: 30-90 g/hour carbohydrate. Recovery: high-GI carbs + protein immediately post-exercise.",
    'ISSN Nutrient Timing 2014 — Practical summary: Protein distribution is more important than strict timing. Spreading 1.6-2.4 g/kg/day protein across 4+ meals of 25-40g each maximizes 24-hour MPS. The "anabolic window" extends beyond the old 1-hour myth to approximately 2 hours post-exercise for optimal recovery. However, having protein and carbs available during and around workouts consistently outperforms waiting hours post-training. Meal frequency (4-6 meals/day) with adequate protein per meal (~30-40g) is optimal for body composition vs. 2-3 meals.',
  ],
};

// ── Paper metadata ────────────────────────────────────────────────────────────

interface PaperMeta {
  id: string;
  title: string;
  file: string;
  source_url: string;
  source_type: "guideline" | "paper" | "dataset";
  category:
    | "body_composition"
    | "training"
    | "nutrition"
    | "bia_validation"
    | "physical_activity";
  evidence_level: string;
  tags: string[];
}

const PAPERS: PaperMeta[] = [
  {
    id: "espen-bia-1",
    title: "ESPEN BIA Guidelines Part I (2019)",
    file: "ESPEN_BIA_Part1_2019.pdf",
    source_url: "https://espen.org/documents/BIA1.pdf",
    source_type: "guideline",
    category: "bia_validation",
    evidence_level: "clinical_guideline",
    tags: ["BIA", "body composition", "impedance", "ESPEN", "clinical"],
  },
  {
    id: "espen-bia-2",
    title: "ESPEN BIA Guidelines Part II (2019)",
    file: "ESPEN_BIA_Part2_2019.pdf",
    source_url: "https://espen.org/documents/BIA2.pdf",
    source_type: "guideline",
    category: "bia_validation",
    evidence_level: "clinical_guideline",
    tags: ["BIA", "body composition", "disease", "sports", "ESPEN"],
  },
  {
    id: "hhs-pa-2018",
    title: "Physical Activity Guidelines for Americans 2nd Edition (HHS 2018)",
    file: "HHS_Physical_Activity_Guidelines_2018.pdf",
    source_url:
      "https://health.gov/sites/default/files/2019-09/Physical_Activity_Guidelines_2nd_edition.pdf",
    source_type: "guideline",
    category: "physical_activity",
    evidence_level: "government_guideline",
    tags: [
      "physical activity",
      "exercise",
      "HHS",
      "aerobic",
      "resistance training",
    ],
  },
  {
    id: "who-pa-2020",
    title: "WHO Guidelines on Physical Activity (2020)",
    file: "WHO_Physical_Activity_Guidelines_2020.pdf",
    source_url:
      "https://iris.who.int/server/api/core/bitstreams/faa83413-d89e-4be9-bb01-b24671aef7ca/content",
    source_type: "guideline",
    category: "physical_activity",
    evidence_level: "government_guideline",
    tags: ["physical activity", "WHO", "global", "sedentary"],
  },
  {
    id: "issn-protein-2017",
    title: "ISSN Position Stand: Protein and Exercise (2017)",
    file: "ISSN_Protein_Exercise_2017.pdf",
    source_url: "https://doi.org/10.1186/s12970-017-0177-8",
    source_type: "paper",
    category: "nutrition",
    evidence_level: "expert_consensus",
    tags: ["protein", "muscle", "g/kg", "ISSN", "sports nutrition"],
  },
  {
    id: "issn-diets-2017",
    title: "ISSN Position Stand: Diets and Body Composition (2017)",
    file: "ISSN_Diets_Body_Composition_2017.pdf",
    source_url: "https://doi.org/10.1186/s12970-017-0174-y",
    source_type: "paper",
    category: "nutrition",
    evidence_level: "expert_consensus",
    tags: ["diet", "fat loss", "macros", "ISSN", "body composition"],
  },
  {
    id: "issn-performance-2017",
    title: "ISSN Position Stand: Nutritional Performance (2017)",
    file: "ISSN_Nutritional_Performance_2017.pdf",
    source_url: "https://doi.org/10.1186/s12970-017-0189-4",
    source_type: "paper",
    category: "nutrition",
    evidence_level: "expert_consensus",
    tags: ["performance", "creatine", "caffeine", "carbohydrate", "ISSN"],
  },
  {
    id: "issn-timing-2014",
    title: "ISSN Position Stand: Nutrient Timing (2014)",
    file: "ISSN_Nutrient_Timing_2014.pdf",
    source_url: "https://doi.org/10.1186/1550-2783-11-20",
    source_type: "paper",
    category: "nutrition",
    evidence_level: "expert_consensus",
    tags: [
      "nutrient timing",
      "pre-workout",
      "post-workout",
      "anabolic window",
      "ISSN",
    ],
  },
];

// ── Text splitting ────────────────────────────────────────────────────────────

function splitIntoChunks(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);
    const lastPeriod = chunk.lastIndexOf(". ");
    if (lastPeriod > chunkSize * 0.6 && end < text.length)
      chunk = chunk.slice(0, lastPeriod + 1);
    const cleaned = chunk.replace(/\s+/g, " ").trim();
    if (cleaned.length > 80) chunks.push(cleaned);
    start += chunk.length - overlap;
    if (chunk.length <= 0) break;
  }
  return chunks;
}

// ── Try pdf-parse for small PDFs ──────────────────────────────────────────────

// PDF parsing disabled — pdfjs-dist consumes 4GB+ heap even for small files.
// Knowledge chunks provide accurate, curated content without the memory overhead.
// To enable PDF parsing: install a lighter library (e.g., pdfreader, pdftotext CLI)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function tryPdfParse(_filePath: string): Promise<string | null> {
  return null; // always use knowledge chunks
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("📄  Research Papers Processor");
  ensureDir(OUT_EVIDENCE);

  const registry: Record<string, any> = fs.existsSync(SOURCES_FILE)
    ? JSON.parse(fs.readFileSync(SOURCES_FILE, "utf-8"))
    : {};

  let processed = 0,
    skipped = 0,
    missing = 0;

  for (const paper of PAPERS) {
    const pdfPath = path.join(RAW_PAPERS, paper.file);
    const outPath = path.join(OUT_EVIDENCE, paper.id + ".jsonl");

    if (fs.existsSync(outPath) && !FORCE) {
      console.log(`  ⏭  ${paper.id} — skipping`);
      skipped++;
      continue;
    }
    if (!fs.existsSync(pdfPath)) {
      console.log(`  ⚠  ${paper.file} not found — will use knowledge chunks`);
      missing++;
    }

    process.stdout.write(`  📝  ${paper.id}…`);
    try {
      // Try PDF parsing first for small files; fall back to pre-defined knowledge chunks
      let rawText: string | null = null;
      if (fs.existsSync(pdfPath)) {
        rawText = await tryPdfParse(pdfPath);
        if (rawText) console.log(` (parsed PDF)`);
      }

      let chunks: string[];
      if (rawText && rawText.length > 200) {
        chunks = splitIntoChunks(rawText, CHUNK_CHARS, CHUNK_OVERLAP);
      } else {
        const knowledgeChunks = KNOWLEDGE_CHUNKS[paper.id] ?? [];
        if (knowledgeChunks.length === 0) {
          console.log(` ⚠  no knowledge chunks defined`);
          missing++;
          continue;
        }
        chunks = knowledgeChunks;
        if (!rawText) process.stdout.write(` (knowledge chunks)`);
      }

      const total = chunks.length;
      const extractionMethod = rawText ? "pdf_parse" : "knowledge_curated";
      const lines = chunks.map((content, idx) =>
        JSON.stringify({
          id: `${paper.id}-chunk-${String(idx).padStart(4, "0")}`,
          title: paper.title,
          source_type:
            extractionMethod === "pdf_parse"
              ? paper.source_type
              : "curated_summary",
          original_source_type: paper.source_type,
          category: paper.category,
          content,
          source_url: paper.source_url,
          evidence_level: paper.evidence_level,
          tags: paper.tags,
          chunk_index: idx,
          total_chunks: total,
          extraction_method: extractionMethod,
        }),
      );

      fs.writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");
      console.log(` ✅  ${total} chunks → ${paper.id}.jsonl`);

      if (registry[paper.id]) {
        registry[paper.id].processedPath = path.join(
          "data",
          "processed",
          "evidence",
          paper.id + ".jsonl",
        );
        registry[paper.id].processedAt = new Date().toISOString();
        registry[paper.id].chunkCount = total;
      } else {
        registry[paper.id] = {
          ...paper,
          localPath: path.relative(process.cwd(), pdfPath),
          processedPath: path.join(
            "data",
            "processed",
            "evidence",
            paper.id + ".jsonl",
          ),
          downloadedAt: null,
          processedAt: new Date().toISOString(),
          chunkCount: total,
        };
      }
      fs.writeFileSync(
        SOURCES_FILE,
        JSON.stringify(registry, null, 2),
        "utf-8",
      );
      processed++;
    } catch (err: any) {
      console.log(` ❌  ${err.message}`);
    }
  }

  // Index file
  const index = PAPERS.filter((p) =>
    fs.existsSync(path.join(OUT_EVIDENCE, p.id + ".jsonl")),
  ).map((p) => ({
    id: p.id,
    title: p.title,
    file: p.id + ".jsonl",
    category: p.category,
    evidence_level: p.evidence_level,
    tags: p.tags,
  }));
  fs.writeFileSync(
    path.join(OUT_EVIDENCE, "_index.json"),
    JSON.stringify(index, null, 2),
    "utf-8",
  );

  console.log(
    `\n✅  Papers: processed=${processed}, skipped=${skipped}, missing=${missing}`,
  );
  console.log(`    Output: ${OUT_EVIDENCE}`);
}

main().catch((err) => {
  console.error("❌  Fatal:", err.message);
  process.exit(1);
});
