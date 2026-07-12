import { Moon, Sun } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";

export function ThemeToggle() {
  const { theme, language, toggleTheme } = useSettings();
  const isDark = theme === "dark";
  const label =
    language === "vi" ? (isDark ? "Sáng" : "Tối") : isDark ? "Light" : "Dark";
  const { text: ariaLabel } = useAutoTranslate(
    isDark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối",
    "vi",
  );

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="theme-control flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5 text-amber-300" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-emerald-500" />
      )}
      <span>{label}</span>
    </button>
  );
}
