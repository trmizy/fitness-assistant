import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { CheckCircle2, FileUp, TriangleAlert, Upload } from "lucide-react-native";

import {
  Badge,
  Button,
  Card,
  ScreenHeader,
  Segmented,
  Tappable,
  useToast,
} from "../../../src/components/ui";
import {
  importService,
  type ImportExerciseResolution,
  type ImportPreviewResult,
} from "../../../src/services/api";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

const PROVIDERS = ["Hevy", "Strong", "FitNotes"] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * SH-10 — import workouts from another app's CSV export.
 *
 * Behavioural authority: web's `ImportWorkoutsPage.tsx` — the same two-step contract the backend
 * enforces: `preview` parses and returns a `batchId` plus the exercises it could not match, then
 * `commit` applies the batch with one resolution per unmatched exercise. Nothing is written until
 * commit, and leaving the screen mid-flow calls `cancel` so a half-open batch does not linger.
 *
 * Platform adapter (MOBILE_PLATFORM_ADAPTERS §0.4 "upload file"): web reads the file with a
 * `FileReader` over an `<input type=file>`; RN uses `expo-document-picker` to get a URI and
 * `expo-file-system` to read it as UTF-8 text. Both send the same `{ fileName, csvContent }` body,
 * so the backend cannot tell the two clients apart.
 *
 * Resolution UI is deliberately narrower than web's: mobile offers "dùng bài khớp nhất" or "bỏ
 * qua" per unmatched exercise. Web's third option — CREATE_CUSTOM with a full exercise form
 * (body part, equipment, logging mode…) — is a form nobody wants to fill on a phone mid-import;
 * creating custom exercises has its own screen in a later phase.
 */
export default function ImportWorkoutsScreen() {
  const accent = useWorkspaceAccent();
  const toast = useToast();

  const [provider, setProvider] = useState<Provider>("Hevy");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [choices, setChoices] = useState<Record<string, "USE" | "SKIP">>({});
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState<any | null>(null);

  const reset = useCallback(() => {
    setPreview(null);
    setChoices({});
    setFileName(null);
    setCommitted(null);
  }, []);

  const pickAndPreview = useCallback(async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      // Some Android file providers report a CSV as text/comma-separated-values or */*, so the
      // filter stays permissive and the backend's parser remains the real gate.
      type: ["text/csv", "text/comma-separated-values", "text/plain", "*/*"],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    const asset = picked.assets[0];
    setBusy(true);
    try {
      const csvContent = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: "utf8",
      });
      const name = asset.name ?? "export.csv";
      const result =
        provider === "Hevy"
          ? await importService.previewHevy(name, csvContent)
          : provider === "Strong"
            ? await importService.previewStrong(name, csvContent)
            : await importService.previewFitNotes(name, csvContent);

      setFileName(name);
      setPreview(result);
      // Default every unmatched exercise to its best candidate when there is one; nothing is
      // written until commit, and a wrong default is one tap to change.
      const defaults: Record<string, "USE" | "SKIP"> = {};
      for (const entry of result.exerciseMatchSummary ?? []) {
        defaults[entry.exerciseTitle] = entry.candidates.length > 0 ? "USE" : "SKIP";
      }
      setChoices(defaults);
    } catch (e: any) {
      toast.show(e?.response?.data?.error ?? "Không đọc được tệp này.", "danger");
    } finally {
      setBusy(false);
    }
  }, [provider, toast]);

  const commit = useCallback(async () => {
    if (!preview?.batchId) return;
    setBusy(true);
    try {
      const resolutions: Record<string, ImportExerciseResolution> = {};
      for (const entry of preview.exerciseMatchSummary ?? []) {
        const choice = choices[entry.exerciseTitle];
        if (choice === "USE" && entry.candidates[0]) {
          resolutions[entry.exerciseTitle] = {
            action: "USE_EXISTING",
            exerciseId: entry.candidates[0].id,
          };
        } else {
          resolutions[entry.exerciseTitle] = { action: "SKIP" };
        }
      }
      const result = await importService.commit(preview.batchId, resolutions);
      setCommitted(result);
      toast.show("Đã nhập xong.", "success");
    } catch (e: any) {
      toast.show(e?.response?.data?.error ?? "Không nhập được dữ liệu.", "danger");
    } finally {
      setBusy(false);
    }
  }, [preview, choices, toast]);

  const leave = useCallback(async () => {
    // An uncommitted batch is server-side state; cancel it rather than leaving it open.
    if (preview?.batchId && !committed) {
      await importService.cancel(preview.batchId).catch(() => {});
    }
    router.back();
  }, [preview?.batchId, committed]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Nhập buổi tập" onBack={leave} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}
      >
        {committed ? (
          <Card className="items-center p-6">
            <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
              <CheckCircle2 size={26} color={accent.primary} />
            </View>
            <Text className="font-display text-xl text-foreground">Đã nhập xong</Text>
            <Text className="mt-1 text-center font-body text-sm text-muted-foreground">
              {committed?.importedWorkoutCount != null
                ? `${committed.importedWorkoutCount} buổi tập đã được thêm vào nhật ký.`
                : "Dữ liệu đã được thêm vào nhật ký."}
            </Text>
            <View className="mt-4 w-full gap-2">
              <Button full onPress={() => router.back()}>
                Về Tập luyện
              </Button>
              <Button full variant="secondary" onPress={reset}>
                Nhập tệp khác
              </Button>
            </View>
          </Card>
        ) : (
          <>
            <Text className="mb-2 font-body text-xs uppercase text-muted-foreground">
              Nguồn dữ liệu
            </Text>
            <Segmented
              options={[...PROVIDERS]}
              value={provider}
              onChange={(next) => {
                setProvider(next as Provider);
                reset();
              }}
            />

            <Card className="mt-4 p-4">
              <View className="flex-row items-center gap-3">
                <View className="h-11 w-11 items-center justify-center rounded-xl bg-panel">
                  <FileUp size={20} color={accent.primary} />
                </View>
                <View className="flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">
                    {fileName ?? "Chưa chọn tệp"}
                  </Text>
                  <Text className="mt-0.5 font-body text-xs text-muted-foreground">
                    Chọn tệp CSV xuất từ {provider}.
                  </Text>
                </View>
              </View>
              <View className="mt-3">
                <Button full icon={Upload} disabled={busy} onPress={pickAndPreview}>
                  {busy && !preview ? "Đang đọc tệp…" : "Chọn tệp CSV"}
                </Button>
              </View>
            </Card>

            {preview?.blocked ? (
              <Card className="mt-4 flex-row items-start gap-3 border-destructive/30 bg-destructive/5 p-4">
                <TriangleAlert size={18} color="#f87171" />
                <View className="flex-1">
                  <Text className="font-body-semibold text-sm text-destructive">
                    Không thể nhập tệp này
                  </Text>
                  <Text className="mt-0.5 font-body text-xs text-muted-foreground">
                    {preview.reason ?? "Tệp không đúng định dạng mong đợi."}
                  </Text>
                </View>
              </Card>
            ) : preview ? (
              <>
                <Card className="mt-4 p-4">
                  <Text className="mb-2 font-display text-base text-foreground">Xem trước</Text>
                  <Row label="Số buổi tập" value={String(preview.workoutCount ?? 0)} />
                  {preview.dateRange?.earliest ? (
                    <Row
                      label="Khoảng thời gian"
                      value={`${preview.dateRange.earliest} → ${preview.dateRange.latest ?? "—"}`}
                    />
                  ) : null}
                  {preview.alreadyImportedCount ? (
                    <Row
                      label="Đã nhập trước đó"
                      value={`${preview.alreadyImportedCount} buổi (sẽ bỏ qua)`}
                    />
                  ) : null}
                  {preview.rowErrors.length > 0 ? (
                    <Row label="Dòng lỗi" value={`${preview.rowErrors.length} dòng`} />
                  ) : null}
                </Card>

                {(preview.exerciseMatchSummary ?? []).length > 0 ? (
                  <View className="mt-4">
                    <Text className="mb-2 px-1 font-display text-base text-foreground">
                      Ghép bài tập
                    </Text>
                    <View className="gap-2.5">
                      {(preview.exerciseMatchSummary ?? []).map((entry) => {
                        const choice = choices[entry.exerciseTitle] ?? "SKIP";
                        const best = entry.candidates[0];
                        return (
                          <Card key={entry.exerciseTitle} className="p-4">
                            <View className="flex-row items-center gap-2">
                              <Text
                                className="flex-1 font-body-semibold text-sm text-foreground"
                                numberOfLines={1}
                              >
                                {entry.exerciseTitle}
                              </Text>
                              {entry.isExactMatch ? <Badge tone="success">Khớp chính xác</Badge> : null}
                            </View>
                            <Text className="mt-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
                              {best
                                ? `Gợi ý: ${best.name}${
                                    best.confidence != null
                                      ? ` (${Math.round(best.confidence * 100)}%)`
                                      : ""
                                  }`
                                : "Không có bài nào khớp"}
                            </Text>
                            <View className="mt-2.5 flex-row gap-2">
                              <ChoiceChip
                                label="Dùng gợi ý"
                                active={choice === "USE"}
                                disabled={!best}
                                onPress={() =>
                                  setChoices((c) => ({ ...c, [entry.exerciseTitle]: "USE" }))
                                }
                              />
                              <ChoiceChip
                                label="Bỏ qua"
                                active={choice === "SKIP"}
                                onPress={() =>
                                  setChoices((c) => ({ ...c, [entry.exerciseTitle]: "SKIP" }))
                                }
                              />
                            </View>
                          </Card>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                <View className="mt-5">
                  <Button full size="lg" disabled={busy} onPress={commit}>
                    {busy ? "Đang nhập…" : "Nhập vào nhật ký"}
                  </Button>
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className="font-body text-sm text-muted-foreground">{label}</Text>
      <Text className="font-body-semibold text-sm text-foreground">{value}</Text>
    </View>
  );
}

function ChoiceChip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Tappable
      className={`flex-1 items-center rounded-xl border py-2 ${
        active ? "border-primary bg-primary/15" : "border-border bg-card"
      } ${disabled ? "opacity-40" : ""}`}
      disabled={disabled}
      onPress={onPress}
    >
      <Text
        className={`font-body-semibold text-xs ${active ? "text-primary" : "text-muted-foreground"}`}
      >
        {label}
      </Text>
    </Tappable>
  );
}
