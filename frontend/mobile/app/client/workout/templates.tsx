import { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, LayoutTemplate, Plus, Users } from "lucide-react-native";

import {
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  ScreenHeader,
  Segmented,
  Skeleton,
  Stagger,
  StaggerItem,
  Tappable,
  useToast,
} from "../../../src/components/ui";
import { templateService, workoutService } from "../../../src/services/api";
import { usePullToRefresh } from "../../../src/hooks/usePullToRefresh";
import { toDateInputValue } from "../../../src/utils/date";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

const TABS = ["Của tôi", "Được chia sẻ"] as const;
type Tab = (typeof TABS)[number];

const WEEKDAYS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

/**
 * CL-16 — workout program templates.
 *
 * Visual authority: `New Frontend/src/screens/Templates.tsx`. Behavioural authority: web's
 * `TemplatesPage.tsx` — same three actions (create from the current program, import into the
 * calendar, list what was shared with me) against the same `templateService` endpoints.
 *
 * Sharing to a specific person is NOT here: web resolves the recipient from the user's active
 * PT/client contracts (`contractService.getByPT`/`getByClient`), which is the Phase 7/11 contract
 * domain. Until those screens exist on mobile there is no honest way to pick a recipient, so the
 * action is deferred rather than shipped with a free-text user-id field.
 */
export default function TemplatesScreen() {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("Của tôi");
  const [importing, setImporting] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  const programQuery = useQuery({
    queryKey: ["current-workout-program"],
    queryFn: () => workoutService.getCurrentProgram(),
  });
  const mineQuery = useQuery({
    queryKey: ["templates", "mine"],
    queryFn: () => templateService.listMine(),
  });
  const sharedQuery = useQuery({
    queryKey: ["templates", "shared"],
    queryFn: () => templateService.listSharedWithMe(),
  });

  const { refreshing, onRefresh } = usePullToRefresh([
    ["templates", "mine"],
    ["templates", "shared"],
    ["current-workout-program"],
  ]);

  const program: any = programQuery.data;
  const templates =
    tab === "Của tôi" ? (mineQuery.data?.templates ?? []) : (sharedQuery.data?.templates ?? []);
  const loading = tab === "Của tôi" ? mineQuery.isLoading : sharedQuery.isLoading;

  const createFromProgram = useCallback(async () => {
    if (!program?.id) return;
    setBusy(true);
    try {
      await templateService.createFromProgram({ programId: String(program.id) });
      await queryClient.refetchQueries({ queryKey: ["templates", "mine"] });
      toast.show("Đã tạo mẫu từ kế hoạch hiện tại.", "success");
    } catch (e: any) {
      toast.show(e?.response?.data?.error ?? "Không tạo được mẫu.", "danger");
    } finally {
      setBusy(false);
    }
  }, [program?.id, queryClient, toast]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Mẫu buổi tập" onBack={() => router.back()} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} colors={[accent.primary]} />
        }
      >
        <Card className="mb-4 p-4">
          <Text className="font-display text-base text-foreground">Tạo mẫu từ kế hoạch</Text>
          <Text className="mt-1 font-body text-sm text-muted-foreground">
            {program?.name
              ? `Kế hoạch đang dùng: ${program.name}`
              : "Bạn chưa có kế hoạch nào đang chạy để lưu thành mẫu."}
          </Text>
          <View className="mt-3">
            <Button
              full
              icon={Plus}
              disabled={!program?.id || busy}
              onPress={createFromProgram}
            >
              Lưu thành mẫu
            </Button>
          </View>
        </Card>

        <Segmented options={[...TABS]} value={tab} onChange={(next) => setTab(next as Tab)} />

        <View className="pt-4">
          {loading ? (
            <View className="gap-2.5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[84px] rounded-2xl" />
              ))}
            </View>
          ) : templates.length === 0 ? (
            <EmptyState
              icon={LayoutTemplate}
              title={tab === "Của tôi" ? "Chưa có mẫu nào" : "Chưa ai chia sẻ mẫu cho bạn"}
              description={
                tab === "Của tôi"
                  ? "Lưu kế hoạch đang chạy thành mẫu để dùng lại sau."
                  : "Mẫu do PT hoặc bạn tập chia sẻ sẽ xuất hiện ở đây."
              }
            />
          ) : (
            <Stagger className="gap-2.5">
              {templates.map((t: any) => (
                <StaggerItem key={String(t.id)}>
                  <Card className="p-4">
                    <View className="flex-row items-center gap-3">
                      <View className="h-10 w-10 items-center justify-center rounded-xl bg-panel">
                        <LayoutTemplate size={18} color={accent.primary} />
                      </View>
                      <View className="flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {t?.name ?? "Mẫu không tên"}
                        </Text>
                        {t?.description ? (
                          <Text className="mt-0.5 font-body text-xs text-muted-foreground" numberOfLines={2}>
                            {t.description}
                          </Text>
                        ) : null}
                      </View>
                      {tab === "Được chia sẻ" ? (
                        <Badge tone="info">
                          <Users size={11} color={accent.chart3} />
                        </Badge>
                      ) : null}
                    </View>
                    <View className="mt-3">
                      <Button variant="secondary" full icon={CalendarClock} onPress={() => setImporting(t)}>
                        Áp dụng vào lịch
                      </Button>
                    </View>
                  </Card>
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </View>
      </ScrollView>

      <ImportSheet
        template={importing}
        onClose={() => setImporting(null)}
        onImported={async () => {
          setImporting(null);
          await Promise.all([
            queryClient.refetchQueries({ queryKey: ["workout-schedules", "week"] }),
            queryClient.refetchQueries({ queryKey: ["current-workout-program"] }),
          ]).catch(() => {});
          toast.show("Đã áp dụng mẫu vào lịch.", "success");
        }}
        onError={(message) => toast.show(message, "danger")}
      />
    </View>
  );
}

function ImportSheet({
  template,
  onClose,
  onImported,
  onError,
}: {
  template: any | null;
  onClose: () => void;
  onImported: () => void;
  onError: (message: string) => void;
}) {
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [repeatWeeks, setRepeatWeeks] = useState(4);
  const [busy, setBusy] = useState(false);

  const toggle = (value: number) =>
    setWeekdays((prev) =>
      prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value].sort(),
    );

  const submit = async () => {
    if (!template?.id || weekdays.length === 0) return;
    setBusy(true);
    try {
      await templateService.importTemplate(String(template.id), {
        // Start today: the endpoint places the first session on the next selected weekday on or
        // after this date, so "hôm nay" is the sane default rather than a date picker nobody
        // asked for on a phone.
        startDate: toDateInputValue(new Date()),
        selectedWeekdays: weekdays,
        repeatWeeks,
      });
      onImported();
    } catch (e: any) {
      onError(e?.response?.data?.error ?? "Không áp dụng được mẫu.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet open={!!template} onClose={onClose} title="Áp dụng vào lịch">
      <View className="gap-4 pb-2">
        <Text className="font-body text-sm text-muted-foreground">
          Chọn các ngày trong tuần sẽ tập theo mẫu "{template?.name ?? ""}".
        </Text>

        <View className="flex-row flex-wrap gap-2">
          {WEEKDAYS.map((d) => {
            const active = weekdays.includes(d.value);
            return (
              <Tappable
                key={d.value}
                className={`h-11 w-11 items-center justify-center rounded-xl border ${
                  active ? "border-primary bg-primary/15" : "border-border bg-card"
                }`}
                onPress={() => toggle(d.value)}
              >
                <Text
                  className={`font-body-semibold text-xs ${active ? "text-primary" : "text-muted-foreground"}`}
                >
                  {d.label}
                </Text>
              </Tappable>
            );
          })}
        </View>

        <View>
          <Text className="mb-2 font-body text-xs uppercase text-muted-foreground">Lặp lại</Text>
          <Segmented
            options={["2 tuần", "4 tuần", "8 tuần"]}
            value={`${repeatWeeks} tuần`}
            onChange={(next) => setRepeatWeeks(Number(String(next).split(" ")[0]))}
          />
        </View>

        <Button full size="lg" disabled={busy || weekdays.length === 0} onPress={submit}>
          {busy ? "Đang áp dụng…" : "Áp dụng"}
        </Button>
      </View>
    </BottomSheet>
  );
}
