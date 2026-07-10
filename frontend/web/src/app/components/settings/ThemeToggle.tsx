import { Moon, Sun } from "lucide-react";
import { useSettings } from "../../context/SettingsContext";
import { AutoText } from "../i18n/AutoText";

export function ThemeToggle() {
  const { theme, toggleTheme } = useSettings();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-700/50 bg-zinc-900/50 px-2.5 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5 text-amber-300" />
      ) : (
        <Moon className="h-3.5 w-3.5 text-emerald-500" />
      )}
      <AutoText sourceLang="en">{isDark ? "Light" : "Dark"}</AutoText>
    </button>
  );
}
