import { LinkSimpleIcon as Link2 } from "@phosphor-icons/react";
import { SectionCard } from "./components/SectionCard";

const CONNECTIONS = [
  { name: "Apple Health", note: "Cần công cụ nền tảng iOS gốc" },
  { name: "Android Health Connect", note: "Cần công cụ nền tảng Android gốc" },
  { name: "Garmin", note: "Chưa tích hợp" },
  { name: "Fitbit", note: "Chưa tích hợp" },
];

/**
 * Non-interactive by design (spec §14). Apple Health / Health Connect are
 * native-blocked per docs/OPEN_GYM_ROADMAP_CLOSURE.md — no web/backend work
 * closes that gap, it needs real native iOS/Android tooling. Garmin/Fitbit
 * have no integration at all. Showing "Sắp có" here is honest; a working
 * "Connect" button would not be.
 */
export function ConnectionsSection() {
  return (
    <SectionCard
      id="connections"
      icon={Link2}
      iconColor="text-cyan-400"
      iconBg="bg-cyan-500/10 border-cyan-500/20"
      title="Kết nối"
      description="Đồng bộ với ứng dụng sức khoẻ khác — sắp có"
    >
      {CONNECTIONS.map((c) => (
        <div
          key={c.name}
          className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3"
        >
          <div>
            <p className="text-sm text-zinc-300 font-semibold">{c.name}</p>
            <p className="text-xs text-zinc-600 mt-0.5">{c.note}</p>
          </div>
          <span className="text-[11px] font-semibold text-zinc-500 border border-zinc-700 rounded-full px-2.5 py-1">
            Sắp có
          </span>
        </div>
      ))}
    </SectionCard>
  );
}
