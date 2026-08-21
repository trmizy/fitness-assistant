import { useParams, useNavigate } from "react-router";
import { Dumbbell, MapPin, Loader2, ArrowLeft, CheckCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { gymService } from "../../services/api";
import { toast } from "sonner";
import type { Gym, GymMembershipPlan } from "../../types";
import { formatVND } from "../../utils/currency";
import { Stars } from "../../components/gym/Stars";
import { GymReviewsSection } from "../../components/gym/GymReviewsSection";

export function GymDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: gym, isLoading: gymLoading } = useQuery<Gym>({
    queryKey: ["gym", id],
    queryFn: () => gymService.getGym(id!),
    enabled: !!id,
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<GymMembershipPlan[]>({
    queryKey: ["gym-plans", id],
    queryFn: () => gymService.listPlans(id!),
    enabled: !!id,
  });

  const buyMutation = useMutation({
    mutationFn: (planId: string) => gymService.buyMembership(id!, planId),
    onSuccess: (result: any) => {
      if (result?.data?.payment?.status === "PAID") {
        toast.success("Membership purchased — you're all set!");
        navigate("/client/gym-memberships");
      } else {
        // Purchase request succeeded (2xx) but the payment attempt itself failed
        // (e.g. insufficient balance) — membership stays PENDING_PAYMENT, retriable.
        toast.error(result?.data?.payment?.failureReason || "Payment failed — check your wallet balance");
        queryClient.invalidateQueries({ queryKey: ["client-gym-memberships"] });
      }
    },
    onError: (err: any) => {
      const code = err?.response?.data?.error?.code;
      if (code === "ALREADY_HAS_PENDING_MEMBERSHIP") {
        toast.error("You already have a pending membership at this gym — pay it off first.");
        navigate("/client/gym-memberships");
        return;
      }
      if (code === "ALREADY_HAS_OPEN_MEMBERSHIP") {
        toast.error("You already have an active membership at this gym.");
        return;
      }
      toast.error(code || "Failed to purchase membership");
    },
  });

  if (gymLoading || plansLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  if (!gym) {
    return (
      <div className="p-6 max-w-3xl mx-auto text-center text-zinc-500">Gym not found</div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <button type="button" onClick={() => navigate("/client/gyms")} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300">
        <ArrowLeft className="w-4 h-4" /> Back to gyms
      </button>

      <div className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center">
            <Dumbbell className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">{gym.name}</h1>
            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <MapPin className="w-3 h-3" /> {gym.address}{gym.city ? `, ${gym.city}` : ""}
            </div>
            {typeof gym.reviewCount === "number" && gym.reviewCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-zinc-400 mt-1">
                <Stars value={gym.averageRating ?? 0} /> {(gym.averageRating ?? 0).toFixed(1)} ({gym.reviewCount})
              </div>
            )}
          </div>
        </div>
        {gym.description && <p className="text-sm text-zinc-400 mt-3">{gym.description}</p>}
      </div>

      <div>
        <h2 className="text-sm font-bold text-zinc-300 mb-2">Membership Plans</h2>
        {plans.length === 0 ? (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-8 text-center text-sm text-zinc-500">
            No plans available yet.
          </div>
        ) : (
          <div className="space-y-3">
            {plans.map((p) => (
              <div key={p.id} className="bg-zinc-900 rounded-xl border border-zinc-800/60 p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-zinc-200">{p.name}</div>
                  {p.description && <div className="text-xs text-zinc-500 mt-0.5">{p.description}</div>}
                  <div className="text-xs text-zinc-600 mt-1">
                    {p.durationDays} days{p.visitLimit ? ` · ${p.visitLimit} visits` : " · unlimited visits"}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-green-400 mb-2">{formatVND(Number(p.price))}</div>
                  <button
                    type="button"
                    onClick={() => buyMutation.mutate(p.id)}
                    disabled={buyMutation.isPending}
                    className="flex items-center gap-1.5 bg-green-500 hover:bg-green-400 disabled:opacity-60 text-black px-3 py-2 rounded-lg text-xs font-bold transition-all"
                  >
                    {buyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Buy
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <GymReviewsSection gymId={id!} />
    </div>
  );
}
