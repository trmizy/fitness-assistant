import { View, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Card, Text, spacing, colors } from "../../ui";

interface ActionProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
}

function QuickAction({ icon, label, onPress }: ActionProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          flex: 1,
          alignItems: "center",
          gap: spacing.xs,
          paddingVertical: spacing.md,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: colors.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={20} color={colors.accent} />
      </View>
      <Text variant="caption">{label}</Text>
    </Pressable>
  );
}

export function QuickActions() {
  const router = useRouter();

  return (
    <Card style={{ flexDirection: "row", padding: spacing.sm }}>
      <QuickAction
        icon="plus-circle"
        label="Log buổi tập"
        onPress={() => router.push("/(app)/(tabs)/workouts")}
      />
      <QuickAction
        icon="bar-chart-2"
        label="Thêm InBody"
        onPress={() => router.push("/(app)/(tabs)/inbody")}
      />
    </Card>
  );
}
