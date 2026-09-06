import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CreditCardIcon as CreditCard, CircleNotchIcon as Loader2, WarningIcon as AlertTriangle, XIcon as X } from "@phosphor-icons/react";
import { paymentService } from "../../services/api";
import { formatVND } from "../../utils/currency";
import { useBackDismissible } from "../../hooks/useBackDismissible";

export interface PaymentMethod {
  provider: string;
  label: string;
  description: string;
  configured: boolean;
  unavailableReason: string | null;
}

/** Brand marks, drawn rather than fetched — the artifact CSP blocks remote images anyway. */
const BADGE: Record<string, { text: string; className: string }> = {
  VNPAY: { text: "VN", className: "bg-[#0a4f9e] text-white" },
  ZALOPAY: { text: "ZP", className: "bg-[#0068ff] text-white" },
  MOMO: { text: "M", className: "bg-[#a50064] text-white" },
};

/**
 * Asks which gateway to pay with, then hands the choice back.
 *
 * The list comes from the server, not from a constant here: which gateways work depends on
 * the credentials the deployment holds, and a hard-coded list starts lying the moment an
 * operator adds or drops one. Unusable gateways are shown greyed out with the reason instead
 * of being hidden, so "where did MoMo go?" has a visible answer.
 */
export function PaymentMethodDialog({
  amount,
  title = "Chọn phương thức thanh toán",
  isSubmitting = false,
  onConfirm,
  onClose,
}: {
  amount: number;
  title?: string;
  isSubmitting?: boolean;
  onConfirm: (provider: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  // Android Back closes this dialog instead of navigating the page behind it — but not
  // mid-submit, when a checkout is already being created and closing would leave the user
  // unsure whether it went through.
  useBackDismissible(!isSubmitting, onClose);

  // A real touch on the emulator (host mouse click translated through QEMU's virtual
  // touchscreen) was confirmed, directly, to sometimes dispatch the confirm button's click
  // TWICE for one tap — captured on the wire as two separate POST /purchase calls a few
  // hundred ms apart, one of which can lose a race server-side and surface as a misleading
  // "Không thể mua dịch vụ này" error even though the other one succeeded. `disabled={...
  // isSubmitting}` alone doesn't close this window: it depends on a state update + re-render
  // landing between the two click events, which is exactly the race that was losing. A plain
  // ref checked synchronously in the handler itself has no such window — it's set on the
  // very first click, before React ever gets involved, so a second click event arriving
  // microtasks later is a no-op regardless of render timing.
  const hasConfirmedRef = useRef(false);

  const { data, isLoading, isError } = useQuery<{
    methods: PaymentMethod[];
    defaultProvider: string | null;
  }>({
    queryKey: ["payment-methods"],
    queryFn: () => paymentService.getMethods(),
    staleTime: 5 * 60 * 1000,
  });

  // Pre-select the server's suggestion once it arrives, without fighting a user who has
  // already picked something.
  useEffect(() => {
    if (!selected && data?.defaultProvider) setSelected(data.defaultProvider);
  }, [data?.defaultProvider, selected]);

  const methods = data?.methods ?? [];
  const usable = methods.filter((m) => m.configured);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-5 border-b border-zinc-800/60 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-zinc-100 font-bold flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-green-400" /> {title}
            </h3>
            <p className="text-sm text-zinc-500 mt-0.5">
              Số tiền cần thanh toán:{" "}
              <span className="text-green-400 font-bold">{formatVND(amount)}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-2">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 text-green-500 animate-spin" />
            </div>
          )}

          {isError && (
            <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              Không tải được danh sách cổng thanh toán. Thử lại sau.
            </div>
          )}

          {!isLoading &&
            !isError &&
            methods.map((m) => {
              const badge = BADGE[m.provider] ?? { text: "?", className: "bg-zinc-700 text-zinc-200" };
              const active = selected === m.provider;
              return (
                <button
                  key={m.provider}
                  type="button"
                  disabled={!m.configured}
                  onClick={() => setSelected(m.provider)}
                  className={`w-full flex items-center gap-3 text-left p-3 rounded-xl border-2 transition-all ${
                    !m.configured
                      ? "border-zinc-800/60 bg-zinc-900 opacity-50 cursor-not-allowed"
                      : active
                        ? "border-green-500 bg-green-500/8"
                        : "border-zinc-800/60 bg-zinc-900 hover:border-zinc-700"
                  }`}
                >
                  <span
                    className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0 ${badge.className}`}
                  >
                    {badge.text}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-zinc-200">{m.label}</span>
                    <span className="block text-xs text-zinc-500 truncate">
                      {m.configured ? m.description : m.unavailableReason}
                    </span>
                  </span>
                  <span
                    className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                      active ? "border-green-500 bg-green-500" : "border-zinc-600"
                    }`}
                  />
                </button>
              );
            })}

          {!isLoading && !isError && usable.length === 0 && (
            <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              Chưa có cổng thanh toán nào được cấu hình. Liên hệ quản trị viên.
            </div>
          )}

          <p className="text-[11px] text-zinc-600 leading-snug pt-1">
            Bạn sẽ được chuyển sang trang của cổng thanh toán. Hợp đồng chỉ được kích hoạt sau
            khi cổng xác nhận giao dịch thành công.
          </p>
        </div>

        <div className="p-5 border-t border-zinc-800/60 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 border border-zinc-700/60 text-zinc-300 text-sm font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => {
              if (hasConfirmedRef.current || !selected) return;
              hasConfirmedRef.current = true;
              onConfirm(selected);
            }}
            disabled={!selected || isSubmitting}
            className="flex-1 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Thanh toán
          </button>
        </div>
      </div>
    </div>
  );
}
