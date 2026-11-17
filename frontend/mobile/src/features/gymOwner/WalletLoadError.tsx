import { Text, View } from "react-native";

import { Button } from "../../components/ui";

/**
 * N13I-01: "Không tải được ví chi nhánh." used to stick after the backend recovered, with nothing to tap.
 * Shown in place of the balance; "Thử lại" refetches the wallet query.
 */
export function WalletLoadError({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <View className="mt-2 flex-row flex-wrap items-center gap-3">
      <Text className="font-body text-sm text-destructive">Không tải được ví chi nhánh.</Text>
      <Button size="sm" variant="secondary" disabled={retrying} onPress={onRetry}>
        {retrying ? "Đang thử lại…" : "Thử lại"}
      </Button>
    </View>
  );
}
