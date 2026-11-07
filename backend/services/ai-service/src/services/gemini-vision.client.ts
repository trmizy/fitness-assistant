import { logger } from "@gym-coach/shared";

/**
 * Gemini REST fallback shared by the two vision features that call Anthropic
 * directly (fitness-vision-chat, fitness-goal-vision). Same approach as the
 * InBody fallback in user-service (a separate service, so duplicated on
 * purpose). Never logs the key, the image or any answer content.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const NEXT_MODEL_STATUSES = new Set([503, 429, 404]);
const BLOCKED_FINISH_REASONS = new Set(["SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "RECITATION"]);

/** Anthropic answered, but the answer is unusable (e.g. no tool_use). Never falls back. */
export class VisionUnusableError extends Error {}

class GeminiHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class GeminiBlockedError extends Error {}

export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function geminiModels(): string[] {
  return (process.env.GEMINI_VISION_MODELS || "gemini-3.5-flash,gemini-3-flash-preview")
    .split(",").map((m) => m.trim()).filter(Boolean);
}

function parseJsonLoose(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse((fenced ? fenced[1] : content).trim());
}

/** True when Anthropic cannot serve the request at all (billing, auth, limits, overload, outage, network, missing key). */
export function shouldFallbackFromAnthropic(err: unknown): boolean {
  if (err instanceof VisionUnusableError) return false;
  const status = (err as { status?: number } | null)?.status;
  const message = err instanceof Error ? err.message : String(err);
  if (typeof status !== "number") return true;
  if (status === 401 || status === 403 || status === 429 || status === 529 || status >= 500) return true;
  return status === 400 && /credit balance|billing|plan|usage limit/i.test(message);
}

function fallbackReason(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  return typeof status === "number" ? `anthropic_http_${status}` : "anthropic_unavailable";
}

export async function generateGeminiVisionJson(opts: {
  image: { mediaType: string; base64: string };
  text: string;
  schema: unknown;
  label: string;
}): Promise<{ json: unknown; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const timeoutMs = Number(process.env.GEMINI_VISION_TIMEOUT_MS) || 60_000;
  // The schema is described in text (Gemini responseSchema rejects
  // additionalProperties / type arrays); the caller validates the result.
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [
      { inline_data: { mime_type: opts.image.mediaType, data: opts.image.base64 } },
      { text: `${opts.text}\n\nRespond with a single JSON object that follows this JSON schema exactly:\n${JSON.stringify(opts.schema)}` },
    ] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  });

  let lastErr: unknown = new Error("No Gemini vision model configured");
  for (const model of geminiModels()) {
    try {
      let res: Response;
      try {
        res = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new GeminiHttpError(503, `Gemini network error: ${err instanceof Error ? err.name : "unknown"}`);
      }
      if (!res.ok) throw new GeminiHttpError(res.status, `Gemini HTTP ${res.status}`);
      const data = (await res.json()) as {
        promptFeedback?: { blockReason?: string };
        candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
      };
      if (data.promptFeedback?.blockReason) throw new GeminiBlockedError("Gemini blocked the request (safety)");
      const cand = data.candidates?.[0];
      if (!cand) throw new GeminiBlockedError("Gemini returned no candidates");
      if (cand.finishReason && BLOCKED_FINISH_REASONS.has(cand.finishReason)) throw new GeminiBlockedError("Gemini blocked the answer (safety)");
      const text = cand.content?.parts?.map((p) => p.text ?? "").join("");
      if (!text) throw new Error("Gemini returned no content");
      let json: unknown;
      try {
        json = parseJsonLoose(text);
      } catch {
        throw new Error("Gemini returned unreadable data");
      }
      return { json, model };
    } catch (err) {
      lastErr = err;
      if (err instanceof GeminiHttpError && NEXT_MODEL_STATUSES.has(err.status)) {
        logger.warn({ provider: "gemini", model, status: err.status, feature: opts.label }, "Gemini vision model unavailable, trying next");
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * Run the Anthropic call; if (and only if) Anthropic cannot serve the request
 * and a Gemini key exists, serve it from Gemini. On double failure the
 * ORIGINAL Anthropic error is thrown.
 */
export async function withGeminiFallback(
  label: string,
  anthropicCall: () => Promise<unknown>,
  gemini: { image: { mediaType: string; base64: string }; text: string; schema: unknown },
): Promise<unknown> {
  try {
    const out = await anthropicCall();
    logger.info({ provider: "anthropic", feature: label, fallbackReason: null }, "vision served");
    return out;
  } catch (anthropicErr) {
    if (!geminiConfigured() || !shouldFallbackFromAnthropic(anthropicErr)) throw anthropicErr;
    const reason = fallbackReason(anthropicErr);
    logger.warn({ provider: "anthropic", feature: label, fallbackReason: reason }, "Anthropic vision unavailable, falling back to Gemini");
    try {
      const { json, model } = await generateGeminiVisionJson({ ...gemini, label });
      logger.info({ provider: "gemini", model, feature: label, fallbackReason: reason }, "vision served");
      return json;
    } catch {
      logger.error({ provider: "gemini", feature: label, fallbackReason: reason }, "Gemini vision fallback also failed");
      throw anthropicErr;
    }
  }
}
