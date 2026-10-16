import { useState } from "react";
import { router } from "expo-router";
import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { useToast } from "../../components/ui";
import { useApp } from "../../context/AppContext";
import { openPaymentGateway } from "./openGateway";
import { checkoutErrorMessage, readCheckout, resultHref } from "./payments";

/**
 * Phase 14.1 — the one flow behind every "Thanh toán" button: pick a gateway → the server creates
 * the transaction → the gateway opens in a browser tab → the result screen asks the server.
 *
 * `target` is whatever the button is paying for (a membership, a contract, a plan to buy); while
 * it is set the gateway sheet is open. The sheet closes before the browser opens, so coming back
 * never lands on a stale picker.
 *
 * A checkout response is a redirect, not a settled payment — nothing here says "paid". The only
 * exception the server itself can make (settling on the spot, `status: PAID`) still goes through
 * the result screen, which confirms it with sync like any other.
 */
export function useGatewayCheckout<T>({
  start,
  invalidate,
}: {
  start: (target: T, provider: string) => Promise<unknown>;
  /** Lists that now hold a new pending transaction/row — refetched as soon as the checkout exists. */
  invalidate: QueryKey[];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const [target, setTarget] = useState<T | null>(null);

  const mutation = useMutation({
    mutationFn: ({ target: t, provider }: { target: T; provider: string }) => start(t, provider),
    onSuccess: async (raw) => {
      setTarget(null);
      for (const queryKey of invalidate) void queryClient.invalidateQueries({ queryKey });
      const checkout = readCheckout(raw);
      if (checkout.redirectUrl) {
        try {
          await openPaymentGateway({
            url: checkout.redirectUrl,
            transactionId: checkout.transactionId,
            userId: user?.id,
          });
        } catch {
          toast.show("Không mở được trang thanh toán — thử lại.", "danger");
        }
        return;
      }
      if (checkout.alreadyPaid && checkout.transactionId) {
        router.navigate(resultHref(checkout.transactionId) as never);
        return;
      }
      toast.show(
        checkout.failureReason ?? "Cổng thanh toán không trả về liên kết — thử lại hoặc chọn cổng khác.",
        "danger",
      );
    },
    onError: (error) => {
      setTarget(null);
      for (const queryKey of invalidate) void queryClient.invalidateQueries({ queryKey });
      toast.show(checkoutErrorMessage(error), "danger");
    },
  });

  return {
    /** What the open sheet is paying for; null while it is closed. */
    target,
    choose: (next: T) => setTarget(next),
    close: () => {
      if (!mutation.isPending) setTarget(null);
    },
    pay: (provider: string) => {
      if (target != null) mutation.mutate({ target, provider });
    },
    submitting: mutation.isPending,
  };
}
