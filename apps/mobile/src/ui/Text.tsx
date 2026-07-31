import { Text as RNText, type TextProps as RNTextProps, StyleSheet } from "react-native";
import { typography, colors } from "./theme";

type Variant = keyof typeof typography;

export interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
}

export function Text({ variant = "body", color, style, ...rest }: TextProps) {
  return (
    <RNText
      style={[styles.base, typography[variant], color ? { color } : null, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    color: colors.textPrimary,
  },
});
