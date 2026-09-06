import { BrainIcon as Brain, ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react";
import { SectionCard } from "./components/SectionCard";

/**
 * Informational only — deliberately no live toggle. No AI coaching-style/
 * verbosity preference exists anywhere in the backend (verified across
 * user-service and ai-service), and per spec §12 an AI setting must never
 * gain authority over deterministic progression/deload/safety rules.
 * Fabricating a toggle here would either do nothing (violates §9) or, if
 * wired carelessly, risk exactly what §12 forbids — so this section states
 * the real guarantee instead. See impact analysis §15.
 */
export function AICoachSection() {
  return (
    <SectionCard
      id="ai-coach"
      icon={Brain}
      iconColor="text-fuchsia-400"
      iconBg="bg-fuchsia-500/10 border-fuchsia-500/20"
      title="AI Coach"
      description="Không có tuỳ chọn nào ảnh hưởng đến quyết định huấn luyện"
    >
      <div className="flex items-start gap-2.5 rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/5 p-3">
        <ShieldCheck className="w-4 h-4 text-fuchsia-400 shrink-0 mt-0.5" />
        <p className="text-xs text-zinc-300">
          AI Coach luôn tuân theo giáo án, quy tắc deload và an toàn tập luyện đã
          được thiết lập sẵn — không có cài đặt nào trong mục này có thể ghi đè các
          quyết định đó. Phong cách giải thích/tư vấn hiện chưa có tuỳ chọn riêng.
        </p>
      </div>
    </SectionCard>
  );
}
