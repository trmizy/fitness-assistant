import { useEffect, useState } from "react";
import { BackHandler, Pressable, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut } from "react-native-reanimated";
import { router } from "expo-router";
import { ChevronUp, X } from "lucide-react-native";

import { Tappable } from "../../components/ui";
import { useWorkspaceAccent } from "../../theme/workspace";
import { WORKOUT_TOOLS } from "./workoutTools";

/**
 * "Tập luyện"'s tool menu: an arrow button at the bottom-left, level with the AI Coach button on
 * the right, that opens the tools as a list of icon + name. Rendered inside the screen (which ends
 * at the tab bar), so `bottom: 20` lands on the same line as AiCoachFab's `tab bar + 20`.
 */
export function WorkoutToolsMenu() {
  const accent = useWorkspaceAccent();
  const [open, setOpen] = useState(false);

  // Android Back closes the open menu instead of leaving the tab.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  return (
    <>
      {open ? (
        <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} className="absolute inset-0 bg-black/60">
          <Pressable accessibilityLabel="Đóng danh sách công cụ" className="flex-1" onPress={() => setOpen(false)} />
        </Animated.View>
      ) : null}

      <View pointerEvents="box-none" className="absolute bottom-5 left-4 items-start gap-2">
        {open
          ? WORKOUT_TOOLS.map((tool, i) => (
              <Animated.View
                key={tool.key}
                // Rise from the button upwards: the item nearest the button appears first.
                entering={FadeInDown.duration(180).delay((WORKOUT_TOOLS.length - 1 - i) * 25)}
              >
                <Tappable
                  accessibilityLabel={tool.label}
                  className="flex-row items-center gap-3 rounded-full border border-border bg-card py-2.5 pl-3 pr-5"
                  onPress={() => {
                    setOpen(false);
                    router.push(tool.href);
                  }}
                >
                  <View className="h-8 w-8 items-center justify-center rounded-full bg-primary/15">
                    <tool.icon size={17} color={accent.primary} />
                  </View>
                  <Text className="font-body-semibold text-sm text-foreground">{tool.label}</Text>
                </Tappable>
              </Animated.View>
            ))
          : null}

        <Tappable
          accessibilityLabel={open ? "Đóng danh sách công cụ" : "Mở danh sách công cụ tập luyện"}
          className="h-14 w-14 items-center justify-center rounded-full border border-border bg-card"
          style={{ elevation: 6 }}
          onPress={() => setOpen((o) => !o)}
        >
          {open ? <X size={22} color={accent.primary} strokeWidth={2.5} /> : <ChevronUp size={24} color={accent.primary} strokeWidth={2.5} />}
        </Tappable>
      </View>
    </>
  );
}
