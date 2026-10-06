import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Dumbbell, Pencil, Ruler, TrendingDown, TrendingUp, Utensils, X } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, Input, useToast } from "../../components/ui";
import { ptCoachService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { FEEDBACK_FLAG, FEEDBACK_SENTIMENT, formatCycleDate } from "../cycle/cycle";
import { apiErrorMessage } from "../plans/aiPlans";
import {
  CONSISTENCY_STATUS,
  NUTRITION_TRIGGER_LABEL,
  NUTRITION_USER_DECISION_LABEL,
  PT_DECISION_LABEL,
  PT_NUTRITION_DECISION_LABEL,
  attentionItems,
  canPtActOnNutrition,
  canTriggerDietBreak,
  labelOr,
  parseModifyGoal,
  weightTrend,
  type ModifyGoalForm,
} from "./coachClient";

/**
 * 14B.2 (PG-A5) — web `ClientFitnessSummaryCard` (training half + nutrition half), `ClientProgressCard`
 * and `PTClientDetail`'s "Cần chú ý", for the coach's student screen. Only rendered for an ACTIVE
 * contract; fitness-service re-checks that relationship on every call regardless.
 *
 * The summary query key is web's, so the training and nutrition cards share one request.
 */

const summaryKey = (clientUserId: string) => ["pt-client-fitness-summary", clientUserId];

function useClientSummary(clientUserId: string) {
  return useQuery({ queryKey: summaryKey(clientUserId), queryFn: () => ptCoachService.getClientSummary(clientUserId) });
}

function CardTitle({ icon: Icon, children, color }: { icon: typeof Dumbbell; children: string; color?: string }) {
  const accent = useWorkspaceAccent();
  return (
    <View className="mb-1 flex-row items-center gap-2">
      <Icon size={16} color={color ?? accent.primary} />
      <Text className="font-body-semibold text-sm text-foreground">{children}</Text>
    </View>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text className="font-body text-sm text-muted-foreground">{label}</Text>
      <View className="min-w-0 flex-1 items-end">
        <Text className="text-right font-body-semibold text-sm text-foreground">{value}</Text>
        {sub ? <Text className="text-right font-body text-[11px] text-muted-foreground">{sub}</Text> : null}
      </View>
    </View>
  );
}

function Loading() {
  const accent = useWorkspaceAccent();
  return <ActivityIndicator className="self-start py-2" color={accent.primary} />;
}

/** "Cần chú ý" — shares the roadmap and summary caches the other cards fill. */
export function ClientAttentionCard({ clientUserId }: { clientUserId: string }) {
  const roadmap = useQuery({
    queryKey: ["pt-client-roadmap", clientUserId],
    queryFn: () => ptCoachService.getClientRoadmap(clientUserId),
  });
  const summary = useClientSummary(clientUserId);
  const items = attentionItems(roadmap.data as any, summary.data);
  if (items.length === 0) return null;
  return (
    <View className="gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-4">
      <View className="flex-row items-center gap-2">
        <AlertTriangle size={16} color="#f59e0b" />
        <Text className="font-body-semibold text-sm text-warning">Cần chú ý</Text>
      </View>
      {items.map((item) => (
        <Text key={item} className="font-body text-xs text-foreground">
          • {item}
        </Text>
      ))}
    </View>
  );
}

export function ClientTrainingSummaryCard({ clientUserId }: { clientUserId: string }) {
  const { data, isLoading, isError } = useClientSummary(clientUserId);
  const fb = data?.feedbackSummary;
  const sentiment = fb ? (FEEDBACK_SENTIMENT[fb.feedbackSentimentByRules] ?? FEEDBACK_SENTIMENT.neutral) : null;
  const flags = fb ? [...fb.safetyFlags, ...fb.equipmentMismatchFlags] : [];

  return (
    <Card className="gap-3 p-4">
      <CardTitle icon={Dumbbell}>Dữ liệu tập luyện</CardTitle>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <Text className="font-body text-xs text-muted-foreground">Không thể tải dữ liệu tập luyện.</Text>
      ) : !data?.activeCycle ? (
        <Text className="font-body text-xs text-muted-foreground">Học viên chưa có chu kỳ tập luyện đang hoạt động.</Text>
      ) : (
        <>
          <Row label="Chu kỳ" value={data.activeCycle.name ?? `Chu kỳ #${data.activeCycle.cycleIndex}`} />
          {data.cycleSummary?.adherence ? (
            <Row
              label="Tuân thủ"
              value={`${
                data.cycleSummary.adherence.percent != null ? `${Math.round(data.cycleSummary.adherence.percent)}%` : "Chưa có dữ liệu"
              } (${data.cycleSummary.adherence.completed}/${data.cycleSummary.adherence.total} buổi)`}
            />
          ) : null}
          {(data.cycleSummary?.alerts ?? []).map((a) => (
            <Text key={a.code} className="font-body text-[11px] leading-4 text-warning">
              {a.message}
            </Text>
          ))}

          {fb && fb.totalSessions > 0 && sentiment ? (
            <View className="gap-2 border-t border-border pt-3">
              <View className="flex-row items-center justify-between">
                <Text className="font-body text-sm text-muted-foreground">Cảm nhận buổi tập</Text>
                <Badge tone={sentiment.tone}>{sentiment.label}</Badge>
              </View>
              <Row label="Đã phản hồi" value={`${fb.feedbackSubmittedCount}/${fb.totalSessions} buổi`} />
              {flags.length > 0 ? (
                <Text className="font-body text-[11px] text-warning">
                  {flags.map((f) => FEEDBACK_FLAG[f] ?? f).join(" · ")}
                </Text>
              ) : null}
            </View>
          ) : null}

          {data.priorDecisions.length > 0 ? (
            <Text className="border-t border-border pt-3 font-body text-[11px] text-muted-foreground">
              Quyết định gần đây: {data.priorDecisions.map((d) => PT_DECISION_LABEL[d] ?? d).join(" → ")}
            </Text>
          ) : null}

          {data.latestAssessment?.decision ? (
            <View className="gap-1 rounded-xl border border-border bg-panel p-3">
              <View className="flex-row items-center justify-between">
                <Text className="font-body text-[11px] text-muted-foreground">Đánh giá chu kỳ gần nhất</Text>
                <Text className="font-body-semibold text-[11px] text-primary">
                  {labelOr(PT_DECISION_LABEL, data.latestAssessment.decision)}
                </Text>
              </View>
              {data.latestAssessment.aiSummary ? (
                <Text className="font-body text-[11px] text-foreground">{data.latestAssessment.aiSummary}</Text>
              ) : null}
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}

export function ClientNutritionCoachCard({ clientUserId }: { clientUserId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useClientSummary(clientUserId);
  const [modifyOpen, setModifyOpen] = useState(false);

  const cycleId = data?.activeCycle?.id ?? "";
  const decision = data?.nutrition?.latestNutritionDecision ?? null;
  const assessmentId = decision?.assessmentId ?? undefined;
  const goal = data?.nutrition?.activeGoal ?? null;
  const program = data?.nutrition?.activeProgram ?? null;
  const consistency = data?.nutrition?.consistency?.status;
  const canAct = canPtActOnNutrition(data);

  const refresh = () => queryClient.invalidateQueries({ queryKey: summaryKey(clientUserId) });
  const fail = (fallback: string) => (e: unknown) => toast.show(apiErrorMessage(e, fallback), "danger");

  const approve = useMutation({
    mutationFn: () => ptCoachService.approveNutritionRecommendation(clientUserId, cycleId, assessmentId),
    onSuccess: () => {
      toast.show("Đã chấp nhận đề xuất AI cho học viên", "success");
      refresh();
    },
    onError: fail("Không thể chấp nhận đề xuất"),
  });
  const reject = useMutation({
    mutationFn: () => ptCoachService.rejectNutritionRecommendation(clientUserId, cycleId, assessmentId),
    onSuccess: () => {
      toast.show("Đã từ chối đề xuất AI", "success");
      refresh();
    },
    onError: fail("Không thể từ chối đề xuất"),
  });
  const modify = useMutation({
    mutationFn: (input: { goal: { calories: number; protein: number; carbs: number; fat: number }; note: string }) =>
      ptCoachService.modifyNutritionRecommendation(clientUserId, cycleId, input.goal, assessmentId, input.note || undefined),
    onSuccess: () => {
      toast.show("Đã lưu mục tiêu dinh dưỡng đã điều chỉnh cho học viên", "success");
      setModifyOpen(false);
      refresh();
    },
    onError: fail("Không thể lưu điều chỉnh"),
  });
  const dietBreak = useMutation({
    mutationFn: () => ptCoachService.triggerDietBreakRecommendation(clientUserId, cycleId),
    onSuccess: () => {
      toast.show("Đã đề xuất diet break cho học viên — chờ học viên xác nhận", "success");
      refresh();
    },
    onError: fail("Không thể đề xuất diet break"),
  });
  const busy = approve.isPending || reject.isPending || modify.isPending;

  return (
    <Card className="gap-3 p-4">
      <CardTitle icon={Utensils} color="#f97316">
        Dinh dưỡng
      </CardTitle>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <Text className="font-body text-xs text-muted-foreground">Không thể tải dữ liệu dinh dưỡng.</Text>
      ) : !goal && !decision ? (
        <Text className="font-body text-xs text-muted-foreground">Học viên chưa có mục tiêu dinh dưỡng.</Text>
      ) : (
        <>
          {goal ? (
            <Row
              label="Mục tiêu hiện tại"
              value={`${goal.calories} kcal · ${Math.round(goal.protein)}g đạm`}
              sub={NUTRITION_TRIGGER_LABEL[goal.triggeredBy ?? ""] ?? "Không rõ nguồn"}
            />
          ) : null}
          {program ? <Row label="Thực đơn hiện tại" value={`${program.dailyCaloriesTarget ?? "–"} kcal · ${program.name}`} /> : null}
          {consistency ? (
            <View className="flex-row items-center justify-between gap-3">
              <Text className="font-body text-sm text-muted-foreground">Khớp mục tiêu</Text>
              <Badge tone={(CONSISTENCY_STATUS[consistency] ?? CONSISTENCY_STATUS.LOW_CONFIDENCE).tone}>
                {(CONSISTENCY_STATUS[consistency] ?? { label: consistency }).label}
              </Badge>
            </View>
          ) : null}

          {canTriggerDietBreak(data) ? (
            <Button size="sm" variant="secondary" disabled={dietBreak.isPending} onPress={() => dietBreak.mutate()}>
              {dietBreak.isPending ? "Đang đề xuất…" : "🧊 Đề xuất diet break"}
            </Button>
          ) : null}
          {canTriggerDietBreak(data) ? (
            <Text className="-mt-1 font-body text-[11px] text-muted-foreground">
              Một khoảng nghỉ ở mức calo duy trì — chỉ cho chu kỳ giảm cân đang chạy; học viên vẫn tự xác nhận.
            </Text>
          ) : null}

          {decision ? (
            <View className="gap-1.5 rounded-xl border border-border bg-panel p-3">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="font-body text-[11px] text-muted-foreground">Đề xuất AI gần nhất</Text>
                <Text className="font-body-semibold text-[11px] text-warning">
                  {labelOr(PT_NUTRITION_DECISION_LABEL, decision.decision)}
                </Text>
              </View>
              {decision.headline ? <Text className="font-body text-[11px] text-foreground">{decision.headline}</Text> : null}
              <Text className="font-body text-[10px] text-muted-foreground">
                Học viên: {labelOr(NUTRITION_USER_DECISION_LABEL, decision.userDecision)}
                {decision.reviewedByRole === "PT" ? " (bởi PT)" : ""}
              </Text>
              {decision.ptNote ? (
                <Text className="font-body text-[10px] italic text-muted-foreground">Ghi chú PT: {decision.ptNote}</Text>
              ) : null}
              {canAct ? (
                <View className="mt-1 flex-row gap-1.5">
                  <Button className="flex-1" size="sm" icon={Check} disabled={busy} onPress={() => approve.mutate()}>
                    Duyệt
                  </Button>
                  <Button
                    className="flex-1"
                    size="sm"
                    variant="secondary"
                    icon={Pencil}
                    disabled={busy || !goal}
                    onPress={() => setModifyOpen(true)}
                  >
                    Sửa
                  </Button>
                  <Button className="flex-1" size="sm" variant="destructive" icon={X} disabled={busy} onPress={() => reject.mutate()}>
                    Từ chối
                  </Button>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      )}

      <BottomSheet open={modifyOpen} onClose={() => setModifyOpen(false)} title="Điều chỉnh mục tiêu dinh dưỡng">
        {modifyOpen && goal ? (
          <ModifyGoalFields
            initial={goal}
            pending={modify.isPending}
            onCancel={() => setModifyOpen(false)}
            onSubmit={(g, note) => modify.mutate({ goal: g, note })}
          />
        ) : null}
      </BottomSheet>
    </Card>
  );
}

function ModifyGoalFields({
  initial,
  pending,
  onCancel,
  onSubmit,
}: {
  initial: { calories: number; protein: number; carbs: number; fat: number };
  pending: boolean;
  onCancel: () => void;
  onSubmit: (goal: { calories: number; protein: number; carbs: number; fat: number }, note: string) => void;
}) {
  const [form, setForm] = useState<ModifyGoalForm>({
    calories: String(initial.calories),
    protein: String(initial.protein),
    carbs: String(initial.carbs),
    fat: String(initial.fat),
  });
  const [note, setNote] = useState("");
  const parsed = parseModifyGoal(form);
  const field = (key: keyof ModifyGoalForm, label: string) => (
    <View className="w-[48.5%]">
      <Input label={label} value={form[key]} keyboardType="decimal-pad" onChangeText={(t) => setForm((f) => ({ ...f, [key]: t }))} />
    </View>
  );
  return (
    <View className="gap-3 pb-2">
      <View className="flex-row flex-wrap justify-between gap-y-2">
        {field("calories", "Calories")}
        {field("protein", "Protein (g)")}
        {field("carbs", "Carbs (g)")}
        {field("fat", "Fat (g)")}
      </View>
      <Input
        label="Ghi chú (tuỳ chọn)"
        value={note}
        onChangeText={setNote}
        placeholder="Vd: Giữ calo cao hơn AI đề xuất do lịch tập nặng hơn"
        multiline
      />
      {!parsed.ok ? <Text className="font-body text-xs text-destructive">{parsed.error}</Text> : null}
      <View className="flex-row gap-2">
        <Button className="flex-1" variant="secondary" onPress={onCancel}>
          Hủy
        </Button>
        <Button className="flex-1" disabled={pending || !parsed.ok} onPress={() => parsed.ok && onSubmit(parsed.goal, note.trim())}>
          {pending ? "Đang lưu…" : "Lưu điều chỉnh"}
        </Button>
      </View>
    </View>
  );
}

export function ClientProgressCard({ clientUserId }: { clientUserId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["pt-client-progress", clientUserId],
    queryFn: () => ptCoachService.getClientProgress(clientUserId),
  });
  const latest = data?.latest ?? null;
  const trend = weightTrend(data);

  return (
    <Card className="gap-3 p-4">
      <CardTitle icon={Ruler} color="#60a5fa">
        Đo lường cơ thể (InBody)
      </CardTitle>
      {isLoading ? (
        <Loading />
      ) : isError ? (
        <Text className="font-body text-xs text-muted-foreground">Không thể tải dữ liệu đo lường.</Text>
      ) : !latest ? (
        <Text className="font-body text-xs text-muted-foreground">Học viên chưa có dữ liệu InBody nào.</Text>
      ) : (
        <>
          <Row label="Ngày đo gần nhất" value={formatCycleDate(latest.date)} />
          <View className="flex-row gap-2">
            {[
              ["Cân nặng", latest.weight != null ? `${latest.weight} kg` : "–"],
              ["Mỡ cơ thể", latest.bodyFatPct != null ? `${latest.bodyFatPct}%` : "–"],
              ["Cơ", latest.muscleMass != null ? `${latest.muscleMass} kg` : "–"],
            ].map(([label, value]) => (
              <View key={label} className="flex-1 items-center rounded-xl border border-border bg-panel p-2.5">
                <Text className="font-body text-[10px] text-muted-foreground">{label}</Text>
                <Text className="font-display text-sm text-foreground">{value}</Text>
              </View>
            ))}
          </View>
          {trend ? (
            <View className="flex-row items-center gap-1.5 border-t border-border pt-3">
              {trend.down ? <TrendingDown size={14} color="#22c55e" /> : <TrendingUp size={14} color="#f59e0b" />}
              <Text className="font-body text-xs text-muted-foreground">{trend.text}</Text>
            </View>
          ) : null}
        </>
      )}
    </Card>
  );
}
