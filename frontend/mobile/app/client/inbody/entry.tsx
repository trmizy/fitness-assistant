import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ScanLine } from "lucide-react-native";

import { Badge, Button, Card, ScreenHeader, Tappable, useToast } from "../../../src/components/ui";
import { inbodyService } from "../../../src/services/api";
import { toDateInputValue } from "../../../src/utils/date";
import { haptics } from "../../../src/lib/haptics";
import {
  EMPTY_FORM,
  SEGMENT_SIDES,
  buildEntryPayload,
  deriveBodyFatKg,
  formErrors,
  formFromExtracted,
  type EntryForm,
  type SegmentField,
} from "../../../src/features/inbody/inbodyMath";

/**
 * CL-14 — the one form behind both ways in.
 *
 * "Nhập tay" opens it empty; a scan opens it pre-filled from OCR (`prefill`) and marked as such.
 * The scan is never saved behind the user's back: `POST /inbody/upload` only extracts, and this
 * screen is where the numbers get checked and then written with `POST /inbody`. That mirrors web,
 * and it is the only honest order — OCR on a photo of a printout is a guess until someone confirms.
 *
 * Khối cơ is required here even though the design's manual sheet marks only weight with a star: the
 * column is non-nullable and a create without it comes back as a raw 500 (see inbodyMath.ts).
 */
export default function InBodyEntryScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ prefill?: string; source?: string }>();

  const today = toDateInputValue(new Date());
  const fromScan = params.source === "ocr";

  const [form, setForm] = useState<EntryForm>(() => {
    if (!params.prefill) return { ...EMPTY_FORM, date: today };
    try {
      return formFromExtracted(JSON.parse(String(params.prefill)), today);
    } catch {
      return { ...EMPTY_FORM, date: today };
    }
  });
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  // Opened by default when a scan actually read some of them, so OCR's own numbers are not hidden.
  const [showSegments, setShowSegments] = useState(() =>
    SEGMENT_SIDES.some(
      (side) => !!params.prefill && String(params.prefill).includes(`${side.key}Muscle`),
    ),
  );

  const errors = useMemo(() => formErrors(form), [form]);
  const valid = Object.keys(errors).length === 0;

  const weightNumber = Number(form.weight.replace(",", ".")) || 0;
  const pctNumber = Number(form.bodyFatPct.replace(",", ".")) || 0;
  const fatKg = weightNumber > 0 && pctNumber > 0 ? deriveBodyFatKg(weightNumber, pctNumber) : null;

  const edit = (key: keyof EntryForm, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setShowErrors(true);
    if (!valid) {
      toast.show("Kiểm tra lại các ô được đánh dấu.", "danger");
      return;
    }
    setSaving(true);
    try {
      await inbodyService.create(buildEntryPayload(form));
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["inbody-history"] }),
        queryClient.refetchQueries({ queryKey: ["inbody-latest"] }),
      ]).catch(() => {});
      haptics.success();
      toast.show("Đã lưu phiếu đo!", "success");
      // `back()` alone left the form on screen after a successful save on the emulator — this screen
      // can be the stack's first route (a deep link straight to it, or a scan opened from a cold
      // start), and there is then nothing to pop.
      if (router.canGoBack()) router.back();
      else router.replace("/client/inbody");
    } catch (e: any) {
      toast.show(
        e?.response ? e.response.data?.error ?? "Không lưu được phiếu đo." : "Mất mạng — chưa lưu được.",
        "danger",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={fromScan ? "Kiểm tra kết quả quét" : "Nhập chỉ số"} onBack={() => router.back()} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
      >
        {fromScan ? (
          <Card className="mb-4 flex-row items-center gap-3 border-primary/30 bg-primary/5 p-4">
            <ScanLine size={18} color="#22c55e" />
            <Text className="flex-1 font-body text-xs leading-5 text-muted-foreground">
              Số liệu dưới đây do máy đọc từ ảnh phiếu. Hãy đối chiếu với phiếu giấy trước khi lưu —
              chưa có gì được ghi vào hồ sơ.
            </Text>
          </Card>
        ) : null}

        <Field
          label="Ngày đo"
          value={form.date}
          onChange={(v) => edit("date", v)}
          placeholder="YYYY-MM-DD"
          keyboard="numbers-and-punctuation"
          hint="Mỗi ngày chỉ giữ một phiếu đo — lưu lại cùng ngày sẽ ghi đè phiếu cũ."
        />
        <Field
          label="Cân nặng"
          unit="kg"
          required
          value={form.weight}
          onChange={(v) => edit("weight", v)}
          error={showErrors ? errors.weight : undefined}
        />
        <Field
          label="Khối cơ"
          unit="kg"
          required
          value={form.muscleMass}
          onChange={(v) => edit("muscleMass", v)}
          error={showErrors ? errors.muscleMass : undefined}
        />
        <Field
          label="Tỉ lệ mỡ cơ thể"
          unit="%"
          required
          value={form.bodyFatPct}
          onChange={(v) => edit("bodyFatPct", v)}
          error={showErrors ? errors.bodyFatPct : undefined}
          hint={fatKg != null ? `Tương đương ${fatKg} kg mỡ — đúng con số sẽ được lưu.` : undefined}
        />
        <Field label="Chiều cao" unit="cm" value={form.height} onChange={(v) => edit("height", v)} error={showErrors ? errors.height : undefined} />
        <Field label="BMR" unit="kcal" value={form.bmr} onChange={(v) => edit("bmr", v)} />
        <Field label="Mỡ nội tạng" value={form.visceralFat} onChange={(v) => edit("visceralFat", v)} />
        <Field label="Ghi chú" value={form.notes} onChange={(v) => edit("notes", v)} keyboard="default" />

        {/* A real printout has a segmental table; a scale does not. All ten stay optional, and web's
            manual form offers exactly the same ten. */}
        <Tappable
          className="mb-4 flex-row items-center justify-between rounded-xl border border-border bg-panel px-3.5 py-3"
          haptic={false}
          onPress={() => setShowSegments((open) => !open)}
        >
          <Text className="font-body-medium text-sm text-foreground">Chỉ số theo vùng (tuỳ chọn)</Text>
          <Text className="font-body text-xs text-muted-foreground">
            {showSegments ? "Thu gọn" : "Mở rộng"}
          </Text>
        </Tappable>

        {showSegments ? (
          <>
            <Text className="mb-2 px-1 font-body text-[11px] uppercase tracking-wide text-muted-foreground">
              Cơ theo vùng (kg)
            </Text>
            <View className="flex-row flex-wrap gap-3">
              {SEGMENT_SIDES.map((side) => {
                const field = `${side.key}Muscle` as SegmentField;
                return (
                  <View key={field} className="min-w-[45%] flex-1">
                    <Field label={side.label} unit="kg" value={form[field]} onChange={(v) => edit(field, v)} />
                  </View>
                );
              })}
            </View>

            <Text className="mb-2 px-1 font-body text-[11px] uppercase tracking-wide text-muted-foreground">
              Mỡ theo vùng (kg)
            </Text>
            <View className="flex-row flex-wrap gap-3">
              {SEGMENT_SIDES.map((side) => {
                const field = `${side.key}Fat` as SegmentField;
                return (
                  <View key={field} className="min-w-[45%] flex-1">
                    <Field label={side.label} unit="kg" value={form[field]} onChange={(v) => edit(field, v)} />
                  </View>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>

      <View
        className="absolute inset-x-0 bottom-0 border-t border-border bg-background px-5 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <Button full size="lg" icon={Check} disabled={saving} onPress={save}>
          Lưu phiếu đo
        </Button>
      </View>
    </View>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
  required,
  error,
  hint,
  placeholder,
  keyboard = "decimal-pad",
}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  error?: string;
  hint?: string;
  placeholder?: string;
  keyboard?: "decimal-pad" | "default" | "numbers-and-punctuation";
}) {
  return (
    <View className="mb-4">
      <View className="mb-1.5 flex-row items-center gap-1.5 px-1">
        <Text className="font-body text-xs text-muted-foreground">{label}</Text>
        {required ? <Badge tone="neutral">bắt buộc</Badge> : null}
      </View>
      <View
        className={`flex-row items-center gap-2 rounded-xl border bg-panel px-3.5 ${
          error ? "border-destructive/60" : "border-border"
        }`}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          keyboardType={keyboard}
          className="h-12 flex-1 font-body text-sm text-foreground"
          style={{ paddingVertical: 0 }}
        />
        {unit ? <Text className="font-body-semibold text-sm text-muted-foreground">{unit}</Text> : null}
      </View>
      {error ? (
        <Text className="mt-1 px-1 font-body text-[11px] text-destructive">{error}</Text>
      ) : hint ? (
        <Text className="mt-1 px-1 font-body text-[11px] text-muted-foreground">{hint}</Text>
      ) : null}
    </View>
  );
}
