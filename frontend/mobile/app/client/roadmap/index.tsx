import { RefreshControl, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ScreenHeader } from "../../../src/components/ui";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { ROADMAP_KEY, RoadmapJourney } from "../../../src/features/roadmap/RoadmapJourney";

/**
 * WB-11 — the journey as its own screen (deep links, and the wizard's landing page after creating).
 * The same component also lives inline in Tập luyện → "Lộ trình", the way web nests it in its
 * Training page.
 */
export default function RoadmapScreen() {
  const accent = useWorkspaceAccent();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Lộ trình" onBack={() => (router.canGoBack() ? router.back() : router.replace("/client/workout"))} />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await queryClient.invalidateQueries({ queryKey: ROADMAP_KEY });
              setRefreshing(false);
            }}
            tintColor={accent.primary}
            colors={[accent.primary]}
          />
        }
      >
        <RoadmapJourney onOpenCycle={() => router.push({ pathname: "/client/workout", params: { tab: "Chu kỳ" } })} />
      </ScrollView>
    </View>
  );
}
