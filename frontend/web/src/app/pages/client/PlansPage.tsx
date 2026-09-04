import { BrainIcon as Brain, StorefrontIcon as Store } from "@phosphor-icons/react";
import { TabbedPage } from "../../components/TabbedPage";
import { AIPlansPage } from "./AIPlansPage";
import { PlanMarketplacePage } from "./PlanMarketplacePage";

export function PlansPage() {
  return (
    <TabbedPage
      tabs={[
        {
          value: "ai-plans",
          label: "Kế hoạch AI",
          icon: Brain,
          content: <AIPlansPage />,
        },
        {
          value: "marketplace",
          label: "Chợ kế hoạch",
          icon: Store,
          content: <PlanMarketplacePage />,
        },
      ]}
    />
  );
}
