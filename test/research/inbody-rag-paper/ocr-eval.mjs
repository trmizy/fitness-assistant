// InBody report extraction experiment: several vision-language models read real InBody270 printouts.
// Usage: node test/research/inbody-rag-paper/ocr-eval.mjs [--run-id X] [--repeats 1] [--models a,b]
// Images: test/inbody_duy/*.jpg (real printouts; contain personal IDs -> never copy images or IDs into results/paper).
// Output: results/ocr-<runId>/raw.jsonl. The image file name is replaced by a short hash id (img-xxxxxxxx).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const RUN_ID = arg("--run-id", new Date().toISOString().replace(/[-:]/g, "").slice(0, 15));
const REPEATS = Number(arg("--repeats", "1"));
const MODELS = arg("--models", "global.anthropic.claude-sonnet-4-6,global.anthropic.claude-haiku-4-5-20251001-v1:0,apac.amazon.nova-pro-v1:0,apac.amazon.nova-lite-v1:0").split(",");
const IMG_DIR = path.join(root, "test/inbody_duy");

process.env.AWS_PROFILE ||= "divuzha"; process.env.AWS_SDK_LOAD_CONFIG = "1";
const req = createRequire(path.join(root, "backend/services/ai-service/package.json"));
const { BedrockRuntimeClient, ConverseCommand } = req("@aws-sdk/client-bedrock-runtime");
const br = new BedrockRuntimeClient({ region: "ap-southeast-1", maxAttempts: 8 });

// Production prompt (user-service inbody-vision.service.ts EXTRACTION_PROMPT) + the extended fields this study adds.
const PROMPT = "Extract all body composition metrics from this InBody report. IMPORTANT: Also extract the measurement_date printed on the report (the date when the test was taken) — it may appear near the patient name, header, or footer in formats like YYYY.MM.DD, MM/DD/YYYY, or similar. Convert it to YYYY-MM-DD format. The Segmental Lean Analysis and Segmental Fat Analysis sections show a body silhouette with kg values labeled per body part (right arm, left arm, trunk, right leg, left leg). Use null for any value that is not visible or cannot be read. Respond with ONLY the JSON object matching the schema — no extra commentary.";
const num = (d) => ({ type: ["number", "null"], description: d });
const seg = (d) => ({ type: "object", description: d, properties: { right_arm: num("kg"), left_arm: num("kg"), trunk: num("kg"), right_leg: num("kg"), left_leg: num("kg") }, required: ["right_arm", "left_arm", "trunk", "right_leg", "left_leg"] });
const SCHEMA = {
  type: "object",
  properties: {
    measurement_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    weight: num("Total body weight in kg"), height: num("Height in cm"),
    skeletal_muscle_mass: num("Skeletal muscle mass in kg"), body_fat_mass: num("Body fat mass in kg"),
    // ---- extended fields (not in the production schema) ----
    percent_body_fat: num("PBF, percent body fat (%)"), fat_free_mass: num("Fat Free Mass in kg (Research Parameters)"),
    basal_metabolic_rate: num("Basal Metabolic Rate in kcal (Research Parameters), the measured value, not the reference range"),
    visceral_fat_level: num("Visceral Fat Level (unitless level)"),
    segmental_lean_analysis: seg("Lean (muscle) mass per body segment in kg from the silhouette chart"),
    segmental_fat_analysis: seg("Fat mass per body segment in kg from the silhouette chart"),
  },
  required: ["measurement_date", "weight", "height", "skeletal_muscle_mass", "body_fat_mass", "percent_body_fat", "fat_free_mass", "basal_metabolic_rate", "visceral_fat_level", "segmental_lean_analysis", "segmental_fat_analysis"],
};

const images = fs.readdirSync(IMG_DIR).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
const idOf = (f) => "img-" + crypto.createHash("sha256").update(fs.readFileSync(path.join(IMG_DIR, f))).digest("hex").slice(0, 8);
const outDir = path.join(here, "results", `ocr-${RUN_ID}`);
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "raw.jsonl");
const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).key) : []);
// Local-only mapping image id -> file name (kept out of anything that goes into the paper).
fs.writeFileSync(path.join(outDir, "image-map.local.json"), JSON.stringify(Object.fromEntries(images.map((f) => [idOf(f), f])), null, 2));

async function extract(model, file) {
  const bytes = fs.readFileSync(path.join(IMG_DIR, file));
  const t0 = Date.now();
  const r = await br.send(new ConverseCommand({
    modelId: model,
    messages: [{ role: "user", content: [{ image: { format: /\.png$/i.test(file) ? "png" : "jpeg", source: { bytes } } }, { text: PROMPT }] }],
    toolConfig: { tools: [{ toolSpec: { name: "extract_inbody_metrics", description: "Extract all numeric measurements from an InBody body composition report image.", inputSchema: { json: SCHEMA } } }], toolChoice: { any: {} } },
    inferenceConfig: { maxTokens: 1200, temperature: 0 },
  }));
  const tool = r.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
  return { output: tool?.input ?? null, raw: tool ? null : r.output?.message?.content?.map((c) => c.text ?? "").join("").slice(0, 500), inTok: r.usage?.inputTokens ?? 0, outTok: r.usage?.outputTokens ?? 0, ms: Date.now() - t0 };
}

const jobs = [];
for (let rep = 1; rep <= REPEATS; rep++) for (const m of MODELS) for (const f of images) { const key = `${rep}|${m}|${idOf(f)}`; if (!done.has(key)) jobs.push({ key, rep, m, f }); }
console.log(`ocr run ${RUN_ID}: ${jobs.length} jobs, ${images.length} images, models ${MODELS.join(", ")}`);
const out = fs.createWriteStream(outFile, { flags: "a" });
let next = 0, ok = 0, bad = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const j = jobs[next++];
    let res = null, err = null;
    for (let a = 1; a <= 3 && !res; a++) { try { res = await extract(j.m, j.f); } catch (e) { err = `${e?.name}: ${e?.message}`; await new Promise((r) => setTimeout(r, 3000 * a)); } }
    out.write(JSON.stringify({ key: j.key, rep: j.rep, model: j.m, image: idOf(j.f), ...(res ?? { output: null, error: err }), at: new Date().toISOString() }) + "\n");
    res ? ok++ : bad++;
    if (!res) console.error(`FAIL ${j.key} ${err}`);
  }
}));
out.end();
console.log(`done ok=${ok} failed=${bad} -> ${outFile}`);
