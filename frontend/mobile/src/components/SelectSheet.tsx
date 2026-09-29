import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { Check, ChevronDown } from "lucide-react-native";

import { BottomSheet, Input } from "./ui";
import { designTokens } from "../theme/colors";
import { useWorkspaceAccent } from "../theme/workspace";
import { foldVi } from "../lib/text";

// Re-exported so existing imports keep working.
export { foldVi };

export type SelectOption = { value: string; label: string };

/**
 * A select field that opens a searchable list in a BottomSheet — the phone's stand-in for web's
 * `<select>` when the list is long (63 provinces, hundreds of wards).
 */
export function SelectField({
  label,
  placeholder = "Chọn…",
  value,
  options,
  onChange,
  loading,
  disabled,
  allowClear,
}: {
  label: string;
  placeholder?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  loading?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const accent = useWorkspaceAccent();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const f = foldVi(q);
    return f ? options.filter((o) => foldVi(o.label).includes(f)) : options;
  }, [options, q]);

  return (
    <View>
      <Text className="mb-1.5 px-1 font-body text-sm text-muted-foreground">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={() => {
          setQ("");
          setOpen(true);
        }}
        className={`h-12 flex-row items-center rounded-xl border border-border bg-panel px-3.5 ${disabled ? "opacity-50" : ""}`}
      >
        <Text className={`flex-1 font-body text-sm ${selected ? "text-foreground" : "text-muted-foreground"}`} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        {loading ? <ActivityIndicator size="small" color={accent.primary} /> : <ChevronDown size={18} color={designTokens.mutedForeground} />}
      </Pressable>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
        <View className="gap-3 pb-2">
          <Input value={q} onChangeText={setQ} placeholder="Tìm…" autoCorrect={false} />
          {allowClear && value ? (
            <Pressable
              onPress={() => {
                onChange("");
                setOpen(false);
              }}
              className="py-2"
            >
              <Text className="font-body-semibold text-sm text-destructive">Bỏ chọn</Text>
            </Pressable>
          ) : null}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            style={{ maxHeight: 360 }}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text className="py-6 text-center font-body text-sm text-muted-foreground">Không có kết quả</Text>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
                className="flex-row items-center border-b border-border py-3"
              >
                <Text className={`flex-1 font-body text-sm ${item.value === value ? "text-primary" : "text-foreground"}`}>{item.label}</Text>
                {item.value === value ? <Check size={16} color={accent.primary} /> : null}
              </Pressable>
            )}
          />
        </View>
      </BottomSheet>
    </View>
  );
}

