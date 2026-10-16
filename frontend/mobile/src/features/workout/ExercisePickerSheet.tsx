import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2 } from "lucide-react-native";

import { BottomSheet, Button, Input, Segmented, Tappable, inputPlaceholderColor, useToast } from "../../components/ui";
import { workoutService } from "../../services/api";
import { useWorkspaceAccent } from "../../theme/workspace";
import { darkColors, designTokens } from "../../theme/colors";
import { LOGGING_MODES, customExercisePayload, enumLabel, filterOptions } from "./programEdit";

/**
 * Exercise picker shared by the plan builders and the program editor (14B.4). Searches the catalog;
 * with `includeCustom` it also lists the user's own custom exercises ("Bài của tôi", never returned by
 * the catalog search) and can create / archive them — web's CreateCustomExerciseModal, including the
 * duplicate check that needs an explicit "vẫn tạo" to bypass. Coaches building for a client do not get
 * the custom section: a coach's own custom exercises are not valid ids for the client's program.
 */
export function ExercisePickerSheet({
  open,
  includeCustom = false,
  onPick,
  onClose,
}: {
  open: boolean;
  includeCustom?: boolean;
  onPick: (exercise: { id: string; name: string }) => void;
  onClose: () => void;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const catalog = useQuery({
    queryKey: ["pt-draft-exercises", search],
    queryFn: () => workoutService.getExercises({ search: search || undefined, limit: 20 }),
    enabled: open && !creating,
  });
  const mine = useQuery({
    queryKey: ["my-custom-exercises"],
    queryFn: () => workoutService.listMyCustomExercises(),
    enabled: open && includeCustom,
    staleTime: 10_000,
  });
  const archive = useMutation({
    mutationFn: (id: string) => workoutService.archiveCustomExercise(id),
    onSuccess: () => {
      toast.show("Đã lưu trữ bài tập tùy chỉnh.", "success");
      void queryClient.invalidateQueries({ queryKey: ["my-custom-exercises"] });
    },
    onError: (e: any) => toast.show(e?.response?.data?.error || "Không thể lưu trữ bài tập này.", "danger"),
  });

  const rows: any[] = Array.isArray(catalog.data) ? catalog.data : [];
  const myRows: any[] = Array.isArray(mine.data) ? mine.data : [];
  const close = () => {
    setCreating(false);
    setSearch("");
    onClose();
  };
  // Picking closes the sheet from the parent, so it resets the search here too (else the next open
  // starts with the previous query).
  const pick = (ex: { id: string; name: string }) => {
    setCreating(false);
    setSearch("");
    onPick(ex);
  };

  return (
    <BottomSheet open={open} onClose={close} title={creating ? "Tạo bài tập của bạn" : "Chọn bài tập"}>
      {open && creating ? (
        <CustomExerciseForm
          onCancel={() => setCreating(false)}
          onCreated={(ex) => {
            setCreating(false);
            void queryClient.invalidateQueries({ queryKey: ["my-custom-exercises"] });
            if (ex?.id) pick({ id: String(ex.id), name: String(ex.exerciseName ?? "Bài tập") });
          }}
        />
      ) : open ? (
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
          <ScrollView className="max-h-[400px]" keyboardShouldPersistTaps="handled">
            {includeCustom ? (
              <View className="mb-2">
                <View className="flex-row items-center justify-between py-1">
                  <Text className="font-body-semibold text-xs text-muted-foreground">Bài của tôi</Text>
                  <Tappable onPress={() => setCreating(true)} className="flex-row items-center gap-1 py-1">
                    <Plus size={13} color={accent.primary} />
                    <Text className="font-body-semibold text-xs text-primary">Tạo bài mới</Text>
                  </Tappable>
                </View>
                {myRows.length === 0 ? (
                  <Text className="pb-2 font-body text-[11px] text-muted-foreground">Chưa có bài tự tạo nào.</Text>
                ) : (
                  myRows.map((ex: any) => (
                    <View key={ex.id} className="flex-row items-center border-b border-border py-3">
                      <Tappable className="flex-1" onPress={() => pick({ id: String(ex.id), name: String(ex.exerciseName) })}>
                        <Text className="font-body-semibold text-sm text-foreground">{ex.exerciseName}</Text>
                        <Text className="font-body text-xs text-muted-foreground">
                          {[enumLabel(String(ex.bodyPart ?? "")), enumLabel(String(ex.typeOfEquipment ?? ""))].filter(Boolean).join(" · ")}
                        </Text>
                      </Tappable>
                      <Tappable accessibilityLabel={`Lưu trữ ${ex.exerciseName}`} onPress={() => archive.mutate(String(ex.id))} className="p-2">
                        <Trash2 size={14} color={darkColors.destructive} />
                      </Tappable>
                    </View>
                  ))
                )}
                <Text className="pb-1 pt-3 font-body-semibold text-xs text-muted-foreground">Thư viện</Text>
              </View>
            ) : null}
            {catalog.isLoading ? (
              <ActivityIndicator className="py-6" color={accent.primary} />
            ) : catalog.isError ? (
              <Text className="py-6 text-center font-body text-sm text-destructive">Không thể tải danh sách bài tập. Vui lòng thử lại.</Text>
            ) : rows.length === 0 ? (
              <Text className="py-6 text-center font-body text-sm text-muted-foreground">Không tìm thấy bài tập.</Text>
            ) : (
              rows.map((ex: any) => {
                const muscle = Array.isArray(ex?.muscleGroupsActivated) ? ex.muscleGroupsActivated[0] : ex?.primaryMuscle;
                return (
                  <Tappable
                    key={ex.id}
                    accessibilityLabel={ex.exerciseName}
                    onPress={() => pick({ id: String(ex.id), name: String(ex.exerciseName ?? ex.name ?? "Bài tập") })}
                    className="border-b border-border py-3"
                  >
                    <Text className="font-body-semibold text-sm text-foreground">{ex.exerciseName ?? ex.name}</Text>
                    <Text className="font-body text-xs text-muted-foreground">{[muscle, ex?.typeOfEquipment].filter(Boolean).join(" · ")}</Text>
                  </Tappable>
                );
              })
            )}
          </ScrollView>
        </View>
      ) : null}
    </BottomSheet>
  );
}

function Choice({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View>
      <Text className="mb-1.5 font-body text-xs text-muted-foreground">{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.map((o) => (
          <Tappable
            key={o}
            onPress={() => onChange(o)}
            className={`rounded-full border px-3 py-1.5 ${value === o ? "border-primary bg-primary" : "border-border bg-panel"}`}
          >
            <Text className={`font-body text-xs ${value === o ? "text-on-primary" : "text-muted-foreground"}`}>{enumLabel(o)}</Text>
          </Tappable>
        ))}
      </ScrollView>
    </View>
  );
}

function CustomExerciseForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (exercise: any) => void }) {
  const toast = useToast();
  const optionsQuery = useQuery({ queryKey: ["exercise-filter-options"], queryFn: () => workoutService.getExerciseFilterOptions() });
  const opts = filterOptions(optionsQuery.data);
  const [f, setF] = useState({
    exerciseName: "",
    typeOfActivity: "STRENGTH",
    typeOfEquipment: "BODYWEIGHT",
    bodyPart: "FULL_BODY",
    type: "PUSH",
    loggingMode: "REPS_LOAD",
    muscleGroupsText: "",
    instructions: "",
  });
  const [candidates, setCandidates] = useState<{ id: string; name: string; confidence: number }[] | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const modeLabel = LOGGING_MODES.find((m) => m.value === f.loggingMode)?.label ?? "Tạ × Reps";

  const create = useMutation({
    mutationFn: (anyway: boolean) => workoutService.createCustomExercise(customExercisePayload(f, anyway)),
    onSuccess: (res: any) => {
      if (res?.blocked) {
        setCandidates(res.candidates ?? []);
        return;
      }
      toast.show(`Đã tạo bài tập "${f.exerciseName.trim()}".`, "success");
      onCreated(res?.exercise);
    },
    onError: (e: any) => toast.show(e?.response?.data?.error || "Không thể tạo bài tập tùy chỉnh.", "danger"),
  });

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
      <Input label="Tên bài tập *" value={f.exerciseName} onChangeText={(t) => set("exerciseName", t)} />
      <Choice label="Vùng cơ thể" options={opts.bodyParts} value={f.bodyPart} onChange={(v) => set("bodyPart", v)} />
      <Choice label="Dụng cụ" options={opts.equipments} value={f.typeOfEquipment} onChange={(v) => set("typeOfEquipment", v)} />
      <Choice label="Loại hoạt động" options={opts.activityTypes} value={f.typeOfActivity} onChange={(v) => set("typeOfActivity", v)} />
      <Choice label="Kiểu chuyển động" options={opts.types} value={f.type} onChange={(v) => set("type", v)} />
      <View>
        <Text className="mb-1.5 font-body text-xs text-muted-foreground">Cách ghi: {modeLabel}</Text>
        <Segmented
          options={LOGGING_MODES.slice(0, 3).map((m) => m.label)}
          value={LOGGING_MODES.slice(0, 3).find((m) => m.value === f.loggingMode)?.label ?? ""}
          onChange={(v) => set("loggingMode", LOGGING_MODES.find((m) => m.label === v)?.value ?? "REPS_LOAD")}
        />
      </View>
      <Input label="Nhóm cơ (cách nhau dấu phẩy)" value={f.muscleGroupsText} onChangeText={(t) => set("muscleGroupsText", t)} placeholder="ngực, tay sau" />
      <Input label="Hướng dẫn (không bắt buộc)" value={f.instructions} onChangeText={(t) => set("instructions", t)} multiline />
      {candidates ? (
        <View className="gap-1 rounded-xl border border-warning/30 bg-warning/10 p-3">
          <Text className="font-body-semibold text-xs text-warning">Có vẻ đã có bài giống trong thư viện:</Text>
          {candidates.map((c) => (
            <Text key={c.id} className="font-body text-xs text-foreground">
              • {c.name} ({Math.round(c.confidence * 100)}%)
            </Text>
          ))}
        </View>
      ) : null}
      <View className="flex-row gap-2">
        <Button className="flex-1" variant="secondary" onPress={onCancel}>
          Quay lại
        </Button>
        <Button className="flex-1" disabled={!f.exerciseName.trim() || create.isPending} onPress={() => create.mutate(!!candidates)}>
          {create.isPending ? "Đang tạo…" : candidates ? "Vẫn tạo bài này" : "Tạo bài tập"}
        </Button>
      </View>
    </ScrollView>
  );
}
