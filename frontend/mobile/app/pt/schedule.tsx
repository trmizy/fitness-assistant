import { useState } from "react";
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarOff,
  CalendarX2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
  UserX,
} from "lucide-react-native";

import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Input,
  Segmented,
  Tappable,
  useToast,
} from "../../src/components/ui";
import { availabilityService, sessionService } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { designTokens } from "../../src/theme/colors";
import {
  DAY_LABELS,
  MONTH_LABEL,
  type AvailabilityBlock,
  availabilityFromServer,
  blockedDateSet,
  clientName,
  isoDate,
  monthCells,
  ptSessionStatus,
  sessionActions,
  sessionDaysIn,
  sessionTimeLabel,
  sessionsOf,
  sessionsOnDay,
} from "../../src/features/pt/pt";
import { DAYS, addBlock, availabilityError } from "../../src/features/ptApplication/ptApplication";

const TABS = ["Buổi tập", "Khung giờ rảnh"];

/**
 * PT-04 — "Lịch dạy". Visual: the design's PTSchedule (two segments, a month calendar with dots,
 * a day list, sheets for the destructive actions). Behaviour: web's PTSchedulePage.
 *
 * The design draws availability as a fixed day × time-slot toggle grid. That is not the model
 * the backend has: `pt_availability` stores free-form start/end ranges per weekday, several per
 * day. Drawing the grid would invent a model and silently discard a trainer's real ranges, so
 * this uses the same range editor (and the same overlap/length validation) as the PT application
 * wizard — see features/pt/pt.ts's note on why that module is reused rather than copied.
 *
 * Reschedule requests and no-show reports (web's two extra response flows) are Phase 11's, with
 * the contracts screen that owns the rest of the dispute surface — they are read here only so a
 * session in that state is not silently actionless.
 */
export default function PtScheduleScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const uid = user?.id ?? "guest";

  const today = new Date();
  const [tab, setTab] = useState(TABS[0]);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [day, setDay] = useState<number>(today.getDate());

  const sessionsQuery = useQuery({ queryKey: ["pt-sessions-upcoming", uid], queryFn: () => sessionService.getMyUpcoming() });
  const availQuery = useQuery({ queryKey: ["pt-availability", uid], queryFn: () => availabilityService.getAvailability("me") });
  const exceptionsQuery = useQuery({ queryKey: ["pt-exceptions", uid], queryFn: () => availabilityService.getExceptions() });

  const sessions = sessionsOf(sessionsQuery.data);
  const marked = sessionDaysIn(sessions, year, month);
  const daySessions = sessionsOnDay(sessions, year, month, day);
  const blocked = blockedDateSet(exceptionsQuery.data);
  const exceptions: any[] = Array.isArray(exceptionsQuery.data) ? exceptionsQuery.data : [];

  const invalidateSessions = () => {
    void queryClient.invalidateQueries({ queryKey: ["pt-sessions-upcoming", uid] });
    void queryClient.invalidateQueries({ queryKey: ["pt-contracts", uid] });
  };
  const fail = (e: any, fallback: string) =>
    toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || fallback, "danger");

  const confirm = useMutation({
    mutationFn: (id: string) => sessionService.confirmSession(id),
    onSuccess: () => {
      toast.show("Đã xác nhận buổi tập", "success");
      invalidateSessions();
    },
    onError: (e) => fail(e, "Không xác nhận được buổi tập"),
  });
  const complete = useMutation({
    mutationFn: (id: string) => sessionService.completeSession(id),
    onSuccess: () => {
      toast.show("Đã báo hoàn thành — chờ học viên xác nhận", "success");
      invalidateSessions();
    },
    onError: (e) => fail(e, "Không báo hoàn thành được"),
  });
  const noShow = useMutation({
    mutationFn: (id: string) => sessionService.markNoShow(id, "CLIENT"),
    onSuccess: () => {
      toast.show("Đã báo học viên vắng mặt", "success");
      invalidateSessions();
    },
    onError: (e) => fail(e, "Không báo vắng mặt được"),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => sessionService.cancelSession(id, "PT huỷ buổi tập"),
    onSuccess: () => {
      toast.show("Đã huỷ buổi tập", "success");
      invalidateSessions();
    },
    onError: (e) => fail(e, "Không huỷ được buổi tập"),
  });

  const askCancel = (id: string, name: string) =>
    Alert.alert("Huỷ buổi tập?", `Buổi với ${name} sẽ bị huỷ. Học viên sẽ nhận được thông báo.`, [
      { text: "Không", style: "cancel" },
      { text: "Huỷ buổi", style: "destructive", onPress: () => cancel.mutate(id) },
    ]);
  const askNoShow = (id: string, name: string) =>
    Alert.alert("Báo học viên vắng?", `${name} sẽ bị tính là vắng mặt và mất một buổi trong gói.`, [
      { text: "Không", style: "cancel" },
      { text: "Báo vắng", style: "destructive", onPress: () => noShow.mutate(id) },
    ]);

  const busy = confirm.isPending || complete.isPending || noShow.isPending || cancel.isPending;

  const step = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setDay(1);
  };

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }}
        refreshControl={
          <RefreshControl
            refreshing={sessionsQuery.isRefetching || availQuery.isRefetching}
            onRefresh={() => {
              void sessionsQuery.refetch();
              void availQuery.refetch();
              void exceptionsQuery.refetch();
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <View className="px-5">
          <Text className="mb-4 font-display text-2xl text-foreground">Lịch dạy</Text>
          <Segmented options={TABS} value={tab} onChange={setTab} />
        </View>

        {tab === TABS[0] ? (
          <View className="gap-4 p-5">
            <Card className="p-4">
              <View className="flex-row items-center justify-between">
                <Tappable accessibilityLabel="Tháng trước" onPress={() => step(-1)} className="h-9 w-9 items-center justify-center rounded-xl bg-panel">
                  <ChevronLeft size={18} color={designTokens.mutedForeground} />
                </Tappable>
                <Text className="font-display text-base text-foreground">{MONTH_LABEL(year, month)}</Text>
                <Tappable accessibilityLabel="Tháng sau" onPress={() => step(1)} className="h-9 w-9 items-center justify-center rounded-xl bg-panel">
                  <ChevronRight size={18} color={designTokens.mutedForeground} />
                </Tappable>
              </View>

              <View className="mt-3 flex-row">
                {DAY_LABELS.map((d) => (
                  <Text key={d} className="flex-1 text-center font-body text-[11px] text-muted-foreground">
                    {d}
                  </Text>
                ))}
              </View>

              <View className="mt-1 flex-row flex-wrap">
                {monthCells(year, month).map((cell, i) => {
                  if (cell == null) return <View key={`e${i}`} className="h-11 w-[14.28%]" />;
                  const selected = cell === day;
                  const isBlocked = blocked.has(isoDate(year, month, cell));
                  const isToday =
                    cell === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                  return (
                    <Tappable
                      key={cell}
                      accessibilityLabel={`Ngày ${cell}`}
                      onPress={() => setDay(cell)}
                      className="h-11 w-[14.28%] items-center justify-center"
                    >
                      <View
                        className={`h-9 w-9 items-center justify-center rounded-full ${
                          selected ? "bg-primary" : isToday ? "border border-primary/40" : ""
                        }`}
                      >
                        <Text
                          className={`font-body-semibold text-sm ${
                            selected ? "text-on-primary" : isBlocked ? "text-muted-foreground line-through" : "text-foreground"
                          }`}
                        >
                          {cell}
                        </Text>
                      </View>
                      <View className={`mt-0.5 h-1 w-1 rounded-full ${marked.has(cell) && !selected ? "bg-primary" : ""}`} />
                    </Tappable>
                  );
                })}
              </View>
            </Card>

            {sessionsQuery.isLoading ? (
              <ActivityIndicator color={accent.primary} />
            ) : sessionsQuery.isError ? (
              <Text className="font-body text-sm text-destructive">Không tải được lịch dạy. Kéo xuống để thử lại.</Text>
            ) : daySessions.length === 0 ? (
              <EmptyState
                icon={CalendarX2}
                title="Không có buổi nào ngày này"
                description={
                  blocked.has(isoDate(year, month, day))
                    ? "Bạn đã đánh dấu nghỉ ngày này."
                    : "Chọn ngày khác trên lịch để xem buổi tập."
                }
              />
            ) : (
              daySessions.map((s) => {
                const st = ptSessionStatus(s.status);
                const name = clientName(s);
                const actions = sessionActions(s);
                return (
                  <Card key={s.id} className="gap-3 p-4">
                    <View className="flex-row items-center gap-3">
                      <Avatar name={name} size={40} />
                      <View className="min-w-0 flex-1">
                        <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                          {name}
                        </Text>
                        <View className="flex-row items-center gap-1">
                          <Clock size={12} color={designTokens.mutedForeground} />
                          <Text className="font-body text-xs text-muted-foreground">
                            {sessionTimeLabel(s.scheduledStartAt)}
                            {s.scheduledEndAt ? ` – ${sessionTimeLabel(s.scheduledEndAt)}` : ""}
                            {s.sessionMode ? ` · ${s.sessionMode === "ONLINE" ? "Online" : "Trực tiếp"}` : ""}
                          </Text>
                        </View>
                      </View>
                      <Badge tone={st.tone === "neutral" ? "info" : st.tone}>{st.label}</Badge>
                    </View>
                    {st.note ? <Text className="font-body text-xs text-muted-foreground">{st.note}</Text> : null}
                    {actions.length > 0 ? (
                      <View className="flex-row flex-wrap gap-2">
                        {actions.includes("confirm") ? (
                          <Button size="sm" icon={Check} disabled={busy} onPress={() => confirm.mutate(s.id)}>
                            Xác nhận
                          </Button>
                        ) : null}
                        {actions.includes("complete") ? (
                          <Button size="sm" icon={Check} disabled={busy} onPress={() => complete.mutate(s.id)}>
                            Đã dạy xong
                          </Button>
                        ) : null}
                        {actions.includes("noShow") ? (
                          <Button size="sm" variant="secondary" icon={UserX} disabled={busy} onPress={() => askNoShow(s.id, name)}>
                            Báo vắng
                          </Button>
                        ) : null}
                        {actions.includes("cancel") ? (
                          <Button size="sm" variant="ghost" icon={CalendarOff} disabled={busy} onPress={() => askCancel(s.id, name)}>
                            Huỷ buổi
                          </Button>
                        ) : null}
                      </View>
                    ) : null}
                  </Card>
                );
              })
            )}
          </View>
        ) : (
          <AvailabilityTab
            blocks={availabilityFromServer(availQuery.data)}
            loading={availQuery.isLoading}
            exceptions={exceptions}
            uid={uid}
          />
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Weekly ranges + blocked days. `PUT /availability/me` REPLACES the whole week, so the editor
 * always sends the full list, and a save that drops a day is a real deletion — hence the explicit
 * save button rather than per-toggle autosave.
 */
function AvailabilityTab({
  blocks,
  loading,
  exceptions,
  uid,
}: {
  blocks: AvailabilityBlock[];
  loading: boolean;
  exceptions: any[];
  uid: string;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();

  // null = untouched, so the server list stays authoritative and a refetch is visible; the moment
  // the trainer edits, the draft takes over until it is saved or undone.
  const [draft, setDraft] = useState<AvailabilityBlock[] | null>(null);
  const current = draft ?? blocks;
  const dirty = draft !== null;
  const error = availabilityError(current as never, 60);

  const [sheet, setSheet] = useState(false);
  const [blockDate, setBlockDate] = useState("");
  const [blockReason, setBlockReason] = useState("");

  const save = useMutation({
    mutationFn: () => availabilityService.setAvailability(current),
    onSuccess: () => {
      toast.show("Đã lưu khung giờ rảnh", "success");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["pt-availability", uid] });
    },
    onError: (e: any) =>
      toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || "Không lưu được khung giờ", "danger"),
  });

  const addException = useMutation({
    mutationFn: () => availabilityService.addException(blockDate.trim(), blockReason.trim() || undefined),
    onSuccess: () => {
      toast.show("Đã đánh dấu ngày nghỉ", "success");
      setSheet(false);
      setBlockDate("");
      setBlockReason("");
      void queryClient.invalidateQueries({ queryKey: ["pt-exceptions", uid] });
    },
    onError: (e: any) =>
      toast.show(e?.response?.data?.error?.message || e?.response?.data?.error || "Không thêm được ngày nghỉ", "danger"),
  });

  const removeException = useMutation({
    mutationFn: (id: string) => availabilityService.removeException(id),
    onSuccess: () => {
      toast.show("Đã bỏ ngày nghỉ", "success");
      void queryClient.invalidateQueries({ queryKey: ["pt-exceptions", uid] });
    },
    onError: () => toast.show("Không bỏ được ngày nghỉ", "danger"),
  });

  const dateError = blockDate && !/^\d{4}-\d{2}-\d{2}$/.test(blockDate.trim()) ? "Ngày theo dạng YYYY-MM-DD." : null;

  return (
    <View className="gap-4 p-5">
      <Text className="font-body text-sm text-muted-foreground">
        Học viên chỉ đặt được buổi trong các khung giờ này. Mỗi ngày có thể có nhiều khung; giờ theo dạng HH:MM.
      </Text>

      {loading ? (
        <ActivityIndicator color={accent.primary} />
      ) : (
        DAYS.map((d) => {
          const dayBlocks = current.filter((b) => b.dayOfWeek === d.value);
          return (
            <Card key={d.value} className="gap-2.5 p-4">
              <View className="flex-row items-center justify-between">
                <Text className="font-body-semibold text-sm text-foreground">{d.label}</Text>
                <Tappable
                  accessibilityLabel={`Thêm khung giờ ${d.label}`}
                  onPress={() => setDraft(addBlock(current as never, d.value, 60) as AvailabilityBlock[])}
                  className="flex-row items-center gap-1"
                >
                  <Plus size={14} color={accent.primary} />
                  <Text className="font-body-semibold text-xs text-primary">Thêm khung</Text>
                </Tappable>
              </View>
              {dayBlocks.length === 0 ? (
                <Text className="font-body text-xs text-muted-foreground">Không nhận buổi</Text>
              ) : (
                dayBlocks.map((b, i) => (
                  <View key={`${d.value}-${i}`} className="flex-row items-center gap-2">
                    <View className="flex-1">
                      <Input
                        value={b.startTime}
                        onChangeText={(t) => setDraft(editBlock(current, d.value, i, "startTime", t))}
                        placeholder="08:00"
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                    <Text className="font-body text-sm text-muted-foreground">–</Text>
                    <View className="flex-1">
                      <Input
                        value={b.endTime}
                        onChangeText={(t) => setDraft(editBlock(current, d.value, i, "endTime", t))}
                        placeholder="09:00"
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                    <Tappable
                      accessibilityLabel={`Xoá khung ${d.label} ${b.startTime}`}
                      onPress={() => setDraft(removeBlock(current, d.value, i))}
                      className="h-9 w-9 items-center justify-center rounded-xl bg-panel"
                    >
                      <Trash2 size={16} color={designTokens.destructive} />
                    </Tappable>
                  </View>
                ))
              )}
            </Card>
          );
        })
      )}

      {dirty ? (
        <View className="gap-2">
          {error ? <Text className="font-body text-xs text-destructive">{error}</Text> : null}
          <View className="flex-row gap-2">
            <Button variant="secondary" className="flex-1" onPress={() => setDraft(null)}>
              Hoàn tác
            </Button>
            <Button className="flex-1" disabled={!!error || save.isPending} onPress={() => save.mutate()}>
              {save.isPending ? "Đang lưu…" : "Lưu khung giờ"}
            </Button>
          </View>
        </View>
      ) : null}

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="font-display text-lg text-foreground">Ngày nghỉ</Text>
        <Tappable accessibilityLabel="Thêm ngày nghỉ" onPress={() => setSheet(true)} className="flex-row items-center gap-1">
          <Plus size={14} color={accent.primary} />
          <Text className="font-body-semibold text-xs text-primary">Thêm</Text>
        </Tappable>
      </View>
      {exceptions.length === 0 ? (
        <Text className="font-body text-sm text-muted-foreground">Chưa có ngày nghỉ nào.</Text>
      ) : (
        <Card className="overflow-hidden">
          {exceptions.map((e, i) => (
            <View key={e.id} className={`flex-row items-center gap-3 p-4 ${i > 0 ? "border-t border-border" : ""}`}>
              <CalendarOff size={16} color={designTokens.mutedForeground} />
              <View className="min-w-0 flex-1">
                <Text className="font-body-semibold text-sm text-foreground">
                  {new Date(e.date).toLocaleDateString("vi-VN")}
                </Text>
                {e.reason ? <Text className="font-body text-xs text-muted-foreground">{e.reason}</Text> : null}
              </View>
              <Tappable
                accessibilityLabel="Bỏ ngày nghỉ"
                onPress={() => removeException.mutate(e.id)}
                className="h-9 w-9 items-center justify-center rounded-xl bg-panel"
              >
                <Trash2 size={16} color={designTokens.destructive} />
              </Tappable>
            </View>
          ))}
        </Card>
      )}

      <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Đánh dấu ngày nghỉ">
        <View className="gap-3 pb-2">
          <Input label="Ngày (YYYY-MM-DD)" value={blockDate} onChangeText={setBlockDate} placeholder="2026-10-01" />
          <Input label="Lý do (tuỳ chọn)" value={blockReason} onChangeText={setBlockReason} placeholder="Nghỉ cá nhân" />
          {dateError ? <Text className="font-body text-xs text-destructive">{dateError}</Text> : null}
          <Text className="font-body text-xs text-muted-foreground">
            Buổi tập đã đặt trong ngày này không tự huỷ — hệ thống sẽ xử lý theo chính sách huỷ của buổi đó.
          </Text>
          <Button
            full
            disabled={!blockDate.trim() || !!dateError || addException.isPending}
            onPress={() => addException.mutate()}
          >
            {addException.isPending ? "Đang lưu…" : "Đánh dấu nghỉ"}
          </Button>
        </View>
      </BottomSheet>
    </View>
  );
}

/** Edits address a block by (day, index-within-that-day), because the list is flat. */
function editBlock(
  blocks: AvailabilityBlock[],
  day: string,
  indexInDay: number,
  field: "startTime" | "endTime",
  value: string,
): AvailabilityBlock[] {
  let seen = -1;
  return blocks.map((b) => {
    if (b.dayOfWeek !== day) return b;
    seen += 1;
    if (seen !== indexInDay) return b;
    // Keep what is typed — `availabilityError` reports a malformed time, `isTime` only decides
    // whether it is already valid, so half-typed "08:" must survive the keystroke.
    return { ...b, [field]: value.slice(0, 5) };
  });
}

function removeBlock(blocks: AvailabilityBlock[], day: string, indexInDay: number): AvailabilityBlock[] {
  let seen = -1;
  return blocks.filter((b) => {
    if (b.dayOfWeek !== day) return true;
    seen += 1;
    return seen !== indexInDay;
  });
}
