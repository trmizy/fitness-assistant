import type { ReactNode } from "react";
import { View } from "react-native";

import { Tappable } from "./Tappable";

/**
 * The app's default surface — `rounded-2xl border border-border bg-card`, straight from the
 * reference. A card with an `onPress` gets the same press-shrink as any other tappable surface;
 * one without stays a plain View so it costs nothing.
 */
export function Card({
  children,
  className = "",
  onPress,
}: {
  children: ReactNode;
  className?: string;
  onPress?: () => void;
}) {
  const base = `rounded-2xl border border-border bg-card ${className}`;

  if (onPress) {
    return (
      <Tappable className={base} onPress={onPress}>
        {children}
      </Tappable>
    );
  }

  return <View className={base}>{children}</View>;
}
