import { forwardRef, useState } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { darkColors, designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";

/**
 * Text field — the reference's `AuthField` shape, which every form in the design reuses:
 * `rounded-xl border border-border bg-panel px-3.5`, a 18px muted leading icon, and a border that
 * turns primary while focused (`focus-within:border-primary`).
 *
 * RN has no `:focus-within`, so focus is tracked in state and applied to the wrapper — the one
 * place this has to differ from the reference's class string.
 *
 * An `error` swaps the border and prints the message below, which the design does per-screen; it
 * lives here so no form has to reinvent it.
 */
export const Input = forwardRef<TextInput, {
  icon?: LucideIcon;
  error?: string | null;
  label?: string;
  className?: string;
} & TextInputProps>(function Input(
  { icon: Icon, error, label, className = "", onFocus, onBlur, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const accent = useWorkspaceAccent();

  const borderClass = error
    ? "border-destructive"
    : focused
      ? "border-primary"
      : "border-border";

  return (
    <View className={className}>
      {label ? (
        <Text className="mb-1.5 text-xs font-body-medium text-muted-foreground">
          {label}
        </Text>
      ) : null}

      <View
        className={`flex-row items-center gap-3 rounded-xl border bg-panel px-3.5 ${borderClass}`}
      >
        {Icon ? (
          <Icon
            size={18}
            color={focused && !error ? accent.primary : designTokens.mutedForeground}
          />
        ) : null}
        <TextInput
          ref={ref}
          className="h-12 flex-1 text-sm font-body text-foreground"
          placeholderTextColor={designTokens.mutedForeground}
          selectionColor={accent.primary}
          // Android draws its own underline on top of the bordered wrapper otherwise.
          underlineColorAndroid="transparent"
          cursorColor={accent.primary}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />
      </View>

      {error ? (
        <Text className="mt-1.5 text-xs font-body text-destructive">{error}</Text>
      ) : null}
    </View>
  );
});

/** Exported for screens that need the same placeholder tint on a bare TextInput. */
export const inputPlaceholderColor = designTokens.mutedForeground;
export const inputTextColor = darkColors.foreground;
