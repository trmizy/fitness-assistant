import Anthropic from "@anthropic-ai/sdk";
import axios, { AxiosError } from "axios";
import fs from "fs";
import path from "path";
import { logger } from "@gym-coach/shared";

export interface VisionResult {
  measurement_date: string | null; // ISO date string "YYYY-MM-DD" extracted from the report
  weight: number | null;
  height: number | null;
  skeletal_muscle_mass: number | null;
  body_fat_mass: number | null;
  segmental_lean_analysis: {
    right_arm: number | null;
    left_arm: number | null;
    trunk: number | null;
    right_leg: number | null;
    left_leg: number | null;
  };
  segmental_fat_analysis: {
    right_arm: number | null;
    left_arm: number | null;
    trunk: number | null;
    right_leg: number | null;
    left_leg: number | null;
  };
}

const SEGMENT_KEYS = ["right_arm", "left_arm", "trunk", "right_leg", "left_leg"] as const;

// Shared between Claude (as a tool's input_schema) and Ollama (as a
// structured-output `format` schema — supported since Ollama 0.5, confirmed
// against the 0.30.5 build this project runs). One schema, two callers, so
// the two providers can never silently drift into different output shapes.
const INBODY_JSON_SCHEMA = {
  type: "object",
  properties: {
    measurement_date: {
      type: ["string", "null"],
      description:
        'The measurement/test date printed on the InBody report. Format: YYYY-MM-DD. Look for dates like "2024.05.01", "05/01/2024", "01-05-2024", or any printed date near the patient name or header. Return null if not visible.',
    },
    weight: { type: ["number", "null"], description: "Total body weight in kg" },
    height: { type: ["number", "null"], description: "Height in cm" },
    skeletal_muscle_mass: {
      type: ["number", "null"],
      description: "Skeletal muscle mass in kg",
    },
    body_fat_mass: { type: ["number", "null"], description: "Body fat mass in kg" },
    segmental_lean_analysis: {
      type: "object",
      description:
        "Lean (muscle) mass per body segment in kg from the silhouette chart",
      properties: {
        right_arm: { type: ["number", "null"], description: "kg, expected 0.5-10" },
        left_arm: { type: ["number", "null"], description: "kg, expected 0.5-10" },
        trunk: { type: ["number", "null"], description: "kg, expected 10-60" },
        right_leg: { type: ["number", "null"], description: "kg, expected 3-20" },
        left_leg: { type: ["number", "null"], description: "kg, expected 3-20" },
      },
      required: [...SEGMENT_KEYS],
    },
    segmental_fat_analysis: {
      type: "object",
      description: "Fat mass per body segment in kg from the silhouette chart",
      properties: {
        right_arm: { type: ["number", "null"], description: "kg, expected 0-10" },
        left_arm: { type: ["number", "null"], description: "kg, expected 0-10" },
        trunk: { type: ["number", "null"], description: "kg, expected 0-50" },
        right_leg: { type: ["number", "null"], description: "kg, expected 0-15" },
        left_leg: { type: ["number", "null"], description: "kg, expected 0-15" },
      },
      required: [...SEGMENT_KEYS],
    },
  },
  required: [
    "measurement_date",
    "weight",
    "height",
    "skeletal_muscle_mass",
    "body_fat_mass",
    "segmental_lean_analysis",
    "segmental_fat_analysis",
  ],
} as const;

const INBODY_TOOL: Anthropic.Tool = {
  name: "extract_inbody_metrics",
  description:
    "Extract all numeric measurements from an InBody body composition report image.",
  // Anthropic.Tool's input_schema type wants a plain JSON-schema object;
  // the `as const` tuple types above are structurally compatible but not
  // nominally identical, so this needs an explicit cast rather than a
  // second copy of the schema.
  input_schema: INBODY_JSON_SCHEMA as unknown as Anthropic.Tool.InputSchema,
};

const EXTRACTION_PROMPT =
  "Extract all body composition metrics from this InBody report. IMPORTANT: Also extract the measurement_date printed on the report (the date when the test was taken) — it may appear near the patient name, header, or footer in formats like YYYY.MM.DD, MM/DD/YYYY, or similar. Convert it to YYYY-MM-DD format. The Segmental Lean Analysis and Segmental Fat Analysis sections show a body silhouette with kg values labeled per body part (right arm, left arm, trunk, right leg, left leg). Use null for any value that is not visible or cannot be read. Respond with ONLY the JSON object matching the schema — no extra commentary.";

// Product decision (2026-09-01): InBody extraction defaults to a LOCAL
// vision model via Ollama, not the Claude API — no image or health data
// leaves the machine unless a caller explicitly opts back into
// INBODY_VISION_PROVIDER=anthropic. This mirrors ai-service's own
// LLM_PROVIDER default (`ollama`) and reuses the SAME Ollama instance/env
// vars (LLM_BASE_URL/OLLAMA_BASE_URL) already documented in .env.example —
// no second Ollama deployment to stand up.
const INBODY_VISION_PROVIDER = (process.env.INBODY_VISION_PROVIDER || "ollama").toLowerCase();

// qwen2.5vl:3b default — chosen for running CPU-only on a modest dev
// machine (no GPU passthrough into the `ollama` container by default;
// verified via `docker exec gymcoach-ollama nvidia-smi` failing). It has
// materially better OCR/document-chart reading than llava/moondream at a
// similar size, which matters here: the InBody report is a mix of a
// numbers table AND a segmental-analysis body silhouette chart, not plain
// text. Override with a larger model (qwen2.5vl:7b, llama3.2-vision:11b,
// minicpm-v) via INBODY_VISION_OLLAMA_MODEL if the host has a GPU or more
// patience — accuracy on a health-data extraction task should win over
// speed once the hardware allows it.
const OLLAMA_VISION_MODEL = process.env.INBODY_VISION_OLLAMA_MODEL || "qwen2.5vl:3b";
const OLLAMA_BASE_URL =
  process.env.INBODY_VISION_OLLAMA_BASE_URL ||
  process.env.OLLAMA_BASE_URL ||
  process.env.LLM_BASE_URL ||
  "http://host.docker.internal:11434";
const OLLAMA_VISION_TIMEOUT_MS = Number(process.env.INBODY_VISION_OLLAMA_TIMEOUT_MS) || 150_000;

function toFiniteNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function normalizeSegment(value: unknown): VisionResult["segmental_lean_analysis"] {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const out = {} as VisionResult["segmental_lean_analysis"];
  for (const key of SEGMENT_KEYS) out[key] = toFiniteNumberOrNull(source[key]);
  return out;
}

// Local models — even a good one like qwen2.5vl — are far more likely than
// Claude's forced tool-use to drop a key, return a numeric value as a
// string, or wrap the JSON in markdown fences despite the prompt asking
// otherwise. Claude's response never needed this because tool_use.input is
// already schema-validated server-side by Anthropic; Ollama's `format`
// schema is a strong steering hint, not a hard guarantee, so this app
// re-validates on the way in rather than trusting either provider blindly.
function normalizeVisionResult(raw: unknown): VisionResult {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const date = typeof source.measurement_date === "string" ? source.measurement_date : null;
  return {
    measurement_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : date ?? null,
    weight: toFiniteNumberOrNull(source.weight),
    height: toFiniteNumberOrNull(source.height),
    skeletal_muscle_mass: toFiniteNumberOrNull(source.skeletal_muscle_mass),
    body_fat_mass: toFiniteNumberOrNull(source.body_fat_mass),
    segmental_lean_analysis: normalizeSegment(source.segmental_lean_analysis),
    segmental_fat_analysis: normalizeSegment(source.segmental_fat_analysis),
  };
}

function extractJsonPayload(content: string): unknown {
  // Ollama's `format` schema keeps this to a bare JSON object in practice,
  // but strip a markdown code fence defensively — a smaller local model is
  // more prone to it than a hosted frontier model would be.
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = fenced ? fenced[1] : content;
  return JSON.parse(jsonText);
}

async function extractWithOllama(base64Data: string): Promise<VisionResult> {
  let response;
  try {
    response = await axios.post(
      `${OLLAMA_BASE_URL}/api/chat`,
      {
        model: OLLAMA_VISION_MODEL,
        messages: [
          {
            role: "user",
            content: EXTRACTION_PROMPT,
            images: [base64Data],
          },
        ],
        format: INBODY_JSON_SCHEMA,
        stream: false,
        // Ollama unloads a model 5 minutes after its last call by default —
        // measured on this environment: ~135s cold (weights loading into
        // RAM) vs ~16s warm for the same request. InBody uploads are
        // infrequent but a user retrying a bad photo minutes apart
        // shouldn't eat that cold-start cost twice; 30m keeps it resident
        // through a realistic retry window without pinning it forever.
        keep_alive: "30m",
        options: {
          temperature: 0, // deterministic reads of printed numbers, not creative writing
          num_predict: 1024,
        },
      },
      { timeout: OLLAMA_VISION_TIMEOUT_MS },
    );
  } catch (err) {
    const isConnection = err instanceof AxiosError && !err.response;
    logger.error({ err, provider: "ollama", model: OLLAMA_VISION_MODEL }, "InBody local vision call failed");
    throw new Error(
      isConnection
        ? `Local AI (Ollama) unreachable at ${OLLAMA_BASE_URL}. Is Ollama running with a vision model pulled (ollama pull ${OLLAMA_VISION_MODEL})?`
        : `Local AI (Ollama) call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const content = response.data?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Local AI (Ollama) did not return InBody data");
  }
  let parsed: unknown;
  try {
    parsed = extractJsonPayload(content);
  } catch {
    logger.error({ content }, "InBody local vision returned non-JSON content");
    throw new Error("Local AI (Ollama) returned unreadable data — try a clearer photo");
  }
  return normalizeVisionResult(parsed);
}

async function extractWithClaude(
  base64Data: string,
  mediaType: "image/png" | "image/jpeg",
): Promise<VisionResult> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: process.env.INBODY_VISION_MODEL ?? "claude-sonnet-4-6",
    max_tokens: 1024,
    tools: [INBODY_TOOL],
    tool_choice: { type: "any" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data },
          },
          { type: "text", text: EXTRACTION_PROMPT },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return structured InBody data");
  }
  return normalizeVisionResult(toolUse.input);
}

export async function extractInBodyVision(imagePath: string): Promise<VisionResult> {
  const base64Data = fs.readFileSync(imagePath).toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mediaType = (ext === ".png" ? "image/png" : "image/jpeg") as "image/png" | "image/jpeg";

  if (INBODY_VISION_PROVIDER === "anthropic") {
    return extractWithClaude(base64Data, mediaType);
  }
  if (INBODY_VISION_PROVIDER !== "ollama") {
    logger.warn(
      { provider: INBODY_VISION_PROVIDER },
      "Unrecognized INBODY_VISION_PROVIDER, falling back to ollama",
    );
  }
  return extractWithOllama(base64Data);
}
