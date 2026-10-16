import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ClipboardList, Link2, Pencil, Plus, Trash2, Unlink } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, EmptyState, Input, ScreenHeader, Tappable, useToast } from "../../../../src/components/ui";
import { workoutService } from "../../../../src/services/api";
import { useWorkspaceAccent } from "../../../../src/theme/workspace";
import { darkColors } from "../../../../src/theme/colors";
import { ExercisePickerSheet } from "../../../../src/features/workout/ExercisePickerSheet";
import {
  GROUP_TYPE_LABEL,
  daySaveOps,
  editExercisesFromDay,
  groupIndex,
  groupTypeFor,
  type EditExercise,
} from "../../../../src/features/workout/programEdit";

/**
 * 14B.4 (PG-A3) — "Chương trình của tôi": web WorkoutLogPage's program side on one screen — the
 * current program, each day's exercises (edit sets / reps / rest, add from the catalog or own custom
 * exercises, remove), rename a day, group exercises into a superset / triset / circuit and ungroup,
 * hide the program, and a door to a new manual program. Edits go through the endpoints web uses; the
 * server validates exercise ids and refuses an empty day.
 */
export default function ProgramsScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [openDay, setOpenDay] = useState<string | null>(null);

  const programQuery = useQuery({ queryKey: ["workout-current-program"], queryFn: () => workoutService.getCurrentProgram() });
  const program: any = programQuery.data;
  const days: any[] = Array.isArray(program?.days) ? [...program.days].sort((a, b) => a.dayNumber - b.dayNumber) : [];
  const back = () => (router.canGoBack() ? router.back() : router.replace("/client/workout"));

  const refresh = () =>
    Promise.all([
      queryClient.refetchQueries({ queryKey: ["workout-current-program"] }),
      queryClient.invalidateQueries({ queryKey: ["workout-schedules"] }),
    ]).catch(() => {});

  const archive = () =>
    Alert.alert("Ẩn chương trình?", "Ẩn chương trình hiện tại? Workout đã hoàn thành sẽ không bị xoá.", [
      { text: "Không", style: "cancel" },
      {
        text: "Ẩn",
        style: "destructive",
        onPress: async () => {
          try {
            await workoutService.archiveProgram(String(program.id));
            toast.show("Đã ẩn chương trình.", "success");
            await refresh();
          } catch (e: any) {
            toast.show(e?.response?.data?.error ?? "Không thể ẩn chương trình.", "danger");
          }
        },
      },
    ]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Chương trình của tôi" onBack={back} />
      {programQuery.isLoading ? (
        <ActivityIndicator className="mt-12" color={accent.primary} />
      ) : !program ? (
        <View className="gap-4 p-5">
          <EmptyState icon={ClipboardList} title="Chưa có chương trình" description="Tự soạn một chương trình, hoặc tạo bằng AI trong Kế hoạch." />
          <Button full icon={Plus} onPress={() => router.push("/client/workout/programs/new")}>
            Tạo chương trình thủ công
          </Button>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 14 }}>
          <Card className="gap-2 p-4">
            <Text className="font-display text-xl text-foreground">{program.name}</Text>
            <Text className="font-body text-sm text-muted-foreground">
              {program.durationWeeks ?? "—"} tuần · {program.daysPerWeek ?? days.length} buổi/tuần
            </Text>
            <View className="mt-1 flex-row gap-2">
              <View className="flex-1">
                <Button full size="sm" variant="secondary" icon={Plus} onPress={() => router.push("/client/workout/programs/new")}>
                  Chương trình mới
                </Button>
              </View>
              <View className="flex-1">
                <Button full size="sm" variant="ghost" icon={Trash2} onPress={archive}>
                  Ẩn chương trình
                </Button>
              </View>
            </View>
          </Card>

          {days.map((day) => (
            <DayCard key={day.id} day={day} open={openDay === day.id} onToggle={() => setOpenDay(openDay === day.id ? null : day.id)} onChanged={refresh} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function DayCard({ day, open, onToggle, onChanged }: { day: any; open: boolean; onToggle: () => void; onChanged: () => Promise<unknown> }) {
  const toast = useToast();
  const accent = useWorkspaceAccent();
  const [editing, setEditing] = useState<EditExercise[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [title, setTitle] = useState(String(day.title ?? ""));
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [restBetween, setRestBetween] = useState("30");
  const [restAfter, setRestAfter] = useState("90");

  const groups = groupIndex(day);
  const rows = editing ?? editExercisesFromDay(day);

  const startEdit = () => {
    setGroupMode(false);
    setEditing(editExercisesFromDay(day));
  };
  const patch = (i: number, p: Partial<EditExercise>) => setEditing((prev) => (prev ?? []).map((e, j) => (j === i ? { ...e, ...p } : e)));

  const save = async () => {
    const plan = daySaveOps(day, editing ?? []);
    if (!plan.ok) {
      toast.show(plan.error, "danger");
      return;
    }
    setSaving(true);
    try {
      for (const op of plan.ops) {
        if (op.kind === "update") await workoutService.updateProgramExercise(op.programExerciseId, op.payload);
        else if (op.kind === "add") await workoutService.addProgramExercise(String(day.id), op.payload);
        else await workoutService.deleteProgramExercise(op.programExerciseId);
      }
      toast.show("Đã lưu buổi tập.", "success");
      setEditing(null);
      await onChanged();
    } catch (e: any) {
      toast.show(e?.response?.data?.error ?? "Không lưu được buổi tập.", "danger");
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  const rename = async () => {
    const t = title.trim();
    setRenameOpen(false);
    if (!t || t === day.title) return;
    try {
      await workoutService.updateProgramDay(String(day.id), { title: t });
      await onChanged();
    } catch (e: any) {
      toast.show(e?.response?.data?.error ?? "Không đổi được tên buổi.", "danger");
    }
  };

  const createGroup = async () => {
    const type = groupTypeFor(selected.size);
    if (!type) return;
    try {
      await workoutService.createExerciseGroup(String(day.id), [...selected], type, Number(restBetween) || 0, Number(restAfter) || 0);
      toast.show(`Đã nhóm ${selected.size} bài tập thành ${GROUP_TYPE_LABEL[type]}.`, "success");
      setGroupMode(false);
      setSelected(new Set());
      await onChanged();
    } catch (e: any) {
      toast.show(e?.response?.data?.error ?? "Không thể nhóm các bài tập này.", "danger");
    }
  };
  const ungroup = async (groupId: string) => {
    try {
      await workoutService.ungroupExercises(groupId);
      toast.show("Đã bỏ nhóm bài tập.", "success");
      await onChanged();
    } catch (e: any) {
      toast.show(e?.response?.data?.error ?? "Không thể bỏ nhóm bài tập này.", "danger");
    }
  };

  const groupType = groupTypeFor(selected.size);

  return (
    <Card className="p-0">
      <Tappable onPress={onToggle} className="flex-row items-center gap-3 p-4">
        <View className="flex-1">
          <Text className="font-body-semibold text-sm text-foreground">{day.title || `Buổi ${day.dayNumber}`}</Text>
          <Text className="font-body text-xs text-muted-foreground">{(day.exercises ?? []).length} bài</Text>
        </View>
        {open ? <ChevronUp size={18} color="#8b9299" /> : <ChevronDown size={18} color="#8b9299" />}
      </Tappable>

      {open ? (
        <View className="gap-2 border-t border-border p-4">
          {rows.map((ex, i) => {
            const g = ex.programExerciseId ? groups.get(ex.programExerciseId) : undefined;
            const isSel = !!ex.programExerciseId && selected.has(ex.programExerciseId);
            return (
              <Tappable
                key={`${ex.programExerciseId ?? "new"}-${i}`}
                disabled={!groupMode || !ex.programExerciseId || !!g}
                onPress={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    const id = String(ex.programExerciseId);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                className={`gap-2 rounded-xl border p-3 ${isSel ? "border-primary bg-primary/10" : "border-transparent bg-panel"}`}
              >
                <View className="flex-row items-center gap-2">
                  {g ? <Badge tone="info">{`${GROUP_TYPE_LABEL[g.type] ?? g.type} · Bài ${g.position}`}</Badge> : null}
                  <Text className="min-w-0 flex-1 font-body-semibold text-sm text-foreground" numberOfLines={1}>
                    {ex.name}
                  </Text>
                  {editing ? (
                    <Tappable accessibilityLabel={`Bỏ ${ex.name}`} onPress={() => setEditing((prev) => (prev ?? []).filter((_, j) => j !== i))}>
                      <Trash2 size={14} color={darkColors.destructive} />
                    </Tappable>
                  ) : (
                    <Text className="font-body text-xs text-muted-foreground">
                      {ex.sets} × {ex.reps} · nghỉ {ex.restSeconds}s
                    </Text>
                  )}
                </View>
                {editing ? (
                  <View className="flex-row gap-2">
                    {(
                      [
                        ["sets", "Hiệp"],
                        ["reps", "Lần"],
                        ["restSeconds", "Nghỉ (s)"],
                      ] as const
                    ).map(([k, label]) => (
                      <View key={k} className="flex-1">
                        <Text className="mb-1 font-body text-[11px] text-muted-foreground">{label}</Text>
                        <TextInput
                          value={String(ex[k])}
                          onChangeText={(t) => patch(i, { [k]: Number(t.replace(/[^\d]/g, "")) || 0 } as Partial<EditExercise>)}
                          keyboardType="number-pad"
                          className="rounded-lg border border-border bg-background px-2.5 py-2 font-body text-sm text-foreground"
                        />
                      </View>
                    ))}
                  </View>
                ) : null}
              </Tappable>
            );
          })}

          {/* Existing groups can be dissolved (web: "Bỏ nhóm"). */}
          {!editing && !groupMode
            ? [...new Set([...groups.values()].map((g) => g.groupId))].map((gid) => {
                const g = [...groups.values()].find((x) => x.groupId === gid)!;
                return (
                  <Button key={gid} size="sm" variant="ghost" icon={Unlink} onPress={() => void ungroup(gid)}>
                    {`Bỏ nhóm ${GROUP_TYPE_LABEL[g.type] ?? g.type}`}
                  </Button>
                );
              })
            : null}

          {editing ? (
            <>
              <Button size="sm" variant="secondary" icon={Plus} onPress={() => setPicking(true)}>
                Thêm bài tập
              </Button>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button full variant="secondary" onPress={() => setEditing(null)}>
                    Hủy
                  </Button>
                </View>
                <View className="flex-1">
                  <Button full disabled={saving} onPress={() => void save()}>
                    {saving ? "Đang lưu…" : "Lưu buổi tập"}
                  </Button>
                </View>
              </View>
            </>
          ) : groupMode ? (
            <View className="gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <Text className="font-body text-xs text-foreground">
                {selected.size < 2 ? "Chọn ít nhất 2 bài chưa thuộc nhóm nào." : `Sẽ tạo ${GROUP_TYPE_LABEL[groupType ?? "SUPERSET"]} từ ${selected.size} bài.`}
              </Text>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Input label="Nghỉ giữa các bài (s)" value={restBetween} onChangeText={(t) => setRestBetween(t.replace(/[^\d]/g, ""))} keyboardType="number-pad" />
                </View>
                <View className="flex-1">
                  <Input label="Nghỉ sau mỗi vòng (s)" value={restAfter} onChangeText={(t) => setRestAfter(t.replace(/[^\d]/g, ""))} keyboardType="number-pad" />
                </View>
              </View>
              <View className="flex-row gap-2">
                <View className="flex-1">
                  <Button full size="sm" variant="secondary" onPress={() => { setGroupMode(false); setSelected(new Set()); }}>
                    Hủy
                  </Button>
                </View>
                <View className="flex-1">
                  <Button full size="sm" icon={Link2} disabled={!groupType} onPress={() => void createGroup()}>
                    Nhóm bài
                  </Button>
                </View>
              </View>
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon={Pencil} onPress={startEdit}>
                Sửa bài
              </Button>
              <Button size="sm" variant="ghost" onPress={() => { setTitle(String(day.title ?? "")); setRenameOpen(true); }}>
                Đổi tên buổi
              </Button>
              {(day.exercises ?? []).length >= 2 ? (
                <Button size="sm" variant="ghost" icon={Link2} onPress={() => setGroupMode(true)}>
                  Nhóm superset
                </Button>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      <ExercisePickerSheet
        open={picking}
        includeCustom
        onPick={(ex) => {
          setEditing((prev) => [...(prev ?? []), { programExerciseId: null, exerciseId: ex.id, name: ex.name, sets: 3, reps: 10, restSeconds: 90, notes: null }]);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
      <BottomSheet open={renameOpen} onClose={() => setRenameOpen(false)} title="Tên buổi tập">
        <View className="gap-3 pb-2">
          <Input value={title} onChangeText={setTitle} autoFocus />
          <Button full disabled={!title.trim()} onPress={() => void rename()}>
            Lưu tên
          </Button>
        </View>
      </BottomSheet>
      {saving ? <ActivityIndicator className="pb-3" color={accent.primary} /> : null}
    </Card>
  );
}
