import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Settings Center → Appearance (docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md
// §7) added "system" as a third, real stored value — previously only
// dark/light explicit choices existed. `effectiveTheme` is what actually
// gets applied to the DOM; Topbar's quick ThemeToggle button still only
// ever sets an explicit dark/light (never "system"), so it keeps working
// unchanged for anyone who never opens Settings.
export type AppTheme = "dark" | "light" | "system";
export type AppLanguage = "en" | "vi";

type SettingsContextValue = {
  theme: AppTheme;
  effectiveTheme: "dark" | "light";
  language: AppLanguage;
  setTheme: (theme: AppTheme) => void;
  setLanguage: (language: AppLanguage) => void;
  toggleTheme: () => void;
};

const THEME_STORAGE_KEY = "fitness-assistant.theme";
const LANGUAGE_STORAGE_KEY = "fitness-assistant.language";

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);

function readStoredTheme(): AppTheme {
  const value = localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "dark";
}

function readStoredLanguage(): AppLanguage {
  const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return value === "en" || value === "vi" ? value : "vi";
}

function readSystemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => readStoredTheme());
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    readSystemPrefersDark(),
  );
  const [language, setLanguageState] = useState<AppLanguage>(() =>
    readStoredLanguage(),
  );

  const effectiveTheme: "dark" | "light" =
    theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;

  // Only listens while theme === "system" — an explicit dark/light choice
  // should never move once made, even if the OS preference changes later.
  useEffect(() => {
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.classList.toggle("dark", effectiveTheme === "dark");
    document.documentElement.style.colorScheme = effectiveTheme;
    const logoHref =
      effectiveTheme === "dark"
        ? "/brand/gymini-logo-dark.png"
        : "/brand/gymini-logo-light.png";
    document
      .querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')
      .forEach((link) => {
        link.href = logoHref;
      });
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme, effectiveTheme]);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  const setTheme = useCallback((nextTheme: AppTheme) => {
    setThemeState(nextTheme);
  }, []);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
  }, []);

  // Quick chrome toggle (Topbar) — always picks an explicit dark/light
  // based on what's currently showing, even when the stored preference is
  // "system"; it never sets "system" itself (that's Settings-only).
  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const currentlyDark =
        current === "system" ? readSystemPrefersDark() : current === "dark";
      return currentlyDark ? "light" : "dark";
    });
  }, []);

  const value = useMemo(
    () => ({
      theme,
      effectiveTheme,
      language,
      setTheme,
      setLanguage,
      toggleTheme,
    }),
    [effectiveTheme, language, setLanguage, setTheme, theme, toggleTheme],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error("useSettings must be used inside SettingsProvider.");
  }
  return value;
}
