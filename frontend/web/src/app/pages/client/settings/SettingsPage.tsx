import { GearSixIcon as SettingsIcon } from "@phosphor-icons/react";
import { AccountSection } from "./AccountSection";
import { AppearanceSection } from "./AppearanceSection";
import { UnitsSection } from "./UnitsSection";
import { WorkoutSection } from "./WorkoutSection";
import { NutritionSection } from "./NutritionSection";
import { NotificationsSection } from "./NotificationsSection";
import { AICoachSection } from "./AICoachSection";
import { PrivacyDataSection } from "./PrivacyDataSection";
import { ConnectionsSection } from "./ConnectionsSection";
import { HelpAboutSection } from "./HelpAboutSection";

const JUMP_LINKS = [
  { id: "account", label: "Tài khoản" },
  { id: "appearance", label: "Giao diện" },
  { id: "units", label: "Đơn vị đo" },
  { id: "workout", label: "Tập luyện" },
  { id: "nutrition", label: "Dinh dưỡng" },
  { id: "notifications", label: "Thông báo" },
  { id: "ai-coach", label: "AI Coach" },
  { id: "privacy-data", label: "Dữ liệu" },
  { id: "connections", label: "Kết nối" },
  { id: "help", label: "Trợ giúp" },
  { id: "about", label: "Giới thiệu" },
];

/**
 * Settings Center hub (docs/features/PRODUCT_COMPLETENESS_IMPACT_ANALYSIS.md
 * §5/§32) — composes the 11 modular section components rather than one
 * giant page. A vertical stack of cards + a sticky horizontally-scrollable
 * jump bar (not a sidebar layout) so it stays usable at 390px without a
 * second navigation paradigm the rest of the client shell doesn't have.
 */
export function SettingsPage() {
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 flex items-center gap-2 text-xl font-bold">
          <SettingsIcon className="w-5 h-5 text-zinc-300" /> Cài đặt
        </h1>
        <p className="text-zinc-500 text-sm mt-0.5">
          Tuỳ chọn ứng dụng, tài khoản và dữ liệu của bạn
        </p>
      </div>

      <div
        className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 sticky top-0 z-10 bg-zinc-950/80 backdrop-blur-sm py-2"
        data-testid="settings-jump-bar"
      >
        {JUMP_LINKS.map((link) => (
          <a
            key={link.id}
            href={`#${link.id}`}
            className="flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
          >
            {link.label}
          </a>
        ))}
      </div>

      <AccountSection />
      <AppearanceSection />
      <UnitsSection />
      <WorkoutSection />
      <NutritionSection />
      <NotificationsSection />
      <AICoachSection />
      <PrivacyDataSection />
      <ConnectionsSection />
      <HelpAboutSection />
    </div>
  );
}
