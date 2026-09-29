import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, Clock, XCircle } from "lucide-react-native";

import { Button, Card } from "../../../src/components/ui";
import { paymentService } from "../../../src/services/api";
import { destinationFor, phaseFromSync, type ResultPhase } from "../../../src/features/payments/payments";
import { clearPendingCheckout } from "../../../src/features/payments/pendingCheckout";
import { darkColors, designTokens } from "../../../src/theme/colors";
import { useWorkspaceAccent } from "../../../src/theme/workspace";

/** Keys whose data a settled payment changes — refetched once the server says PAID. */
const PAID_INVALIDATES = [
  ["my-memberships"],
  ["client-contracts"],
  ["personalized-service-orders"],
  ["personalized-service-order"],
];

const COPY: Record<ResultPhase, { title: string; description: string }> = {
  checking: { title: "Đang xác nhận thanh toán…", description: "Đang kiểm tra với cổng thanh toán, vui lòng đợi." },
  paid: { title: "Thanh toán thành công", description: "Giao dịch của bạn đã được kích hoạt." },
  pending: {
    title: "Đang chờ xác nhận",
    description: "Cổng thanh toán chưa xác nhận xong. Nếu bạn đã trả tiền, hãy kiểm tra lại sau ít phút.",
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
  const { txnId: rawTxnId } = useLocalSearchParams<{ txnId?: string }>();
  const txnId = typeof rawTxnId === "string" ? rawTxnId : "";

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

  const dest = destinationFor(sync);
  const copy = COPY[phase];
  const icon =
    phase === "checking" ? (
      <ActivityIndicator size="large" color={accent.primary} />
    ) : phase === "paid" ? (
      <CheckCircle2 size={48} color={accent.primary} />
    ) : phase === "pending" ? (
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
            Mã giao dịch: {txnId}
          </Text>
        ) : null}

        <View className="w-full gap-2 pt-2">
          {phase === "pending" || phase === "error" ? (
            <Button variant="secondary" full onPress={() => void confirm()}>
              Kiểm tra lại
            </Button>
          ) : null}
          <Button
            full
            disabled={phase === "checking"}
            onPress={() => router.replace((phase === "paid" ? dest.href : "/client/services") as never)}
          >
            {phase === "paid" ? dest.label : "Về Dịch vụ"}
          </Button>
        </View>
      </Card>
    </View>
  );
}
