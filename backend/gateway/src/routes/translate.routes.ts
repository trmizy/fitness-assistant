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
const cache = new Map<string, string>();
const supportedLanguages = new Set<SupportedLanguage>(["en", "vi"]);

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

  const translated =
    provider === "google"
      ? await translateWithGoogle(text, sourceLang, targetLang)
      : provider === "deepl"
        ? await translateWithDeepL(text, sourceLang, targetLang)
        : await translateWithLibreTranslate(text, sourceLang, targetLang);

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
