import { PaletteIcon as Palette, SunIcon as Sun, MoonIcon as Moon, MonitorIcon as Monitor } from "@phosphor-icons/react";
import { useSettings, type AppTheme, type AppLanguage } from "../../../context/SettingsContext";
import { SectionCard } from "./components/SectionCard";

const THEME_OPTIONS: Array<{ value: AppTheme; label: string; icon: typeof Sun }> = [
  { value: "system", label: "Hệ thống", icon: Monitor },
  { value: "light", label: "Sáng", icon: Sun },
  { value: "dark", label: "Tối", icon: Moon },
];

export function AppearanceSection() {
  const { theme, setTheme, language, setLanguage } = useSettings();

  return (
    <SectionCard
      id="appearance"
      icon={Palette}
      iconColor="text-violet-400"
      iconBg="bg-violet-500/10 border-violet-500/20"
      title="Giao diện"
      description="Chủ đề sáng/tối và ngôn ngữ hiển thị"
    >
      <div>
        <p className="text-[11px] text-zinc-500 mb-2">Chủ đề</p>
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`settings-theme-${opt.value}`}
              onClick={() => setTheme(opt.value)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border py-3 text-xs font-semibold transition-all ${
                theme === opt.value
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800/60 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              <opt.icon className="w-4 h-4" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] text-zinc-500 mb-2">Ngôn ngữ</p>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { value: "vi", label: "Tiếng Việt" },
              { value: "en", label: "English" },
            ] as Array<{ value: AppLanguage; label: string }>
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid={`settings-language-${opt.value}`}
              onClick={() => setLanguage(opt.value)}
              className={`rounded-lg border py-2.5 text-xs font-semibold transition-all ${
                language === opt.value
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                  : "border-zinc-800/60 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-600 mt-2">
          Nội dung khung điều hướng được dịch tự động; một số trang nội dung hiện chỉ
          có tiếng Việt.
        </p>
      </div>
    </SectionCard>
  );
}
