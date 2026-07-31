import { Pressable } from "react-native";
import { Tabs, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { TabIcon } from "../../../src/navigation/tabIcons";
import { colors, spacing } from "../../../src/ui";

const TAB_TITLES: Record<string, string> = {
  index: "Trang chủ",
  workouts: "Tập luyện",
  plans: "Kế hoạch",
  inbody: "InBody",
  coach: "Coach",
};

export default function TabsLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        title: TAB_TITLES[route.name] ?? route.name,
        tabBarIcon: ({ color, size }) => <TabIcon name={route.name} color={color} size={size} />,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.textPrimary, fontWeight: "700" },
        headerShadowVisible: false,
      })}
    >
      <Tabs.Screen
        name="index"
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hồ sơ"
              onPress={() => router.push("/(app)/profile")}
              style={{ paddingHorizontal: spacing.lg }}
            >
              <Feather name="user" size={22} color={colors.textPrimary} />
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="workouts" options={{ headerShown: false }} />
      <Tabs.Screen name="plans" options={{ headerShown: false }} />
      <Tabs.Screen name="inbody" options={{ headerShown: false }} />
      <Tabs.Screen name="coach" options={{ headerShown: false }} />
    </Tabs>
  );
}
