import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { ScreenHeader, Segmented } from "../../../src/components/ui";
import { AiPlansTab } from "../../../src/features/plans/AiPlansTab";
import { MarketTab } from "../../../src/features/plans/MarketTab";

const SEGMENTS = ["Kế hoạch AI", "Chợ kế hoạch"];

/**
 * CL-18 — "Kế hoạch tập": the design's `Plans` screen (Segmented "Kế hoạch AI" / "Chợ kế hoạch"),
 * carrying web's `PlansPage` (AIPlansPage + PlanMarketplacePage) behind it. `?tab=market` opens
 * the market directly (used when coming back from a 1-1 order); `?goal=` pre-fills the wizard.
 */
export default function PlansScreen() {
  const params = useLocalSearchParams<{ tab?: string; market?: string }>();
  const [segment, setSegment] = useState(params.tab === "market" ? SEGMENTS[1] : SEGMENTS[0]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title="Kế hoạch tập"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/client/workout"))}
      />
      <View className="px-5 pt-4">
        <Segmented options={SEGMENTS} value={segment} onChange={setSegment} />
      </View>
      {segment === SEGMENTS[0] ? (
        <AiPlansTab />
      ) : (
        <MarketTab initialTab={typeof params.market === "string" ? (params.market as any) : undefined} />
      )}
    </View>
  );
}
