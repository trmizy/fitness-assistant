import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Search, Send, Sparkles, Trash2 } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  ScreenHeader,
  Stagger,
  StaggerItem,
  Tappable,
  inputPlaceholderColor,
  useToast,
} from "../../../src/components/ui";
import { personalizedServiceApi, ptCoachService, workoutService } from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { darkColors, designTokens } from "../../../src/theme/colors";
import { formatVND } from "../../../src/utils/currency";
import { ORDER_STATUS_LABEL, orderStatusTone } from "../../../src/features/plans/personalizedOrder";
import { sellerOrderAction, sellerOrderLabel } from "../../../src/features/pt/pt";

type DraftEx = { exerciseId: string; name: string; sets: number; reps: number; restSeconds: number };
type DraftDay = { dayNumber: number; title: string; weekday: number; exercises: DraftEx[] };

const emptyDay = (n: number, weekday: number): DraftDay => ({
  dayNumber: n,
  title: `Buổi ${n}`,
  weekday,
  exercises: [],
});
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * PT-09 — one 1-1 service order, seller side. Behaviour: web's PTServiceOrderPage.
 *
 * The state machine belongs to ai-service; nothing here advances it on its own. Each status
 * offers at most the one action the server accepts (`sellerOrderAction`), so a trainer is never
 * shown a button that is certain to be refused, and a status where the ball is in the client's
 * court says so instead.
 *
 * The AI draft is advisory: `generatePlanDraft` fills the day list, the trainer edits it, and the
 * plan is only delivered by their own action — the same framing web uses, kept because the
 * trainer, not the model, is answerable for what the client receives.
 */
export default function PtServiceOrderScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = String(id ?? "");

  const orderQuery = useQuery({
    queryKey: ["pt-selling-order", orderId],
    queryFn: () => personalizedServiceApi.getOrder(orderId),
    enabled: !!orderId,
  });
  const order: any = orderQuery.data;
  const action = order ? sellerOrderAction(order.status) : null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["pt-selling-order", orderId] });
    void queryClient.invalidateQueries({ queryKey: ["pt-selling-orders"] });
  };
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const startReview = useMutation({
    mutationFn: () => personalizedServiceApi.startReview(orderId),
    onSuccess: () => {
      toast.show("Đã bắt đầu — soạn giáo án cho khách", "success");
      refresh();
    },
    onError: (e) => fail(e, "Không bắt đầu được"),
  });
  const startRevision = useMutation({
    mutationFn: () => personalizedServiceApi.startRevisionWork(orderId),
    onSuccess: () => {
      toast.show("Đã bắt đầu chỉnh sửa", "success");
      refresh();
    },
    onError: (e) => fail(e, "Không bắt đầu chỉnh sửa được"),
  });

  const back = () => (router.canGoBack() ? router.back() : router.replace("/pt/service-orders"));

  if (orderQuery.isLoading) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Đơn dịch vụ" onBack={back} />
        <ActivityIndicator className="mt-12" color={accent.primary} />
      </View>
    );
  }
  if (!order) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader title="Đơn dịch vụ" onBack={back} />
        <View className="p-5">
          <EmptyState icon={ClipboardList} title="Không tìm thấy đơn" description="Đơn này không còn trong danh sách của bạn." />
        </View>
      </View>
    );
  }

  const label = sellerOrderLabel(order.status, ORDER_STATUS_LABEL[order.status as never] ?? order.status);
  const intake = order.intakeData ?? {};

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Đơn dịch vụ" onBack={back} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        <Stagger className="gap-5">
          <StaggerItem>
            <Card className="gap-2 p-5">
              <Text className="font-display text-xl text-foreground">{order.titleSnapshot || "Đơn dịch vụ"}</Text>
              {order.priceSnapshot != null ? (
                <Text className="font-display text-sm text-primary">{formatVND(Number(order.priceSnapshot))}</Text>
              ) : null}
              <View className="flex-row">
                <Badge tone={action ? "warning" : orderStatusTone(order.status)}>{label}</Badge>
              </View>
            </Card>
          </StaggerItem>

          {Object.keys(intake).length > 0 ? (
            <StaggerItem>
              <Text className="mb-2 px-1 font-display text-lg text-foreground">Phiếu khách đã gửi</Text>
              <Card className="gap-2 p-4">
                <Text className="font-body text-xs text-muted-foreground">
                  Chỉ hiện những mục khách đồng ý chia sẻ.
                </Text>
                {Object.entries(intake).map(([k, v]) => (
                  <View key={k} className="flex-row items-start justify-between gap-3">
                    <Text className="font-body text-xs text-muted-foreground">{k}</Text>
                    <Text className="max-w-[60%] text-right font-body-semibold text-xs text-foreground">
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </Text>
                  </View>
                ))}
              </Card>
            </StaggerItem>
          ) : null}

          {order.status === "REVISION_REQUESTED" && Array.isArray(order.revisionRequests) && order.revisionRequests.length > 0 ? (
            <StaggerItem>
              <Card className="gap-1 border-warning/30 bg-warning/5 p-4">
                <Text className="font-body-semibold text-sm text-foreground">Khách yêu cầu chỉnh sửa</Text>
                <Text className="font-body text-sm text-muted-foreground">
                  {order.revisionRequests[0]?.comment ?? "Khách muốn điều chỉnh bản nháp."}
                </Text>
              </Card>
            </StaggerItem>
          ) : null}

          {action === "startReview" ? (
            <StaggerItem>
              <Button full disabled={startReview.isPending} onPress={() => startReview.mutate()}>
                {startReview.isPending ? "Đang bắt đầu…" : "Bắt đầu phân tích & soạn giáo án"}
              </Button>
            </StaggerItem>
          ) : null}

          {action === "startRevision" ? (
            <StaggerItem>
              <Button full disabled={startRevision.isPending} onPress={() => startRevision.mutate()}>
                {startRevision.isPending ? "Đang bắt đầu…" : "Bắt đầu chỉnh sửa"}
              </Button>
            </StaggerItem>
          ) : null}

          {action === "deliver" ? (
            <StaggerItem>
              <DraftBuilder order={order} onDelivered={refresh} />
            </StaggerItem>
          ) : null}

          {!action ? (
            <StaggerItem>
              <Card className="p-4">
                <Text className="font-body text-sm text-muted-foreground">
                  {order.status === "DRAFT_DELIVERED"
                    ? "Đã gửi bản nháp — đang chờ khách xem xét."
                    : "Hiện chưa có việc gì cần bạn xử lý ở đơn này."}
                </Text>
              </Card>
            </StaggerItem>
          ) : null}
        </Stagger>
      </ScrollView>
    </View>
  );
}

function DraftBuilder({ order, onDelivered }: { order: any; onDelivered: () => void }) {
  const accent = useWorkspaceAccent();
  const toast = useToast();

  const [name, setName] = useState(order.titleSnapshot || "Giáo án cá nhân hoá");
  const [durationWeeks, setDurationWeeks] = useState("8");
  const [startDate, setStartDate] = useState(todayIso());
  const [days, setDays] = useState<DraftDay[]>([emptyDay(1, 1)]);
  const [ptNotes, setPtNotes] = useState("");
  const [aiInfo, setAiInfo] = useState<{ dataGaps: string[]; warnings: string[]; summaryForPt: string } | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const exercises = useQuery({
    queryKey: ["pt-draft-exercises", search],
    queryFn: () => workoutService.getExercises({ search: search || undefined, limit: 20 }),
    enabled: pickFor !== null,
  });
  // `getExercises` already unwraps `{ data: { exercises } }` to the array. The catalogue's field
  // is `exerciseName`, not `name` — reading `.name` rendered a list of blank rows, caught on the
  // emulator. Equipment/muscle come through as `typeOfEquipment` / `muscleGroupsActivated[]`.
  const exerciseRows: any[] = Array.isArray(exercises.data) ? exercises.data : [];

  const generate = useMutation({
    mutationFn: () =>
      ptCoachService.generatePlanDraft(order.buyerId, {
        ptNotes: ptNotes.trim() || undefined,
        daysPerWeek: days.length,
        durationWeeks: Number(durationWeeks) || 8,
      }),
    onSuccess: (res: any) => {
      setAiInfo({ dataGaps: res?.dataGaps ?? [], warnings: res?.warnings ?? [], summaryForPt: res?.summaryForPt ?? "" });
      const resDays: any[] = Array.isArray(res?.days) ? res.days : [];
      if (resDays.length === 0) {
        toast.show("AI chưa gợi ý được bài tập — bạn tự chọn nhé.", "danger");
        return;
      }
      setDays((prev) =>
        resDays.map((d, i) => ({
          dayNumber: d.dayNumber ?? i + 1,
          title: d.title || `Buổi ${i + 1}`,
          weekday: prev[i]?.weekday ?? i,
          exercises: (d.exercises ?? []).map((e: any) => ({
            exerciseId: e.exerciseId,
            name: e.exerciseName ?? "Bài tập",
            sets: e.sets ?? 3,
            reps: e.reps ?? 10,
            restSeconds: 90,
          })),
        })),
      );
      toast.show("AI đã soạn bản nháp — hãy xem lại trước khi gửi", "success");
    },
    onError: (e: any) =>
      toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || "Chưa tạo được bản nháp AI", "danger"),
  });

  const deliver = useMutation({
    mutationFn: () =>
      personalizedServiceApi.deliverDraft(order.id, {
        name: name.trim(),
        goal: order.intakeData?.goal ?? undefined,
        durationWeeks: Number(durationWeeks) || 8,
        daysPerWeek: days.length,
        startDate,
        selectedWeekdays: days.map((d) => d.weekday),
        days: days.map((d) => ({
          dayNumber: d.dayNumber,
          title: d.title.trim() || `Buổi ${d.dayNumber}`,
          exercises: d.exercises.map((e, i) => ({
            exerciseId: e.exerciseId,
            order: i + 1,
            sets: e.sets,
            reps: e.reps,
            restSeconds: e.restSeconds,
          })),
        })),
      }),
    onSuccess: () => {
      toast.show("Đã gửi bản nháp cho khách xem", "success");
      onDelivered();
    },
    onError: (e: any) =>
      toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || "Không gửi được bản nháp", "danger"),
  });

  const used = new Set(days.map((d) => d.weekday));
  const addDay = () =>
    days.length < 7 &&
    setDays((p) => [...p, emptyDay(p.length + 1, [1, 2, 3, 4, 5, 6, 0].find((w) => !used.has(w)) ?? 0)]);
  const removeDay = (i: number) =>
    days.length > 1 && setDays((p) => p.filter((_, j) => j !== i).map((d, j) => ({ ...d, dayNumber: j + 1 })));
  const addExercise = (dayIdx: number, exerciseId: string, exName: string) =>
    setDays((p) =>
      p.map((d, i) =>
        i === dayIdx ? { ...d, exercises: [...d.exercises, { exerciseId, name: exName, sets: 3, reps: 10, restSeconds: 90 }] } : d,
      ),
    );
  const removeExercise = (dayIdx: number, exIdx: number) =>
    setDays((p) => p.map((d, i) => (i === dayIdx ? { ...d, exercises: d.exercises.filter((_, j) => j !== exIdx) } : d)));
  const patchExercise = (dayIdx: number, exIdx: number, patch: Partial<DraftEx>) =>
    setDays((p) =>
      p.map((d, i) =>
        i === dayIdx ? { ...d, exercises: d.exercises.map((e, j) => (j === exIdx ? { ...e, ...patch } : e)) } : d,
      ),
    );

  // Same two rules the server enforces on deliverDraft.
  const error = !name.trim()
    ? "Đặt tên cho giáo án."
    : days.some((d) => d.exercises.length === 0)
      ? "Mỗi buổi cần ít nhất một bài tập."
      : null;

  return (
    <View className="gap-4">
      <Text className="px-1 font-display text-lg text-foreground">Soạn giáo án</Text>

      <Card className="gap-3 p-4">
        <Input label="Tên giáo án *" value={name} onChangeText={setName} />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Input
              label="Số tuần"
              value={durationWeeks}
              onChangeText={(t) => setDurationWeeks(t.replace(/[^\d]/g, ""))}
              keyboardType="number-pad"
            />
          </View>
          <View className="flex-1">
            <Input label="Bắt đầu (YYYY-MM-DD)" value={startDate} onChangeText={setStartDate} />
          </View>
        </View>
      </Card>

      <Card className="gap-2.5 border-primary/30 bg-primary/5 p-4">
        <View className="flex-row items-center gap-1.5">
          <Sparkles size={15} color={accent.primary} />
          <Text className="font-body-semibold text-sm text-foreground">Gợi ý bằng AI</Text>
        </View>
        <Text className="font-body text-xs text-muted-foreground">
          Bản nháp tham khảo — bạn vẫn sửa và chịu trách nhiệm về giáo án gửi cho khách.
        </Text>
        <Input label="Ghi chú cho AI" value={ptNotes} onChangeText={setPtNotes} placeholder="Khách đau vai phải, tránh đẩy qua đầu…" multiline />
        <Button size="sm" variant="secondary" icon={Sparkles} disabled={generate.isPending} onPress={() => generate.mutate()}>
          {generate.isPending ? "Đang soạn…" : "Nhờ AI soạn nháp"}
        </Button>
        {aiInfo?.summaryForPt ? (
          <Text className="font-body text-xs text-muted-foreground">{aiInfo.summaryForPt}</Text>
        ) : null}
        {aiInfo?.warnings?.length ? (
          <Text className="font-body text-xs text-warning">Lưu ý: {aiInfo.warnings.join("; ")}</Text>
        ) : null}
        {aiInfo?.dataGaps?.length ? (
          <Text className="font-body text-xs text-muted-foreground">Thiếu dữ liệu: {aiInfo.dataGaps.join("; ")}</Text>
        ) : null}
      </Card>

      {days.map((d, dayIdx) => (
        <Card key={dayIdx} className="gap-3 p-4">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 font-body-semibold text-sm text-foreground">Buổi {d.dayNumber}</Text>
            <Text className="font-body text-xs text-muted-foreground">{WEEKDAYS[d.weekday]}</Text>
            {days.length > 1 ? (
              <Tappable accessibilityLabel={`Xoá buổi ${d.dayNumber}`} onPress={() => removeDay(dayIdx)} className="h-8 w-8 items-center justify-center rounded-xl bg-panel">
                <Trash2 size={14} color={darkColors.destructive} />
              </Tappable>
            ) : null}
          </View>
          {d.exercises.length === 0 ? (
            <Text className="font-body text-xs text-muted-foreground">Chưa có bài nào.</Text>
          ) : (
            d.exercises.map((ex, exIdx) => (
              <View key={`${ex.exerciseId}-${exIdx}`} className="gap-2 rounded-xl bg-panel p-3">
                <View className="flex-row items-center gap-2">
                  <Text className="min-w-0 flex-1 font-body-semibold text-xs text-foreground" numberOfLines={1}>
                    {ex.name}
                  </Text>
                  <Tappable accessibilityLabel={`Bỏ ${ex.name}`} onPress={() => removeExercise(dayIdx, exIdx)}>
                    <Trash2 size={14} color={darkColors.destructive} />
                  </Tappable>
                </View>
                <View className="flex-row gap-2">
                  <NumField label="Hiệp" value={ex.sets} onChange={(n) => patchExercise(dayIdx, exIdx, { sets: n })} />
                  <NumField label="Lần" value={ex.reps} onChange={(n) => patchExercise(dayIdx, exIdx, { reps: n })} />
                  <NumField label="Nghỉ (s)" value={ex.restSeconds} onChange={(n) => patchExercise(dayIdx, exIdx, { restSeconds: n })} />
                </View>
              </View>
            ))
          )}
          <Button size="sm" variant="secondary" icon={Plus} onPress={() => { setSearch(""); setPickFor(dayIdx); }}>
            Thêm bài tập
          </Button>
        </Card>
      ))}

      {days.length < 7 ? (
        <Button variant="ghost" icon={Plus} onPress={addDay}>
          Thêm buổi
        </Button>
      ) : null}

      {error ? <Text className="font-body text-xs text-destructive">{error}</Text> : null}
      <Button full icon={Send} disabled={!!error || deliver.isPending} onPress={() => deliver.mutate()}>
        {deliver.isPending ? "Đang gửi…" : "Gửi bản nháp cho khách"}
      </Button>

      <BottomSheet open={pickFor !== null} onClose={() => setPickFor(null)} title="Chọn bài tập">
        <View className="gap-3 pb-2">
          <View className="h-11 flex-row items-center gap-2 rounded-xl border border-border bg-panel px-3.5">
            <Search size={16} color={designTokens.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Tìm bài tập"
              placeholderTextColor={inputPlaceholderColor}
              className="flex-1 font-body text-sm text-foreground"
            />
          </View>
          <ScrollView className="max-h-[360px]" keyboardShouldPersistTaps="handled">
            {exercises.isLoading ? (
              <ActivityIndicator className="py-6" color={accent.primary} />
            ) : exerciseRows.length === 0 ? (
              <Text className="py-6 text-center font-body text-sm text-muted-foreground">Không tìm thấy bài tập.</Text>
            ) : (
              exerciseRows.map((ex: any) => (
                <Tappable
                  key={ex.id}
                  accessibilityLabel={exName(ex)}
                  onPress={() => {
                    if (pickFor !== null) addExercise(pickFor, ex.id, exName(ex));
                    setPickFor(null);
                  }}
                  className="border-b border-border py-3"
                >
                  <Text className="font-body-semibold text-sm text-foreground">{exName(ex)}</Text>
                  {exMeta(ex) ? <Text className="font-body text-xs text-muted-foreground">{exMeta(ex)}</Text> : null}
                </Tappable>
              ))
            )}
          </ScrollView>
        </View>
      </BottomSheet>
    </View>
  );
}

/** The exercise catalogue's own field names — see the note on `exerciseRows`. */
function exName(ex: any): string {
  return ex?.exerciseName ?? ex?.name ?? "Bài tập";
}

function exMeta(ex: any): string {
  const muscle = Array.isArray(ex?.muscleGroupsActivated) ? ex.muscleGroupsActivated[0] : ex?.primaryMuscle;
  return [muscle, ex?.typeOfEquipment ?? ex?.equipment].filter(Boolean).join(" · ");
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <View className="flex-1">
      <Text className="mb-1 font-body text-[11px] text-muted-foreground">{label}</Text>
      <TextInput
        value={String(value)}
        onChangeText={(t) => onChange(Number(t.replace(/[^\d]/g, "")) || 0)}
        keyboardType="number-pad"
        className="rounded-lg border border-border bg-background px-2.5 py-2 font-body text-sm text-foreground"
      />
    </View>
  );
}
