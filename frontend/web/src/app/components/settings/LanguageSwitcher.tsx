import { Languages } from "lucide-react";
import { useSettings, type AppLanguage } from "../../context/SettingsContext";

export function LanguageSwitcher() {
  const { language, setLanguage } = useSettings();

  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-zinc-700/50 bg-zinc-900/50 px-2 py-1 text-xs text-zinc-300">
      <Languages className="h-3.5 w-3.5 text-zinc-500" />
      <select
        aria-label="Language"
        value={language}
        onChange={(event) => setLanguage(event.target.value as AppLanguage)}
        className="bg-transparent text-xs font-semibold outline-none"
      >
        <option value="vi">Vietnamese</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
