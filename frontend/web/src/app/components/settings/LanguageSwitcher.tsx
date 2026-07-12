import { Languages } from "lucide-react";
import { useSettings, type AppLanguage } from "../../context/SettingsContext";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";

export function LanguageSwitcher() {
  const { language, setLanguage } = useSettings();
  const { text: ariaLabel } = useAutoTranslate("Chọn ngôn ngữ", "vi");

  return (
    <label className="theme-control flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
      <Languages className="h-3.5 w-3.5 text-current opacity-70" />
      <select
        aria-label={ariaLabel}
        value={language}
        onChange={(event) => setLanguage(event.target.value as AppLanguage)}
        className="bg-transparent text-xs font-semibold outline-none"
      >
        <option value="vi">Tiếng Việt</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
