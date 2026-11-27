/**
 * Data hooks of Tài chính (G5). One query per branch and resource, keyed by user + branch (a branch's wallet is never shown for another
 * branch or another user), so one failing wallet breaks only its own card. Same service calls as the legacy Finance page / branch
 * wallet block; no new endpoint. Reads do not retry (an error is shown with "Thử lại", not hidden behind a spinner).
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { gymService } from "../../../services/api";
import type { Wallet } from "../../../types";
import { useGymOwnerScope } from "../scope/GymOwnerScopeProvider";
import { normalizeSales, normalizeWithdrawals, type SalesView, type WithdrawalRow } from "./financeModel";

export const FIN_KEY = "gym-owner-fin";
export const finKey = (userId: string, resource: "wallet" | "withdrawals" | "sales", gymId: string) => [FIN_KEY, userId, resource, gymId] as const;

const READ = { retry: false, staleTime: 15_000, refetchOnWindowFocus: false } as const;

export function useWallet(gymId: string, enabled = true) {
  const { userId } = useGymOwnerScope();
  return useQuery<Wallet>({ queryKey: finKey(userId, "wallet", gymId), queryFn: () => gymService.getOwnedWallet(gymId), enabled, ...READ });
}

export function useWithdrawals(gym: { id: string; name: string }, enabled = true) {
  const { userId } = useGymOwnerScope();
  return useQuery<WithdrawalRow[]>({
    queryKey: finKey(userId, "withdrawals", gym.id),
    queryFn: async () => normalizeWithdrawals(await gymService.listGymWithdrawals(gym.id), gym),
    enabled,
    ...READ,
  });
}

export function useSales(gymId: string, enabled = true) {
  const { userId } = useGymOwnerScope();
  return useQuery<SalesView[]>({
    queryKey: finKey(userId, "sales", gymId),
    // The unpaged call, like the legacy page: the CSV and the total need every sold card (the server answers all rows when no limit is sent).
    queryFn: async () => normalizeSales(await gymService.listOwnedMemberships(gymId)),
    enabled,
    ...READ,
  });
}

/** The registered payout account of the partner (`payout` is sent to the owner only; null for other roles). Same key as useStaffRole. */
export function useOnboardingPayout(enabled: boolean) {
  return useQuery<{ payout?: { bankName: string | null; accountNumber: string | null; accountHolder: string | null } | null }>({
    queryKey: ["partner-onboarding-status"],
    queryFn: () => gymService.getOnboardingStatus(),
    enabled,
  });
}

/** After a withdrawal request: refresh this branch's wallet + requests here, in the branch summary card and in the Hôm nay task list. */
export function refreshAfterWithdrawal(queryClient: Pick<QueryClient, "invalidateQueries">, userId: string, gymId: string) {
  void queryClient.invalidateQueries({ queryKey: finKey(userId, "wallet", gymId) });
  void queryClient.invalidateQueries({ queryKey: finKey(userId, "withdrawals", gymId) });
  void queryClient.invalidateQueries({ queryKey: ["owned-gym-wallet", gymId] });
  void queryClient.invalidateQueries({ queryKey: ["owned-gym-withdrawals", gymId] });
  void queryClient.invalidateQueries({
    predicate: (q) => q.queryKey[0] === "gym-owner" && q.queryKey[1] === userId && typeof q.queryKey[5] === "string" && (q.queryKey[5] as string).startsWith("today:"),
  });
}

