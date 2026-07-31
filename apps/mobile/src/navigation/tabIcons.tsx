import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";

type FeatherName = ComponentProps<typeof Feather>["name"];

export const TAB_ICONS: Record<string, FeatherName> = {
  index: "home",
  workouts: "activity",
  plans: "clipboard",
  inbody: "bar-chart-2",
  coach: "message-circle",
};

export function TabIcon({
  name,
  color,
  size,
}: {
  name: string;
  color: ColorValue;
  size: number;
}) {
  return <Feather name={TAB_ICONS[name] ?? "circle"} color={color as string} size={size} />;
}
