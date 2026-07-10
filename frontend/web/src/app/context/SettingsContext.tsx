import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AppTheme = "dark" | "light";
export type AppLanguage = "en" | "vi";

type SettingsContextValue = {
  theme: AppTheme;
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
  return value === "light" || value === "dark" ? value : "dark";
}

function readStoredLanguage(): AppLanguage {
  const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return value === "en" || value === "vi" ? value : "vi";
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => readStoredTheme());
  const [language, setLanguageState] = useState<AppLanguage>(() =>
    readStoredLanguage(),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

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

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(
    () => ({
      theme,
      language,
      setTheme,
      setLanguage,
      toggleTheme,
    }),
    [language, setLanguage, setTheme, theme, toggleTheme],
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
