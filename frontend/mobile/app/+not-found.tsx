import { View } from "react-native";
import { router } from "expo-router";
import { SearchX } from "lucide-react-native";

import { EmptyState } from "../src/components/ui";

/**
 * Any link the app has no screen for — an old shortcut, a mistyped deep link, a path that only
 * exists on web.
 *
 * Without this file expo-router shows its own English "Unmatched Route" page, whose "Sitemap"
 * link crashed the release build (real phone, 7/10). "/" is the root redirect: it sends a
 * signed-in user to their own home and anyone else to login, so this needs no role logic.
 */
export default function NotFoundScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <EmptyState
        icon={SearchX}
        title="Không tìm thấy trang"
        description="Liên kết này không còn dùng được hoặc không có trong ứng dụng."
        actionLabel="Về trang chính"
        onAction={() => router.replace("/")}
      />
    </View>
  );
}
