import { logger } from "@gym-coach/shared";
import { z } from "zod";
import { llmService } from "../services/llm.service";

/** Extracts the first balanced top-level {...} object, respecting string
 * literals so braces inside strings don't throw off the depth count. Needed
 * because small local models under JSON mode sometimes keep generating
 * after a complete object (e.g. a second attempt or trailing chatter) — a
 * naive `/\{[\s\S]*\}/` regex greedily spans to the LAST `}` in the whole
 * response and picks up that trailing content, breaking JSON.parse. */
export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Calls the LLM in JSON mode, extracts + Zod-validates the output, retries
 * on failure, and returns null (never throws) once attempts are exhausted so
 * callers can fall back to a deterministic template. Shared by
 * cycle-analysis.service.ts and cycle-assessment.service.ts — this is the
 * one JSON-mode-LLM-call-with-retry-and-fallback pattern in ai-service that
 * evidence-aware structured flows should use, rather than each reimplementing
 * their own retry/parse loop. */
export async function callLlmJson<T>(
  prompt: string,
  schema: z.ZodType<T, z.ZodTypeDef, any>,
  opts: { userId: string; phase: string; numPredict: number; attempts?: number; logPrefix?: string },
): Promise<T | null> {
  const attempts = opts.attempts ?? 2;
  const prefix = opts.logPrefix ?? "[llm-json-call]";
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await llmService.callLLM(prompt, {
        responseFormat: "json",
        temperature: 0.2,
        numPredict: opts.numPredict,
        timeoutMs: Number(process.env.CYCLE_ANALYSIS_LLM_TIMEOUT_MS ?? 80_000),
      });
      const jsonText = extractFirstJsonObject(result.answer);
      if (!jsonText) throw new Error("No JSON object found in LLM response");
      const parsed = JSON.parse(jsonText);
      return schema.parse(parsed);
    } catch (err) {
      lastError = err;
      logger.warn(
        { err: (err as Error).message, attempt, userId: opts.userId, phase: opts.phase },
        `${prefix} LLM output validation failed, retrying`,
      );
    }
  }
  logger.error(
    { err: (lastError as Error)?.message, userId: opts.userId, phase: opts.phase },
    `${prefix} phase failed after retries, using fallback for this phase`,
  );
  return null;
}
