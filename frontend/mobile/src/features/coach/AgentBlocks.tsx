import { useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { ChevronDown, ChevronUp } from "lucide-react-native";

import { Button, Tappable } from "../../components/ui";
import { fitnessAgentService, type AgentChatBlock, type AgentReply } from "../../services/api";
import { darkColors } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { formatVND } from "../../utils/currency";
import { Chip, FieldLabel } from "../plans/PlanWidgets";
import { FOCUS_LABELS, LEANNESS_LABEL, MUSCULARITY_LABEL } from "../roadmap/roadmap";
import { agentErrorMessage, dayLabel, mobileRouteForNextUrl, workflowItemText } from "./coach";
import { CoachText } from "./CoachText";

/**
 * WB-12 — web's `components/agent/FitnessAgentBlocks.tsx` in React Native: the structured blocks an
 * AI Coach answer can carry (PT / program candidates, action confirmations, goal-from-photo,
 * image-chat results, cycle evaluation, missing-data checklist, profile-change confirmation).
 *
 * Every action calls the same `/ai/agent/*` endpoint web calls; nothing is decided here. The
 * Vietnamese labels are web's, which mirror ai-service's own label tables.
 */
const RISK_LABEL: Record<string, string> = { LOW: "Rủi ro thấp", MEDIUM: "Rủi ro trung bình", HIGH: "Rủi ro cao" };
const TRAINING_DECISION_LABEL: Record<string, string> = {
  KEEP: "Giữ nguyên",
  PROGRESS: "Tăng tải",
  ADJUST: "Điều chỉnh nhỏ",
  DELOAD: "Giảm tải (deload)",
  REBUILD: "Xây lại chương trình",
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu",
};
const NUTRITION_DECISION_LABEL: Record<string, string> = {
  KEEP_PLAN: "Giữ nguyên dinh dưỡng",
  PROPOSE_ADJUSTMENT: "Đề xuất điều chỉnh",
  PROPOSE_DIET_BREAK: "Đề xuất nghỉ diet break",
  REQUEST_MORE_DATA: "Cần thêm dữ liệu",
  EARLY_REVIEW: "Cần xem xét sớm",
  ESCALATE: "Cần chuyên gia xem xét",
};
const PROFILE_FIELD_LABEL: Record<string, string> = {
  goal: "Mục tiêu",
  targetWeight: "Cân nặng mục tiêu",
  age: "Tuổi",
  gender: "Giới tính",
  heightCm: "Chiều cao",
  currentWeight: "Cân nặng hiện tại",
  experienceLevel: "Trình độ tập",
};
const GOAL_LABEL: Record<string, string> = { WEIGHT_LOSS: "Giảm mỡ", MUSCLE_GAIN: "Tăng cơ", MAINTENANCE: "Duy trì", ATHLETIC_PERFORMANCE: "Hiệu suất thể thao" };
const GENDER_LABEL: Record<string, string> = { MALE: "Nam", FEMALE: "Nữ", OTHER: "Khác" };
// Asked by the program-search workflow since GAP-17 (ai-service find-pt-program.workflow.ts).
const EXPERIENCE_LABEL: Record<string, string> = { BEGINNER: "Mới tập", INTERMEDIATE: "Trung bình", ADVANCED: "Nâng cao" };

export function formatProfileValue(field: string, value: unknown): string {
  if (value == null) return "Chưa thiết lập";
  if (field === "goal") return GOAL_LABEL[String(value)] ?? String(value);
  if (field === "gender") return GENDER_LABEL[String(value)] ?? String(value);
  if (field === "experienceLevel") return EXPERIENCE_LABEL[String(value)] ?? String(value);
  if (field === "targetWeight" || field === "currentWeight") return `${value} kg`;
  if (field === "heightCm") return `${value} cm`;
  if (field === "age") return `${value} tuổi`;
  return String(value);
}

const isHttp = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

function Small({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "fg" | "warn" | "primary" }) {
  const cls = tone === "fg" ? "text-foreground" : tone === "warn" ? "text-warning" : tone === "primary" ? "text-primary" : "text-muted-foreground";
  return <Text className={`font-body text-xs leading-5 ${cls}`}>{children}</Text>;
}

function Panel({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "warn" }) {
  return <View className={`gap-1.5 rounded-xl border p-3 ${tone === "warn" ? "border-warning/60" : "border-border"} bg-panel`}>{children}</View>;
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <View>
      <Pressable onPress={() => setOpen((v) => !v)} className="min-h-11 flex-row items-center gap-1.5 py-2" accessibilityRole="button">
        <Text className="font-body-semibold text-xs text-foreground">{title}</Text>
        <Icon size={14} color={darkColors.foreground} />
      </Pressable>
      {open ? <View className="gap-1">{children}</View> : null}
    </View>
  );
}

function RiskBadge({ risk }: { risk?: string }) {
  if (!risk || !RISK_LABEL[risk]) return null;
  const cls = risk === "HIGH" ? "border-destructive/40 bg-destructive/10 text-destructive" : risk === "MEDIUM" ? "border-warning/40 bg-warning/10 text-warning" : "border-border bg-panel text-muted-foreground";
  return <Text className={`self-start rounded-full border px-2 py-0.5 font-body-semibold text-[11px] ${cls}`}>{RISK_LABEL[risk]}</Text>;
}

export function AgentBlock({
  block,
  sessionId,
  onReply,
  onQuickReply,
}: {
  block: AgentChatBlock;
  sessionId?: string;
  onReply: (reply: AgentReply) => void;
  onQuickReply?: (text: string) => void;
}) {
  const accent = useWorkspaceAccent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [goal, setGoal] = useState("MUSCLE_GAIN");
  const [focus, setFocus] = useState<string[]>(block.attributes?.focusMuscles ?? []);
  const [muscularity, setMuscularity] = useState<string>(block.attributes?.muscularity ?? "MODERATE");
  const [leanness, setLeanness] = useState<string>(block.attributes?.relativeLeanness ?? "MODERATE");
  const [packages, setPackages] = useState<Record<string, string>>({});

  async function run(fn: () => Promise<AgentReply>) {
    if (busy || completed) return;
    setBusy(true);
    setError("");
    try {
      onReply(await fn());
      setCompleted(true);
    } catch (e) {
      setError(agentErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const expired = !!block.expiresAt && new Date(block.expiresAt) < new Date();
  const s = block.summary ?? {};
  const nextRoute = mobileRouteForNextUrl(block.nextUrl);

  return (
    <View className="mt-3 gap-3">
      {block.warnings?.map((w) => (
        <Small key={w} tone="warn">
          {w}
        </Small>
      ))}

      {(block.type === "PT_RECOMMENDATIONS" || block.type === "PROGRAM_RECOMMENDATIONS") &&
        block.candidates?.map((c: any, i: number) => {
          const synthetic = c.dataOrigin === "SYNTHETIC";
          const chosenPkg = packages[c.id] ?? c.packages?.[0]?.id;
          return (
            <Panel key={c.id}>
              <View className="flex-row items-start gap-2">
                {isHttp(c.photoUrl) ? <Image source={{ uri: c.photoUrl }} className="h-10 w-10 rounded-full" /> : null}
                <View className="min-w-0 flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">
                    {i + 1}. {c.name}
                  </Text>
                  <Small tone="primary">Độ phù hợp: {c.compatibility?.total ?? "—"}/100</Small>
                </View>
              </View>
              {synthetic ? <Small tone="warn">Dữ liệu demo · Kết quả synthetic</Small> : null}
              {Array.isArray(c.specialties) ? <Small tone="fg">{c.specialties.join(" · ")}</Small> : null}
              {c.yearsExperience ? <Small tone="fg">Kinh nghiệm: {c.yearsExperience}</Small> : null}
              {Array.isArray(c.availableDays) ? <Small tone="fg">Lịch: {c.availableDays.map(dayLabel).join(" · ")}</Small> : null}
              {c.daysPerWeek ? (
                <Small tone="fg">
                  {c.daysPerWeek} buổi/tuần · {c.durationWeeks} tuần · khoảng {c.estimatedMinutes} phút/buổi
                </Small>
              ) : null}
              {c.reviewCount > 0 ? (
                <Small tone="fg">
                  Đánh giá {Number(c.averageRating).toFixed(1)}/5 ({c.reviewCount} lượt)
                </Small>
              ) : null}
              <Disclosure title="Lý do và bằng chứng">
                {c.why?.map((w: string) => (
                  <Small key={w}>• {w}</Small>
                ))}
                {c.narration?.uncertainty?.length > 0 ? (
                  <View className="mt-1 rounded-lg bg-background p-2">
                    <Small tone="fg">Lưu ý:</Small>
                    {c.narration.uncertainty.map((u: string) => (
                      <Small key={u}>• {u}</Small>
                    ))}
                  </View>
                ) : null}
                {c.history ? (
                  <View className="mt-1">
                    <Small>{c.history.count > 0 ? `${c.history.count} hành trình tương đồng` : "Chưa đủ bằng chứng lịch sử."}</Small>
                    {c.history.medianTrainingAdherence != null ? <Small>Tuân thủ tập trung vị: {Math.round(c.history.medianTrainingAdherence * 100)}%</Small> : null}
                    {c.history.medianWeightChange != null ? (
                      <Small>
                        Thay đổi cân nặng trung vị: {Number(c.history.medianWeightChange).toFixed(1)} kg / {c.history.medianDurationWeeks} tuần
                      </Small>
                    ) : null}
                    {c.history.note ? <Small>{c.history.note}</Small> : null}
                  </View>
                ) : null}
                {c.certificates?.map((cert: any, n: number) => (
                  <Small key={n}>
                    {cert.name} · {cert.issuer}
                  </Small>
                ))}
                {c.days?.map((day: any, n: number) => (
                  <View key={n} className="mt-1">
                    <Small tone="fg">Buổi {n + 1}</Small>
                    {day.exercises?.map((e: any) => (
                      <Small key={e.exerciseId}>
                        {e.name}: {e.sets} × {e.reps}
                      </Small>
                    ))}
                  </View>
                ))}
              </Disclosure>
              {c.packages?.length > 0 ? (
                <View className="gap-1.5">
                  <FieldLabel>Gói dịch vụ</FieldLabel>
                  <View className="flex-row flex-wrap gap-2">
                    {c.packages.map((p: any) => (
                      <Chip
                        key={p.id}
                        label={`${p.name} · ${p.sessions} buổi · ${formatVND(p.price)}`}
                        active={chosenPkg === p.id}
                        onPress={() => setPackages((m) => ({ ...m, [c.id]: p.id }))}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                {c.packages && !synthetic ? (
                  <Button size="sm" variant="secondary" onPress={() => router.push(`/client/services/pt/${encodeURIComponent(c.id)}`)}>
                    Xem hồ sơ
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  disabled={busy || completed || (c.packages && synthetic)}
                  onPress={() => void run(() => fitnessAgentService.choose(block.recommendationId!, c.id, chosenPkg))}
                >
                  {completed ? "Đã chọn" : c.packages ? "Chọn PT" : "Áp dụng kế hoạch"}
                </Button>
              </View>
            </Panel>
          );
        })}

      {block.evidence?.length ? (
        <Disclosure title={`Nguồn khoa học (${block.evidence.length})`}>
          {block.evidence.map((e) => (
            <View key={e.id} className="mb-2">
              <Text
                className={`font-body text-xs ${isHttp(e.sourceUrl) ? "text-primary underline" : "text-foreground"}`}
                onPress={isHttp(e.sourceUrl) ? () => void Linking.openURL(e.sourceUrl) : undefined}
              >
                {e.title}
              </Text>
              <Small>{e.evidenceLevel}</Small>
              <Small>{e.finding}</Small>
            </View>
          ))}
        </Disclosure>
      ) : null}

      {block.type === "ACTION_CONFIRMATION" ? (
        <Panel tone="warn">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="font-body-semibold text-sm text-foreground">{block.title}</Text>
            <RiskBadge risk={block.risk} />
          </View>
          {s.ptName ? <Small tone="fg">PT: {s.ptName}</Small> : null}
          {s.name ? <Small tone="fg">Gói: {s.name}</Small> : null}
          {s.price != null ? <Small tone="fg">Tổng giá: {formatVND(s.price)}</Small> : null}
          {s.sessions ? (
            <Small tone="fg">
              {s.sessions} buổi · {s.sessionMinutes} phút · {s.mode === "ONLINE" ? "Online" : "Trực tiếp"}
            </Small>
          ) : null}
          {s.preferences?.days ? <Small tone="fg">Lịch mong muốn: {s.preferences.days.map(dayLabel).join(" · ")}</Small> : null}
          {s.durationWeeks && block.kind !== "SAVE_GENERATED_PLAN" ? (
            <Small tone="fg">
              {s.days} buổi/tuần · {s.durationWeeks} tuần
            </Small>
          ) : null}
          {block.kind === "CREATE_PLAN_BUNDLE" ? (
            <View className="gap-1 rounded-lg border border-border p-2.5">
              {s.roadmapSummary ? <Small tone="fg">{s.roadmapSummary}</Small> : null}
              {s.phaseCount > 0 ? (
                <Small>
                  📅 Lộ trình: {s.phaseCount} giai đoạn · {s.totalWeeks} tuần
                </Small>
              ) : null}
              {s.workoutName ? (
                <Small>
                  🏋️ Chương trình tập: {s.workoutName} · {s.workoutDaysPerWeek} buổi/tuần
                </Small>
              ) : (
                <Small tone="warn">🏋️ Chưa tìm được chương trình tập phù hợp — phần này sẽ bị bỏ qua khi xác nhận.</Small>
              )}
              <Small>🥗 Dinh dưỡng: sẽ tính tự động từ hồ sơ/InBody hiện tại khi xác nhận.</Small>
            </View>
          ) : null}
          {block.kind === "SAVE_GENERATED_PLAN" ? (
            <View className="gap-1 rounded-lg border border-border p-2.5">
              <Small>
                🏋️ {s.planName} · {s.daysPerWeek} buổi/tuần · {s.durationWeeks} tuần
              </Small>
              <Small tone="warn">Sẽ thay thế lịch tập chưa hoàn thành hiện tại của bạn.</Small>
            </View>
          ) : null}
          {block.kind === "ROADMAP_ADVANCE" ? (
            <View className="gap-1 rounded-lg border border-border p-2.5">
              <Small>📍 Giai đoạn hiện tại: {s.currentPhase ?? "?"}</Small>
              <Small>➡️ Giai đoạn tiếp theo: {s.nextPhase ?? "?"}</Small>
            </View>
          ) : null}
          {block.kind === "ROADMAP_REBUILD" ? (
            <View className="gap-1 rounded-lg border border-border p-2.5">
              <Small>🔁 Xây lại {s.phaseCount} giai đoạn còn lại</Small>
              {Array.isArray(s.phases) ? s.phases.map((p: string, i: number) => <Small key={i}>• {p}</Small>) : null}
              <Small tone="warn">Các giai đoạn chưa bắt đầu hiện tại sẽ bị thay thế.</Small>
            </View>
          ) : null}
          {block.kind === "ROADMAP_ARCHIVE" ? (
            <View className="gap-1 rounded-lg border border-border p-2.5">
              <Small>
                🗄️ {s.isDraft ? "Bản nháp" : "Lộ trình đang hoạt động"} · mục tiêu {GOAL_LABEL[s.goalType] ?? s.goalType ?? "?"}
              </Small>
              <Small tone="warn">Lộ trình sẽ không còn hoạt động sau khi xác nhận.</Small>
            </View>
          ) : null}
          {block.kind === "CYCLE_COMPLETE" ? (
            <View className="rounded-lg border border-border p-2.5">
              <Small>
                ✅ {s.cycleName ?? "Chu kỳ tập hiện tại"}
                {s.goal ? ` · ${s.goal}` : ""}
              </Small>
            </View>
          ) : null}
          {block.kind === "CYCLE_CANCEL" ? (
            <View className="gap-1 rounded-lg border border-border p-2.5">
              <Small>🚫 {s.cycleName ?? "Chu kỳ tập hiện tại"}</Small>
              <Small tone="warn">Không thể hoàn tác sau khi xác nhận.</Small>
            </View>
          ) : null}
          {block.kind === "NUTRITION_LOG_MEAL" ? (
            <View className="gap-1 rounded-lg border border-border p-2.5">
              <Small>
                🍽️ {s.foodName} · {s.mealTypeLabel}
              </Small>
              <Small>
                {s.calories} kcal · {s.protein}g đạm · {s.carbs}g carb · {s.fats}g béo
              </Small>
            </View>
          ) : null}
          {block.kind === "WORKOUT_START" || block.kind === "WORKOUT_SKIP" || block.kind === "WORKOUT_CANCEL" ? (
            <View className="rounded-lg border border-border p-2.5">
              <Small>🏋️ {s.dayTitle ?? "Buổi tập hôm nay"}</Small>
            </View>
          ) : null}
          {block.note ? <Small tone="fg">{block.note}</Small> : null}
          {expired && !completed ? <Small tone="warn">Đề xuất này đã hết hạn — hãy hỏi lại AI Coach.</Small> : null}
          <View className="mt-1 flex-row gap-2">
            <Button size="sm" disabled={busy || completed || expired} onPress={() => void run(() => fitnessAgentService.confirm(block.actionId!))}>
              {busy ? "Đang xử lý…" : completed ? "Đã xác nhận" : "Xác nhận"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy || completed} onPress={() => setCompleted(true)}>
              Để sau
            </Button>
          </View>
        </Panel>
      ) : null}

      {block.type === "GOAL_ANALYSIS" ? (
        <View className="gap-3">
          {block.note ? <Small tone="fg">{block.note}</Small> : null}
          {!block.attributes?.usable ? <Small tone="warn">Ảnh chưa đủ rõ để gợi ý. Bạn có thể chọn mục tiêu thủ công bên dưới.</Small> : null}
          <View>
            <FieldLabel>Mục tiêu chính</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {Object.entries(GOAL_LABEL).map(([k, label]) => (
                <Chip key={k} label={label} active={goal === k} onPress={() => setGoal(k)} />
              ))}
            </View>
          </View>
          <View>
            <FieldLabel>Mức phát triển cơ mong muốn</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {Object.entries(MUSCULARITY_LABEL).map(([k, label]) => (
                <Chip key={k} label={label} active={muscularity === k} onPress={() => setMuscularity(k)} />
              ))}
            </View>
          </View>
          <View>
            <FieldLabel>Diện mạo mong muốn</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {Object.entries(LEANNESS_LABEL).map(([k, label]) => (
                <Chip key={k} label={label} active={leanness === k} onPress={() => setLeanness(k)} />
              ))}
            </View>
          </View>
          <View>
            <FieldLabel>Nhóm cơ ưu tiên</FieldLabel>
            <View className="flex-row flex-wrap gap-2">
              {Object.entries(FOCUS_LABELS).map(([k, label]) => (
                <Chip key={k} label={label} active={focus.includes(k)} onPress={() => setFocus((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]))} />
              ))}
            </View>
          </View>
          <Button
            size="sm"
            disabled={busy || completed || !sessionId}
            onPress={() =>
              void run(() =>
                fitnessAgentService.confirmGoal(sessionId!, {
                  primaryGoal: goal,
                  focusMuscles: focus,
                  muscularity,
                  relativeLeanness: leanness,
                  source: block.attributes?.usable ? "REFERENCE_IMAGE" : "MANUAL",
                  confirmedByUser: true,
                }),
              )
            }
          >
            {completed ? "Đã lưu mục tiêu" : "Đúng, lưu mục tiêu này"}
          </Button>
        </View>
      ) : null}

      {block.type === "IMAGE_CHAT" && block.result ? (
        <Panel>
          {block.result.type === "EQUIPMENT" ? (
            <>
              <Text className="font-body-semibold text-sm text-foreground">{block.result.equipmentName}</Text>
              {block.result.targetMuscles.length > 0 ? (
                <View className="flex-row flex-wrap gap-1.5">
                  {block.result.targetMuscles.map((m) => (
                    <Text key={m} className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 font-body text-[11px] text-primary">
                      {FOCUS_LABELS[m] ?? m}
                    </Text>
                  ))}
                </View>
              ) : null}
              {block.result.howToUse ? <Small tone="fg">Cách dùng: {block.result.howToUse}</Small> : null}
              {block.result.safetyNote ? <Small tone="warn">{block.result.safetyNote}</Small> : null}
            </>
          ) : null}
          {block.result.type === "WORKOUT_SCHEDULE" ? (
            <>
              {block.result.summary ? <Small tone="fg">{block.result.summary}</Small> : null}
              {block.result.days.map((d, i) => (
                <View key={i}>
                  <Small tone="fg">{d.label}</Small>
                  {d.exercises.map((ex, j) => (
                    <Small key={j}>• {ex}</Small>
                  ))}
                </View>
              ))}
              {block.result.days.length === 0 ? <Small tone="warn">Không đọc rõ được lịch tập từ ảnh — bạn có thể mô tả bằng lời.</Small> : null}
            </>
          ) : null}
          {/* The vision answer uses the same **bold** / list markdown as chat answers. */}
          <CoachText text={block.result.answer} />
        </Panel>
      ) : null}

      {block.type === "ACTION_RESULT" ? (
        <View className="gap-1.5" accessibilityLiveRegion="polite">
          <Small tone="fg">{block.message ?? (block.goalConfirmed ? "Đã lưu mục tiêu. Bạn có thể yêu cầu gợi ý PT hoặc chương trình tập." : "Thao tác đã hoàn tất.")}</Small>
          {Array.isArray(block.steps)
            ? block.steps.map((st, i) => (
                <Small key={i}>{st}</Small>
              ))
            : null}
          {nextRoute ? (
            <Tappable onPress={() => router.push(nextRoute as never)} className="self-start py-1">
              <Text className="font-body-semibold text-xs text-primary underline">Mở chi tiết</Text>
            </Tappable>
          ) : null}
        </View>
      ) : null}

      {block.type === "SUBSTITUTE_RESULT" ? (
        <Panel>
          {block.message ? <Small tone="fg">{block.message}</Small> : null}
          {block.candidates?.map((c: any, i: number) => (
            <View key={c.mealId ?? c.itemId ?? i} className="rounded-lg border border-border px-2 py-1.5">
              <Small>
                {c.label ?? c.itemName}
                {c.label && c.itemName ? ` — ${c.itemName}` : ""}
              </Small>
            </View>
          ))}
        </Panel>
      ) : null}

      {block.type === "CYCLE_EVALUATION_RESULT" ? (
        <Panel>
          <Text className="font-body-semibold text-sm text-foreground">
            {block.decision ? (TRAINING_DECISION_LABEL[block.decision] ?? block.decision) : "Chưa xác định"}
          </Text>
          {block.aiSummary ? <Small tone="fg">{block.aiSummary}</Small> : null}
          {block.nutritionDecision ? (
            <View className="mt-1 border-t border-border pt-2">
              <Text className="font-body-semibold text-sm text-foreground">{NUTRITION_DECISION_LABEL[block.nutritionDecision] ?? block.nutritionDecision}</Text>
              {block.nutritionAiHeadline ? <Small tone="fg">{block.nutritionAiHeadline}</Small> : null}
              {block.nutritionAiExplanation ? <Small>{block.nutritionAiExplanation}</Small> : null}
            </View>
          ) : null}
          {(block.userDecision === "PENDING" && block.decision) || (block.nutritionUserDecision === "PENDING" && block.nutritionDecision) ? (
            <Small tone="warn">Bạn có thể nhắn “chấp nhận” hoặc “từ chối” để phản hồi đề xuất này.</Small>
          ) : null}
        </Panel>
      ) : null}

      {block.type === "WORKFLOW_MISSING_DATA" ? (
        <Panel>
          {block.known?.map((k, i) => (
            <Small key={`k${i}`}>✓ {workflowItemText(k)}</Small>
          ))}
          {block.missing?.map((m, i) => (
            <Small key={`m${i}`} tone="warn">
              • {workflowItemText(m)}
            </Small>
          ))}
        </Panel>
      ) : null}

      {block.type === "PROFILE_UPDATE_CONFIRMATION" ? (
        <Panel tone="warn">
          <Text className="font-body-semibold text-sm text-foreground">Cập nhật hồ sơ</Text>
          {block.changes?.map((c, i) => (
            <View key={i} className="rounded-lg border border-border px-2 py-1.5">
              <Text className="font-body text-sm text-foreground">
                <Text className="text-muted-foreground">{PROFILE_FIELD_LABEL[c.field] ?? c.field}: </Text>
                {formatProfileValue(c.field, c.oldValue)} → <Text className="text-primary">{formatProfileValue(c.field, c.newValue)}</Text>
              </Text>
            </View>
          ))}
          {block.allowUseOnce === false ? (
            <Small>Gymini cần lưu thông tin này vào hồ sơ để sử dụng dữ liệu chính xác — bạn có thể xác nhận, hoặc nhắn một giá trị khác nếu muốn chỉnh lại.</Small>
          ) : null}
          <View className="mt-1 flex-row flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || completed}
              onPress={() => {
                setCompleted(true);
                onQuickReply?.("Xác nhận cập nhật");
              }}
            >
              Xác nhận cập nhật
            </Button>
            {block.allowUseOnce !== false ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || completed}
                onPress={() => {
                  setCompleted(true);
                  onQuickReply?.("Chỉ dùng cho lần này");
                }}
              >
                Chỉ dùng cho lần này
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || completed}
              onPress={() => {
                setCompleted(true);
                onQuickReply?.("Hủy");
              }}
            >
              Hủy
            </Button>
          </View>
        </Panel>
      ) : null}

      {busy ? <ActivityIndicator color={accent.primary} /> : null}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-xs text-destructive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

