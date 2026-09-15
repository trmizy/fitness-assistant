import type { ReactNode } from "react";
import { Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { pressScale } from "../../theme/motion";
import { darkColors, designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { Tappable } from "./Tappable";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Transcribed from the reference's `Button`. Two things differ because RN is not the DOM, and both
 * are mechanical rather than judgement calls:
 *
 *  - **Text style does not cascade.** On web one class string on the `<button>` styles the label
 *    too; here the container carries layout/background and the `<Text>` carries colour, size and
 *    family, so each variant is split into a container half and a label half.
 *  - **Weights are font families.** The reference's `font-semibold`/`font-medium` rely on a
 *    variable Inter; the app ships static cuts, so those become `font-body-semibold`/
 *    `font-body-medium` (see tailwind.config.js) — same rendered weight, chosen explicitly.
 */
const container: Record<ButtonVariant, string> = {
  primary: "bg-primary",
  secondary: "bg-panel border border-border",
  ghost: "",
  destructive: "bg-destructive/15",
};

const label: Record<ButtonVariant, string> = {
  primary: "text-on-primary font-body-semibold",
  secondary: "text-foreground font-body-medium",
  ghost: "text-muted-foreground font-body-medium",
  destructive: "text-destructive font-body-semibold",
};

const sizeContainer: Record<ButtonSize, string> = {
  sm: "h-9 px-3 gap-1.5 rounded-xl",
  md: "h-11 px-4 gap-2 rounded-xl",
  lg: "h-14 px-6 gap-2 rounded-2xl",
};

const sizeLabel: Record<ButtonSize, string> = {
  sm: "text-sm",
  md: "text-[15px]",
  lg: "text-base",
};

/**
 * Icon tint per variant, as real colour values.
 *
 * lucide-react-native draws through react-native-svg, which takes an explicit `color` prop — there
 * is no `currentColor` to inherit from a parent's class the way the web reference relies on. So
 * the variants that depend on the workspace accent read it from the theme at render time, which
 * keeps a PT's violet / gym's blue / admin's teal working exactly as the CSS variables do.
 */
function useIconColor(variant: ButtonVariant): string {
  const accent = useWorkspaceAccent();
  switch (variant) {
    case "primary":
      return accent.onPrimary;
    case "secondary":
      return darkColors.foreground;
    case "ghost":
      return designTokens.mutedForeground;
    case "destructive":
      return darkColors.destructive;
  }
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  full,
  icon: Icon,
  onPress,
  disabled,
  className = "",
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  icon?: LucideIcon;
  onPress?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const iconColor = useIconColor(variant);

  return (
    <Tappable
      onPress={onPress}
      disabled={disabled}
      scaleTo={pressScale.button}
      accessibilityLabel={typeof children === "string" ? children : undefined}
      className={[
        "flex-row items-center justify-center",
        sizeContainer[size],
        container[variant],
        full ? "w-full" : "self-start",
        disabled ? "opacity-40" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {Icon ? (
        <Icon size={size === "lg" ? 20 : 18} strokeWidth={2.25} color={iconColor} />
      ) : null}
      {typeof children === "string" ? (
        <Text className={`${sizeLabel[size]} ${label[variant]}`}>{children}</Text>
      ) : (
        children
      )}
    </Tappable>
  );
}
