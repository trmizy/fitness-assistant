import { useMemo, type ReactNode } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { Minus, Plus, Star } from "lucide-react-native";

import { Tappable, inputPlaceholderColor, inputTextColor } from "../../components/ui";
import { haptics } from "../../lib/haptics";
import { darkColors, designTokens } from "../../theme/colors";
import { startDateOptions } from "./aiPlans";

/** The design's selectable pill (`Chip` in AIPlanWizard.tsx): primary-tinted when active. */
export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Tappable
      onPress={onPress}
      className={`rounded-full border px-4 py-2 ${active ? "border-primary bg-primary/15" : "border-border bg-panel"}`}
    >
      <Text className={`font-body-semibold text-sm ${active ? "text-primary" : "text-muted-foreground"}`}>{label}</Text>
    </Tappable>
  );
}

/** Two-line option card (label + description) used for location / equipment / replace-vs-append. */
export function OptionCard({
  label,
  desc,
  active,
  onPress,
}: {
  label: string;
  desc?: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Tappable
      onPress={onPress}
      className={`flex-1 rounded-xl border px-3.5 py-3 ${active ? "border-primary bg-primary/10" : "border-border bg-panel"}`}
    >
      <Text className={`font-body-semibold text-sm ${active ? "text-primary" : "text-foreground"}`}>{label}</Text>
      {desc ? <Text className="mt-0.5 font-body text-[11px] text-muted-foreground">{desc}</Text> : null}
    </Tappable>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <Text className="mb-2 font-body-semibold text-xs text-muted-foreground">{children}</Text>;
}

/** Integer stepper — replaces web's `<input type=number>` for small bounded counts. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  suffix?: string;
}) {
  const set = (n: number) => {
    const next = Math.min(max, Math.max(min, n));
    if (next !== value) {
      haptics.tap();
      onChange(next);
    }
  };
  return (
    <View className="flex-row items-center gap-3">
      <Tappable
        onPress={() => set(value - 1)}
        disabled={value <= min}
        accessibilityLabel="Giảm"
        className={`h-10 w-10 items-center justify-center rounded-full border border-border bg-panel ${value <= min ? "opacity-40" : ""}`}
      >
        <Minus size={18} color="#8b9299" />
      </Tappable>
      <Text className="min-w-[64px] text-center font-display text-lg text-foreground">
        {value}
        {suffix ? <Text className="font-body text-sm text-muted-foreground">{` ${suffix}`}</Text> : null}
      </Text>
      <Tappable
        onPress={() => set(value + 1)}
        disabled={value >= max}
        accessibilityLabel="Tăng"
        className={`h-10 w-10 items-center justify-center rounded-full border border-border bg-panel ${value >= max ? "opacity-40" : ""}`}
      >
        <Plus size={18} color="#8b9299" />
      </Tappable>
    </View>
  );
}

export function StartDateStrip({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const options = useMemo(() => startDateOptions(new Date()), []);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Tappable
            key={o.value}
            onPress={() => onChange(o.value)}
            className={`min-w-[64px] items-center rounded-xl border px-3 py-2 ${on ? "border-primary bg-primary" : "border-border bg-panel"}`}
          >
            <Text className={`font-body-semibold text-xs ${on ? "text-on-primary" : "text-foreground"}`}>{o.label}</Text>
            <Text className={`font-body text-[11px] ${on ? "text-on-primary" : "text-muted-foreground"}`}>{o.sub}</Text>
          </Tappable>
        );
      })}
    </ScrollView>
  );
}

/** Seven weekday toggles; `options` decides the order (Monday-first for plans, Sunday-first for adopt). */
export function WeekdayPicker({
  options,
  selected,
  onToggle,
  limit,
}: {
  options: { value: number; short: string }[];
  selected: number[];
  onToggle: (value: number) => void;
  limit: number;
}) {
  const atLimit = selected.length >= limit;
  return (
    <View className="flex-row gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Tappable
            key={o.value}
            onPress={() => onToggle(o.value)}
            accessibilityLabel={`${o.short}${on ? " (đã chọn)" : ""}`}
            className={`h-11 flex-1 items-center justify-center rounded-xl border ${on ? "border-primary bg-primary" : "border-border bg-panel"} ${!on && atLimit ? "opacity-50" : ""}`}
          >
            <Text className={`font-body-semibold text-xs ${on ? "text-on-primary" : "text-muted-foreground"}`}>{o.short}</Text>
          </Tappable>
        );
      })}
    </View>
  );
}

/** Multi-line text field in the design's textarea style (`rounded-2xl border bg-card`). */
export function TextArea({
  value,
  onChangeText,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={inputPlaceholderColor}
      multiline
      textAlignVertical="top"
      style={{ minHeight: rows * 22, color: inputTextColor }}
      className="rounded-2xl border border-border bg-panel px-4 py-3 font-body text-sm"
    />
  );
}

/** Tap-to-rate stars (web's `StarRating`), warning-yellow filled up to `value`. */
export function StarInput({ value, onChange, size = 30 }: { value: number; onChange: (n: number) => void; size?: number }) {
  return (
    <View className="flex-row gap-2">
      {[1, 2, 3, 4, 5].map((n) => (
        <Tappable key={n} onPress={() => onChange(n)} accessibilityLabel={`${n} sao`}>
          <Star size={size} color={n <= value ? designTokens.warning : darkColors.border} fill={n <= value ? designTokens.warning : "transparent"} />
        </Tappable>
      ))}
    </View>
  );
}

export function StarRow({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View className="flex-row gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} color={n <= value ? designTokens.warning : darkColors.border} fill={n <= value ? designTokens.warning : "transparent"} />
      ))}
    </View>
  );
}
