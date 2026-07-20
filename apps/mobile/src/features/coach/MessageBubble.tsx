import { View, ActivityIndicator } from "react-native";
import { Text, colors, radius, spacing } from "../../ui";

interface MessageBubbleProps {
  role: "user" | "assistant";
  text?: string;
  pending?: boolean;
  error?: string;
}

export function MessageBubble({ role, text, pending, error }: MessageBubbleProps) {
  const isUser = role === "user";
  return (
    <View
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "82%",
        backgroundColor: isUser ? colors.accent : colors.surfaceAlt,
        borderRadius: radius.lg,
        borderBottomRightRadius: isUser ? 4 : radius.lg,
        borderBottomLeftRadius: isUser ? radius.lg : 4,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
        marginVertical: 4,
      }}
    >
      {pending ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <ActivityIndicator size="small" color={colors.textSecondary} />
          <Text variant="caption">AI đang phân tích...</Text>
        </View>
      ) : error ? (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      ) : (
        <Text variant="body" color={isUser ? colors.onAccent : colors.textPrimary}>
          {text}
        </Text>
      )}
    </View>
  );
}
