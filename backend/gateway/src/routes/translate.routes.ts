import express, { Router, Request, Response } from "express";
import axios from "axios";
import { logger } from "@gym-coach/shared";

type SupportedLanguage = "en" | "vi";
type TranslationProvider = "google" | "deepl" | "libretranslate";

type TranslateRequest = {
  text?: unknown;
  targetLang?: unknown;
  sourceLang?: unknown;
};

const router = Router();
const supportedLanguages = new Set<SupportedLanguage>(["en", "vi"]);

// Security review 2026-09-03 (H2) — this used to be a bare `new Map`, growing forever (one
// entry per distinct text+language+provider combination ever translated) until the process
// OOMs. A small in-process LRU is enough here: no new dependency, and losing entries just
// means an occasional re-translate, never a correctness problem.
const CACHE_MAX_ENTRIES = 2_000;
class BoundedCache {
  private map = new Map<string, string>();

  get(key: string): string | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Re-insert to mark "most recently used" — Map iterates in insertion order, so the
    // first key is always the least-recently-used one once every read does this.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: string): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > CACHE_MAX_ENTRIES) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}
const cache = new BoundedCache();

// Security review 2026-09-03 (L6) — the three provider calls below had no retry at all, so a
// single transient network blip or provider 5xx fell straight through to the fallback
// (returns the untranslated source text to the user). Bounded retries with a short backoff
// only for the failure modes actually worth retrying — connection errors and 5xx/429, never
// a 4xx like a bad request or missing API key, which will just fail identically again.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const retryable = status === undefined || status === 429 || status >= 500;
      if (!retryable || attempt === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastErr;
}

function readLanguage(value: unknown, fallback: SupportedLanguage): SupportedLanguage {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  return supportedLanguages.has(normalized as SupportedLanguage)
    ? (normalized as SupportedLanguage)
    : fallback;
}

function readProvider(): TranslationProvider {
  const provider = (process.env.TRANSLATE_PROVIDER || "libretranslate")
    .trim()
    .toLowerCase();
  if (
    provider === "google" ||
    provider === "deepl" ||
    provider === "libretranslate"
  ) {
    return provider;
  }
  return "libretranslate";
}

async function translateWithLibreTranslate(
  text: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage,
): Promise<string> {
  const url =
    process.env.TRANSLATE_API_URL || "https://libretranslate.com/translate";
  const apiKey = process.env.TRANSLATE_API_KEY;
  const { data } = await axios.post(
    url,
    {
      q: text,
      source: sourceLang,
      target: targetLang,
      format: "text",
      ...(apiKey ? { api_key: apiKey } : {}),
    },
    { timeout: 10_000 },
  );
  return String(data?.translatedText || text);
}

async function translateWithGoogle(
  text: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage,
): Promise<string> {
  const apiKey = process.env.TRANSLATE_API_KEY;
  if (!apiKey) {
    throw new Error("TRANSLATE_API_KEY is required for Google Translate.");
  }

  const url =
    process.env.TRANSLATE_API_URL ||
    "https://translation.googleapis.com/language/translate/v2";
  const { data } = await axios.post(
    `${url}?key=${encodeURIComponent(apiKey)}`,
    {
      q: text,
      source: sourceLang,
      target: targetLang,
      format: "text",
    },
    { timeout: 10_000 },
  );
  return String(data?.data?.translations?.[0]?.translatedText || text);
}

async function translateWithDeepL(
  text: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage,
): Promise<string> {
  const apiKey = process.env.TRANSLATE_API_KEY;
  if (!apiKey) {
    throw new Error("TRANSLATE_API_KEY is required for DeepL.");
  }

  const url =
    process.env.TRANSLATE_API_URL || "https://api-free.deepl.com/v2/translate";
  const body = new URLSearchParams({
    text,
    source_lang: sourceLang.toUpperCase(),
    target_lang: targetLang.toUpperCase(),
  });
  const { data } = await axios.post(url, body, {
    timeout: 10_000,
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });
  return String(data?.translations?.[0]?.text || text);
}

async function translateText(
  text: string,
  sourceLang: SupportedLanguage,
  targetLang: SupportedLanguage,
): Promise<string> {
  if (sourceLang === targetLang) return text;

  const provider = readProvider();
  const cacheKey = `${provider}:${sourceLang}:${targetLang}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const translated = await withRetry(() =>
    provider === "google"
      ? translateWithGoogle(text, sourceLang, targetLang)
      : provider === "deepl"
        ? translateWithDeepL(text, sourceLang, targetLang)
        : translateWithLibreTranslate(text, sourceLang, targetLang),
  );

  cache.set(cacheKey, translated);
  return translated;
}

router.post(
  "/api/translate",
  express.json({ limit: "16kb" }),
  async (req: Request, res: Response) => {
  const body = req.body as TranslateRequest;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const targetLang = readLanguage(body.targetLang, "vi");
  const sourceLang = readLanguage(body.sourceLang, "en");

  if (!text) {
    return res.status(400).json({
      success: false,
      error: { code: "INVALID_TEXT", message: "text is required." },
    });
  }

  if (text.length > 2_000) {
    return res.status(400).json({
      success: false,
      error: {
        code: "TEXT_TOO_LONG",
        message: "text must be 2000 characters or fewer.",
      },
    });
  }

  try {
    const translatedText = await translateText(text, sourceLang, targetLang);
    return res.json({ translatedText });
  } catch (err) {
    logger.warn(
      {
        err,
        provider: readProvider(),
        sourceLang,
        targetLang,
      },
      "Translation provider failed; returning source text.",
    );
    return res.json({ translatedText: text, fallback: true });
  }
  },
);

export default router;
