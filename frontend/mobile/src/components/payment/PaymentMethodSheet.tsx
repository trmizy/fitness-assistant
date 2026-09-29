import { useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react-native";

import { BottomSheet, Button, Tappable } from "../ui";
import { paymentService } from "../../services/api";
import { normalizeMethods, PROVIDER_BADGE } from "../../features/payments/payments";
import { darkColors, designTokens } from "../../theme/colors";
import { useWorkspaceAccent } from "../../theme/workspace";
import { formatVND } from "../../utils/currency";

/**
 * Phase 14.1 — "which gateway?" (web: components/payment/PaymentMethodDialog.tsx).
 *
 * The list is the server's (`GET /me/payments/methods`): which gateways work depends on the
 * credentials this deployment holds, so a constant here would start lying the moment an operator
 * adds or drops one. A gateway without credentials stays visible, greyed, with the server's reason.
 *
 * Confirm is guarded by a ref, not just `disabled`: one tap reaching the handler twice creates two
 * checkouts, and web caught exactly that on the emulator's translated touches. The sheet unmounts
 * when closed, so the guard resets for the next attempt.
 */
export function PaymentMethodSheet({
  open,
  amount,
  title = "Chọn phương thức thanh toán",
  note = "Bạn sẽ được chuyển sang trang của cổng thanh toán. Dịch vụ chỉ được kích hoạt sau khi cổng xác nhận giao dịch thành công.",
  submitting,
  onConfirm,
  onClose,
}: {
  open: boolean;
  amount: number;
  title?: string;
  note?: string;
  submitting: boolean;
  onConfirm: (provider: string) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} onClose={submitting ? () => undefined : onClose} title={title}>
      <MethodList amount={amount} note={note} submitting={submitting} onConfirm={onConfirm} onClose={onClose} />
    </BottomSheet>
  );
}

function MethodList({
  amount,
  note,
  submitting,
  onConfirm,
  onClose,
}: {
  amount: number;
  note: string;
  submitting: boolean;
  onConfirm: (provider: string) => void;
  onClose: () => void;
}) {
  const accent = useWorkspaceAccent();
  const [picked, setPicked] = useState<string | null>(null);
  const confirmed = useRef(false);

  const query = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => paymentService.getMethods(),
    staleTime: 5 * 60 * 1000,
  });
  const { methods, defaultProvider } = normalizeMethods(query.data);
  const usable = methods.filter((m) => m.configured);

  // The server's suggestion stands until the payer picks something else.
  const selected = picked ?? defaultProvider;

  return (
    <View className="gap-3 pb-2">
      <Text className="font-body text-sm text-muted-foreground">
        Số tiền cần thanh toán:{" "}
        <Text className="font-body-semibold" style={{ color: accent.primary }}>
          {formatVND(amount)}
        </Text>
      </Text>

      {query.isLoading ? (
        <View className="items-center py-8">
          <ActivityIndicator color={accent.primary} />
        </View>
      ) : query.isError ? (
        <Notice tone="danger" text="Không tải được danh sách cổng thanh toán. Thử lại sau." />
      ) : (
        <View className="gap-2">
          {methods.map((m) => {
            const badge = PROVIDER_BADGE[m.provider] ?? { text: "?", background: darkColors.muted };
            const active = selected === m.provider;
            return (
              <Tappable
                key={m.provider}
                disabled={!m.configured || submitting}
                onPress={() => setPicked(m.provider)}
                accessibilityLabel={m.label}
                className={[
                  "flex-row items-center gap-3 rounded-2xl border-2 bg-card p-3",
                  m.configured ? "" : "opacity-50",
                ].join(" ")}
                style={{ borderColor: active ? accent.primary : darkColors.border }}
              >
                <View
                  className="h-10 w-10 items-center justify-center rounded-xl"
                  style={{ backgroundColor: badge.background }}
                >
                  <Text className="font-body-semibold text-sm text-white">{badge.text}</Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="font-body-semibold text-sm text-foreground">{m.label}</Text>
                  <Text className="font-body text-xs text-muted-foreground" numberOfLines={2}>
                    {m.configured ? m.description : (m.unavailableReason ?? "Chưa cấu hình")}
                  </Text>
                </View>
                <View
                  className="h-4 w-4 rounded-full border-2"
                  style={{
                    borderColor: active ? accent.primary : designTokens.mutedForeground,
                    backgroundColor: active ? accent.primary : "transparent",
                  }}
                />
              </Tappable>
            );
          })}
          {usable.length === 0 ? (
            <Notice tone="warning" text="Chưa có cổng thanh toán nào được cấu hình. Liên hệ quản trị viên." />
          ) : null}
        </View>
      )}

      <Text className="font-body text-[11px] leading-4 text-muted-foreground">{note}</Text>

      <View className="flex-row gap-2">
        <Button variant="secondary" className="flex-1" disabled={submitting} onPress={onClose}>
          Huỷ
        </Button>
        <Button
          className="flex-1"
          disabled={!selected || submitting}
          onPress={() => {
            if (confirmed.current || !selected) return;
            confirmed.current = true;
            onConfirm(selected);
          }}
        >
          {submitting ? "Đang tạo giao dịch..." : "Thanh toán"}
        </Button>
      </View>
    </View>
  );
}

function Notice({ tone, text }: { tone: "danger" | "warning"; text: string }) {
  const color = tone === "danger" ? darkColors.destructive : designTokens.warning;
  return (
    <View
      className="flex-row items-start gap-2 rounded-xl border px-3 py-2"
      style={{ borderColor: `${color}55`, backgroundColor: `${color}1a` }}
    >
      <AlertTriangle size={16} color={color} />
      <Text className="flex-1 font-body text-sm" style={{ color }}>
        {text}
      </Text>
    </View>
  );
}
