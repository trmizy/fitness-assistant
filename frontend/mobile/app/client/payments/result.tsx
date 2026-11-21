import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, Clock, XCircle } from "lucide-react-native";

import { Button, Card } from "../../../src/components/ui";
import { PaymentMethodSheet } from "../../../src/components/payment/PaymentMethodSheet";
import { contractService, gymService, paymentService } from "../../../src/services/api";
import {
  destinationFor,
  phaseFromSync,
  shortTransactionRef,
  retryActionFor,
  retryTargetFor,
  type ResultPhase,
  type RetryTarget,
} from "../../../src/features/payments/payments";
import { useGatewayCheckout } from "../../../src/features/payments/useGatewayCheckout";
import { normalizeMemberships } from "../../../src/features/services/gymDirectory";
import { normalizeContracts } from "../../../src/features/services/contracts";
import { clearPendingCheckout } from "../../../src/features/payments/pendingCheckout";
import { clearPaymentReturn, peekPaymentReturn } from "../../../src/features/payments/paymentReturnStore";
import { useApp } from "../../../src/context/AppContext";
import { darkColors, designTokens } from "../../../src/theme/colors";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

/** Keys whose data a settled payment changes — refetched once the server says PAID. */
const PAID_INVALIDATES = [
  ["my-memberships"],
  ["client-contracts"],
  // Bought a gym plan from a PT's page: its branch list must show the new membership when the client goes back.
  ["contract-gym-options"],
  ["personalized-service-orders"],
  ["personalized-service-order"],
];

const COPY: Record<ResultPhase, { title: string; description: string }> = {
  checking: { title: "Đang xác nhận thanh toán…", description: "Đang kiểm tra với cổng thanh toán, vui lòng đợi." },
  paid: { title: "Thanh toán thành công", description: "Giao dịch của bạn đã được kích hoạt." },
  pending: {
    title: "Đang chờ xác nhận",
    description:
      "Cổng thanh toán chưa xác nhận xong. Nếu bạn đã trả tiền, hãy kiểm tra lại sau ít phút. Nếu bạn đã huỷ, giao dịch sẽ tự đóng sau tối đa 15 phút.",
  },
  failed: { title: "Thanh toán chưa thành công", description: "Giao dịch không hoàn tất. Bạn chưa bị trừ tiền." },
  error: { title: "Không xác nhận được", description: "Có lỗi khi kiểm tra trạng thái giao dịch. Thử lại sau." },
};

/**
 * SH-06 — where every gateway checkout comes back (web: pages/client/PaymentResultPage.tsx).
 *
 * Reached two ways: openPaymentGateway navigating here once the browser tab closes, or the
 * gateway's deep link `fitnessassistant://client/payments/result?txnId=…` (which also cold-starts
 * the app if it was killed mid-payment). Either way the only input is the transaction id; the
 * verdict is always `POST /me/payments/:id/sync`, never the link's own `status` — which
 * app/+native-intent.tsx strips before the route is even built.
 */
export default function PaymentResultScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const queryClient = useQueryClient();
  const { txnId: rawTxnId, gw } = useLocalSearchParams<{ txnId?: string; gw?: string }>();
  const txnId = typeof rawTxnId === "string" ? rawTxnId : "";

  const { user } = useApp();
  const [returnPath, setReturnPath] = useState<string | null>(null);
  const [phase, setPhase] = useState<ResultPhase>("checking");
  const [sync, setSync] = useState<unknown>(null);
  // The same result can arrive twice (deep link + the tab's promise); one sync per id is enough.
  const lastChecked = useRef<string | null>(null);

  const confirm = useCallback(async () => {
    if (!txnId) {
      setPhase("error");
      return;
    }
    setPhase("checking");
    try {
      const result = await paymentService.syncTransaction(txnId);
      setSync(result);
      const next = phaseFromSync(result);
      setPhase(next);
      if (next === "paid") {
        for (const queryKey of PAID_INVALIDATES) void queryClient.invalidateQueries({ queryKey });
      }
    } catch {
      setPhase("error");
    }
  }, [queryClient, txnId]);

  useEffect(() => {
    if (lastChecked.current === txnId) return;
    lastChecked.current = txnId;
    // Arrived here, one way or another — the killed-app resume record has done its job.
    void clearPendingCheckout();
    void confirm();
  }, [confirm, txnId]);

  // Bought a gym plan from inside a PT request: a way back to that request (same package / branch). Navigation only —
  // the verdict above is still the server's. Only a path this user's own checkout remembered is ever offered.
  useEffect(() => {
    if (phase === "checking" || !txnId) return;
    let alive = true;
    void peekPaymentReturn(txnId, user?.id).then((path) => {
      if (alive) setReturnPath(path);
    });
    return () => {
      alive = false;
    };
  }, [phase, txnId, user?.id]);

  // N17M-03 — the gateway's own return link said the checkout did not complete (e.g. "Hủy giao dịch" at ZaloPay,
  // which keeps its order open ~15 minutes). The server still says pending, so this is only the wording; a
  // later check that returns PAID replaces it, and "Kiểm tra lại" stays available.
  const stopped = phase === "pending" && gw === "failed";
  const shownPhase: ResultPhase = stopped ? "failed" : phase;
  const dest = destinationFor(sync);
  const copy = stopped
    ? {
        title: "Thanh toán chưa hoàn tất",
        description:
          "Cổng thanh toán báo giao dịch chưa hoàn tất. Nếu tiền đã bị trừ, hệ thống sẽ tự cập nhật sau ít phút; nếu không, bạn có thể thanh toán lại.",
      }
    : COPY[phase];

  // N17M-02 — pay again for the same item, with the same calls the Hội viên / Hợp đồng cards use. Only offered
  // while the item can still be paid (PENDING_PAYMENT); a membership the server already cancelled is bought
  // again at its gym instead. No new backend: the item's state is read from the lists those cards read.
  const retryTarget: RetryTarget | null = shownPhase === "failed" ? retryTargetFor(sync) : null;
  const membershipsQuery = useQuery({
    queryKey: ["my-memberships"],
    queryFn: () => gymService.listMyMemberships(),
    enabled: retryTarget?.kind === "membership",
  });
  const contractsQuery = useQuery({
    queryKey: ["client-contracts"],
    queryFn: () => contractService.getByClient(),
    enabled: retryTarget?.kind === "contract",
  });
  const retryItem = useMemo(() => {
    if (!retryTarget) return null;
    if (retryTarget.kind === "membership") {
      return normalizeMemberships(membershipsQuery.data).find((m) => m.id === retryTarget.id) ?? null;
    }
    return normalizeContracts(contractsQuery.data).find((c) => c.id === retryTarget.id) ?? null;
  }, [retryTarget, membershipsQuery.data, contractsQuery.data]);
  const retryAction = retryTarget ? retryActionFor(retryItem, retryTarget.kind) : null;
  const checkout = useGatewayCheckout<RetryTarget>({
    start: (target, provider) =>
      target.kind === "membership" ? gymService.payMembership(target.id, provider) : contractService.pay(target.id, provider),
    invalidate: [["my-memberships"], ["client-contracts"]],
  });
  const icon =
    shownPhase === "checking" ? (
      <ActivityIndicator size="large" color={accent.primary} />
    ) : shownPhase === "paid" ? (
      <CheckCircle2 size={48} color={accent.primary} />
    ) : shownPhase === "pending" ? (
      <Clock size={48} color={designTokens.warning} />
    ) : (
      <XCircle size={48} color={darkColors.destructive} />
    );

  return (
    <View className="flex-1 bg-background px-5" style={{ paddingTop: insets.top + 48 }}>
      <Card className="items-center gap-4 px-6 py-8">
        {icon}
        <Text className="text-center font-display text-xl text-foreground">{copy.title}</Text>
        <Text className="text-center font-body text-sm leading-5 text-muted-foreground">{copy.description}</Text>
        {txnId ? (
          <Text className="text-center font-body text-[11px] text-muted-foreground" selectable>
            Mã tham chiếu: {shortTransactionRef(txnId)}
          </Text>
        ) : null}

        <View className="w-full gap-2 pt-2">
          {returnPath ? (
            <Button
              full
              onPress={() => {
                const path = returnPath;
                void clearPaymentReturn();
                router.navigate(path as never);
              }}
            >
              Quay lại đặt gói PT
            </Button>
          ) : null}
          {retryAction && retryTarget ? (
            <Button
              full
              disabled={checkout.submitting}
              onPress={() =>
                retryAction.type === "pay"
                  ? checkout.choose(retryTarget)
                  : router.replace({ pathname: "/client/services/gyms/[id]", params: { id: retryAction.gymId } } as never)
              }
            >
              {retryAction.type === "pay" ? "Thanh toán lại" : "Chọn lại gói tập"}
            </Button>
          ) : null}
          {phase === "pending" || phase === "error" ? (
            <Button variant="secondary" full onPress={() => void confirm()}>
              Kiểm tra lại
            </Button>
          ) : null}
          <Button
            full
            variant={retryAction || returnPath ? "secondary" : "primary"}
            disabled={phase === "checking"}
            onPress={() => router.replace((phase === "paid" ? dest.href : "/client/services") as never)}
          >
            {phase === "paid" ? dest.label : "Về Dịch vụ"}
          </Button>
        </View>
      </Card>
      <PaymentMethodSheet
        open={checkout.target != null}
        amount={retryAction?.type === "pay" ? retryAction.amount : 0}
        title={retryTarget?.kind === "contract" ? "Thanh toán hợp đồng" : "Thanh toán gói hội viên"}
        note="Bạn sẽ được chuyển sang trang của cổng thanh toán. Dịch vụ chỉ kích hoạt sau khi cổng xác nhận giao dịch thành công."
        submitting={checkout.submitting}
        blockedMessage={checkout.blockedMessage}
        onConfirm={checkout.pay}
        onClose={checkout.close}
      />
    </View>
  );
}
