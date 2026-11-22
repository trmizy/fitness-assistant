/**
 * Mutations of the branch detail page (batch G2). They call the SAME gymService functions with the SAME payload shapes and
 * invalidate the SAME query keys as the legacy GymManagePage (CODE AUDIT: docs/.../batches/g2/PARITY.md maps each one to its
 * legacy line). Differences, all presentation only: the success sentence of a save says what that save was (the legacy one always
 * said "tên/địa chỉ ... sau khi admin duyệt", even for a phone number), "admin" reads "Gymini", and `["owned-gyms"]` is also
 * invalidated so the branch list and the scope strip show the new status without a reload.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { gymService } from "../../../services/api";
import type { GymOperatingHoursDay } from "../../../types";
import { apiMessage, updateSuccessMessage } from "./branchesModel";

type UpdatePayload = Parameters<typeof gymService.updateGym>[1];

export function useUpdateGym(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePayload) => gymService.updateGym(id, payload),
    onSuccess: (_data, payload) => {
      toast.success(updateSuccessMessage(payload));
      queryClient.invalidateQueries({ queryKey: ["owned-gym", id] });
      queryClient.invalidateQueries({ queryKey: ["owned-gyms"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Không thể lưu thay đổi")),
  });
}

export function useSetHours(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (days: GymOperatingHoursDay[]) => gymService.setGymHours(id, days),
    onSuccess: () => {
      toast.success("Đã lưu giờ hoạt động");
      queryClient.invalidateQueries({ queryKey: ["owned-gym-hours", id] });
    },
    onError: (err) => toast.error(apiMessage(err, "Không thể lưu giờ hoạt động")),
  });
}

export interface OperationalStatusPayload {
  operationalStatus: "OPEN" | "TEMPORARILY_CLOSED" | "PERMANENTLY_CLOSED";
  reason?: string;
  expectedReopenAt?: string;
}

/**
 * Temporary close / reopen / permanent close. No error toast: the dialog that triggers it shows the server's sentence (409/403
 * arrive in Vietnamese) inline and stays open, so nothing is lost.
 */
export function useSetOperationalStatus(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: OperationalStatusPayload) => gymService.setGymOperationalStatus(id, payload.operationalStatus, payload.reason, payload.expectedReopenAt),
    onSuccess: () => {
      toast.success("Đã cập nhật trạng thái hoạt động");
      queryClient.invalidateQueries({ queryKey: ["owned-gym", id] });
      queryClient.invalidateQueries({ queryKey: ["owned-gyms"] });
    },
  });
}

/**
 * Withdrawal request: only creates a PENDING row, no money moves until Gymini confirms a real bank transfer. The destination is
 * always the partner's REGISTERED payout account (the server picks it; no payout field is sent, 409 PAYOUT_ACCOUNT_REQUIRED if none).
 */
export function useRequestWithdrawal(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { amount: string }) => gymService.requestGymWithdrawal(id, v.amount),
    onSuccess: () => {
      toast.success("Đã gửi yêu cầu rút tiền");
      queryClient.invalidateQueries({ queryKey: ["owned-gym-withdrawals", id] });
      queryClient.invalidateQueries({ queryKey: ["owned-gym-wallet", id] });
    },
  });
}
