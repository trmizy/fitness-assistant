import { View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { colors, spacing } from "./theme";
import { Text } from "./Text";
import { Button } from "./Button";

export interface ErrorNoticeProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorNotice({ message = "Không tải được dữ liệu", onRetry }: ErrorNoticeProps) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        backgroundColor: colors.dangerSoft,
        borderRadius: 12,
        padding: spacing.md,
      }}
    >
      <Feather name="alert-triangle" size={18} color={colors.danger} />
      <Text variant="caption" color={colors.danger} style={{ flex: 1 }}>
        {message}
      </Text>
      {onRetry ? <Button label="Thử lại" variant="ghost" size="sm" onPress={onRetry} /> : null}
    </View>
  );
}
