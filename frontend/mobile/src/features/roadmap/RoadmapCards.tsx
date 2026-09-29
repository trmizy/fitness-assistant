import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { ChevronDown, ChevronRight, Flame } from "lucide-react-native";

import { Badge, Card, Tappable } from "../../components/ui";
import type { FitnessDiagnosisResult, PhaseForecastResult, RoadmapPhaseWithCycles, StrategyBucket } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { darkColors, designTokens } from "../../theme/colors";
import {
  deficitLabel,
  fmtKcal,
  fmtKg,
  fmtPct,
  formatDate,
  groupForecasts,
  PHASE_STATUS_LABEL,
  PHASE_TYPE_LABEL,
  STRATEGY_BUCKET_LABEL,
} from "./roadmap";

/** BMR/TDEE breakdown — web's EnergyBreakdownCard (wizard step 2 + the saved diagnosis snapshot). */
export function EnergyBreakdownCard({
  breakdown,
  insufficientInputs,
  loading,
}: {
  breakdown: FitnessDiagnosisResult["energyBreakdown"] | null | undefined;
  insufficientInputs?: boolean;
  loading?: boolean;
}) {
  const accent = useWorkspaceAccent();
  return (
    <Card className="gap-2 p-4">
      <View className="flex-row items-center gap-2">
        <Flame size={16} color={designTokens.warning} />
        <Text className="font-body-semibold text-sm text-foreground">Tiêu hao năng lượng hiện tại</Text>
      </View>
      {insufficientInputs ? (
        <Text className="font-body text-xs text-muted-foreground">Không đủ dữ liệu — hoàn thành Bước 1 và chọn mức độ vận động.</Text>
      ) : loading ? (
        <ActivityIndicator color={accent.primary} />
      ) : breakdown ? (
        <>
          <Row
            label={`BMR (${breakdown.bmrFormula === "inbody_measured" ? "đo InBody" : "công thức Mifflin-St Jeor"})`}
            value={`${breakdown.bmr.toLocaleString("vi-VN")} kcal`}
          />
          {breakdown.components.map((c) => (
            <Row key={c.label} label={c.label} value={`+${c.kcal.toLocaleString("vi-VN")} kcal`} muted />
          ))}
          <View className="mt-1 border-t border-border pt-2">
            <Row label="Tổng tiêu hao (TDEE)" value={`${breakdown.tdee.toLocaleString("vi-VN")} kcal`} strong />
          </View>
          <Text className="font-body text-[11px] text-muted-foreground">
            Các dòng bước chân/tập luyện/TEF/hoạt động khác là ước lượng minh hoạ, luôn cộng đúng bằng tổng TDEE ở trên.
          </Text>
        </>
      ) : (
        <Text className="font-body text-xs text-muted-foreground">Chưa tính được năng lượng tiêu hao.</Text>
      )}
    </Card>
  );
}

function Row({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className={`flex-1 font-body text-xs ${muted ? "text-muted-foreground" : "text-foreground"}`}>{label}</Text>
      <Text className={`${strong ? "font-display text-sm text-primary" : "font-body-semibold text-xs text-foreground"}`}>{value}</Text>
    </View>
  );
}

/** One phase's forecast — every number labelled as an estimate (web's PhaseForecastCard). */
export function PhaseForecastCard({ forecast: f }: { forecast: PhaseForecastResult }) {
  const deficit = deficitLabel(f);
  const cells: [string, string][] = [
    ["Mức ăn ước tính", `${fmtKcal(f.projectedCalories)}/ngày`],
    ["Cân nặng", `${fmtKg(f.projectedStartWeightKg)} → ${fmtKg(f.projectedEndWeightKg)}`],
  ];
  if (f.projectedStartBodyFatPct != null && f.projectedEndBodyFatPct != null)
    cells.push(["Tỷ lệ mỡ", `${fmtPct(f.projectedStartBodyFatPct)} → ${fmtPct(f.projectedEndBodyFatPct)}`]);
  if (f.projectedStartFfmi && f.projectedEndFfmi)
    cells.push(["FFMI", `${f.projectedStartFfmi.normalizedFfmi} → ${f.projectedEndFfmi.normalizedFfmi}`]);
  cells.push(["TDEE", `${fmtKcal(f.estimatedStartTdee)} → ${fmtKcal(f.estimatedEndTdee)}`]);
  cells.push(["Đạm / Tinh bột / Béo", `${f.projectedMacros.proteinGrams}g / ${f.projectedMacros.carbGrams}g / ${f.projectedMacros.fatGrams}g`]);
  return (
    <View className="gap-2 rounded-xl bg-panel p-3">
      <View>
        <Text className="font-body-semibold text-sm text-foreground">{`${f.name} · ${PHASE_TYPE_LABEL[f.phaseType]}`}</Text>
        <Text className="font-body text-[11px] text-muted-foreground">
          {`${formatDate(f.plannedStartAt)} → ${formatDate(f.plannedEndAt)} · ${f.durationWeeks} tuần`}
        </Text>
      </View>
      {deficit ? <Text className="font-body-semibold text-xs text-warning">{deficit}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {cells.map(([k, v]) => (
          <View key={k} className="w-[48%]">
            <Text className="font-body text-[10px] text-muted-foreground">{k}</Text>
            <Text className="font-body-semibold text-xs text-foreground">{v}</Text>
          </View>
        ))}
      </View>
      {f.assumptions.map((a, i) => (
        <Text key={i} className="font-body text-[11px] text-muted-foreground">{`• ${a}`}</Text>
      ))}
      <Text className="font-body text-[10px] italic text-muted-foreground">Ước tính khi tạo lộ trình — sẽ điều chỉnh theo dữ liệu thực tế.</Text>
    </View>
  );
}

/** Collapsible K1/K2/… strategy groups (server-computed), first one open — web's default. */
export function StrategyGroups({
  result,
}: {
  result: { strategyGroups: { key: string; bucket: StrategyBucket; phaseIndexes: number[] }[]; phaseForecasts: PhaseForecastResult[] };
}) {
  const groups = groupForecasts(result);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0].key] : []));
  return (
    <View className="gap-2">
      {groups.map((g) => {
        const isOpen = open.has(g.key);
        return (
          <View key={g.key} className="overflow-hidden rounded-xl border border-border">
            <Tappable
              className="flex-row items-center gap-2 px-3.5 py-3"
              onPress={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.key)) next.delete(g.key);
                  else next.add(g.key);
                  return next;
                })
              }
            >
              <View className="flex-1">
                <Text className="font-body-semibold text-sm text-foreground">{`${g.key} · ${STRATEGY_BUCKET_LABEL[g.bucket]}`}</Text>
                <Text className="font-body text-[11px] text-muted-foreground">
                  {`${g.forecasts.length} giai đoạn · ${g.weeks} tuần${g.avgKcal ? ` · ~${g.avgKcal.toLocaleString("vi-VN")} kcal/ngày` : ""}`}
                </Text>
              </View>
              {isOpen ? <ChevronDown size={16} color="#8b9299" /> : <ChevronRight size={16} color="#8b9299" />}
            </Tappable>
            {isOpen ? (
              <View className="gap-2 px-3 pb-3">
                {g.forecasts.map((f) => (
                  <PhaseForecastCard key={f.phaseIndex} forecast={f} />
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** The whole journey as a vertical timeline (web's PhaseTimeline). */
export function PhaseTimeline({ phases }: { phases: RoadmapPhaseWithCycles[] }) {
  const accent = useWorkspaceAccent();
  return (
    <View>
      {phases.map((phase, i) => {
        const cfg = PHASE_STATUS_LABEL[phase.status];
        const last = i === phases.length - 1;
        const lit = phase.status === "ACTIVE" || phase.status === "COMPLETED";
        return (
          <View key={phase.id} className="flex-row gap-3">
            <View className="items-center">
              <View className="mt-1 h-3 w-3 rounded-full" style={{ backgroundColor: lit ? accent.primary : darkColors.border }} />
              {!last ? <View className="my-1 w-0.5 flex-1 bg-border" style={{ minHeight: 24 }} /> : null}
            </View>
            <View className="flex-1 pb-4">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-body-semibold text-sm text-foreground">{phase.name}</Text>
                <Badge tone={cfg.tone}>{cfg.label}</Badge>
              </View>
              <Text className="font-body text-xs text-muted-foreground">
                {`${PHASE_TYPE_LABEL[phase.phaseType]} · ${formatDate(phase.plannedStartAt)} → ${formatDate(phase.plannedEndAt)}`}
              </Text>
              {phase.progress.cycleCount > 0 ? (
                <Text className="font-body text-xs text-muted-foreground">
                  {`${phase.progress.completedCycleCount}/${phase.progress.cycleCount} chu kỳ đã hoàn thành`}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
