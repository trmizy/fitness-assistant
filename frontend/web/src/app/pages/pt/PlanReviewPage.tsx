import { ClipboardCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { planService } from "../../services/api";

export function PlanReviewPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["pt-plan-review-current"],
    queryFn: planService.getCurrentPlans,
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-zinc-100 text-xl font-bold">Plan Review</h1>
        <p className="text-zinc-500 text-sm mt-1">Only database-backed plan data is shown.</p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-6">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardCheck className="w-4 h-4 text-green-400" />
          <span className="text-sm font-semibold text-zinc-200">Current Plans</span>
        </div>

        {isLoading ? (
          <p className="text-sm text-zinc-500">Loading...</p>
        ) : !data?.workoutPlan && !data?.mealPlan ? (
          <p className="text-sm text-zinc-500">No plan data found in database.</p>
        ) : (
          <pre className="text-xs text-zinc-300 bg-zinc-950 border border-zinc-800/60 rounded-lg p-3 overflow-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
