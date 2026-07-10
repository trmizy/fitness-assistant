import { useEffect, useMemo, useState } from "react";
import { translationService } from "../services/api";
import { useSettings, type AppLanguage } from "../context/SettingsContext";

type TranslationState = {
  text: string;
  loading: boolean;
  error: Error | null;
};

const memoryCache = new Map<string, string>();
const CACHE_PREFIX = "fitness-assistant.translation.v1";

function cacheKey(text: string, sourceLang: AppLanguage, targetLang: AppLanguage) {
  return `${CACHE_PREFIX}:${sourceLang}:${targetLang}:${text}`;
}

function readCachedTranslation(key: string): string | null {
  const memoryValue = memoryCache.get(key);
  if (memoryValue) return memoryValue;
  const storedValue = localStorage.getItem(key);
  if (storedValue) {
    memoryCache.set(key, storedValue);
    return storedValue;
  }
  return null;
}

function writeCachedTranslation(key: string, value: string) {
  memoryCache.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be full or unavailable in private browsing; memory cache still works.
  }
}

export function useAutoTranslate(
  sourceText: string,
  sourceLang: AppLanguage = "vi",
): TranslationState {
  const { language } = useSettings();
  const normalizedText = useMemo(() => sourceText.trim(), [sourceText]);
  const [state, setState] = useState<TranslationState>({
    text: sourceText,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!normalizedText || language === sourceLang) {
      setState({ text: sourceText, loading: false, error: null });
      return;
    }

    const key = cacheKey(normalizedText, sourceLang, language);
    const cached = readCachedTranslation(key);
    if (cached) {
      setState({ text: cached, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ text: sourceText, loading: true, error: null });

    translationService
      .translate({
        text: normalizedText,
        sourceLang,
        targetLang: language,
      })
      .then((translatedText) => {
        if (cancelled) return;
        writeCachedTranslation(key, translatedText);
        setState({ text: translatedText, loading: false, error: null });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          text: sourceText,
          loading: false,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [language, normalizedText, sourceLang, sourceText]);

  return state;
}
