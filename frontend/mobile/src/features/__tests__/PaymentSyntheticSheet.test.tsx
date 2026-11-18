import { Text, View } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PaymentMethodSheet } from "../../components/payment/PaymentMethodSheet";
import { ToastProvider } from "../../components/ui";
import { paymentService } from "../../services/api";
import { SYNTHETIC_CHECKOUT_NOTICE } from "../payments/payments";
import { useGatewayCheckout } from "../payments/useGatewayCheckout";

/**
 * Khi server từ chối thanh toán vì dữ liệu mẫu (SYNTHETIC_RECORD_NOT_TRANSACTABLE), bảng chọn cổng phải
 * GIỮ MỞ và hiện lý do ngay trong bảng (không chỉ toast, vì toast nằm dưới cửa sổ Modal đang đóng);
 * nút "Thanh toán" tắt. Lỗi khác vẫn đóng bảng như cũ.
 * Evidence label: TEST FIXTURE (jest-expo component test) — not a real-device run.
 */

jest.mock("expo-router", () => ({ router: { navigate: jest.fn(), push: jest.fn() } }));
jest.mock("../payments/openGateway", () => ({ openPaymentGateway: jest.fn() }));
jest.mock("../../context/AppContext", () => ({ useApp: () => ({ user: { id: "u1" } }) }));
jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return { ...actual, paymentService: { getMethods: jest.fn() } };
});

const methods = paymentService.getMethods as unknown as jest.Mock;

let startImpl: jest.Mock;
function Harness() {
  const checkout = useGatewayCheckout<{ price: number }>({ start: (t, p) => startImpl(t, p), invalidate: [] });
  return (
    <View>
      <Text onPress={() => checkout.choose({ price: 100000 })}>mo-bang</Text>
      <Text>{checkout.target ? "sheet-open" : "sheet-closed"}</Text>
      <PaymentMethodSheet
        open={checkout.target != null}
        amount={checkout.target?.price ?? 0}
        submitting={checkout.submitting}
        blockedMessage={checkout.blockedMessage}
        onConfirm={checkout.pay}
        onClose={checkout.close}
      />
    </View>
  );
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Harness />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const reject = (data: unknown) => Object.assign(new Error("Request failed"), { response: { status: 409, data } });

beforeEach(() => {
  methods.mockResolvedValue({
    methods: [{ provider: "VNPAY", label: "VNPay", description: "Thẻ ATM", configured: true, unavailableReason: null }],
    defaultProvider: "VNPAY",
  });
});

it("dữ liệu mẫu: bảng giữ mở, hiện lý do trong bảng, nút Thanh toán tắt", async () => {
  startImpl = jest.fn().mockRejectedValue(
    reject({ success: false, error: { code: "SYNTHETIC_RECORD_NOT_TRANSACTABLE", message: "Dữ liệu mẫu (SYNTHETIC) chỉ dùng để hiển thị" } }),
  );
  const view = await renderHarness();
  await fireEvent.press(view.getByText("mo-bang"));
  await waitFor(() => view.getByText("Thanh toán"));
  await fireEvent.press(view.getByText("Thanh toán"));

  await waitFor(() => view.getByText(SYNTHETIC_CHECKOUT_NOTICE));
  expect(view.getByText("sheet-open")).toBeTruthy();
  expect(startImpl).toHaveBeenCalledTimes(1);
  // Không lộ chữ SYNTHETIC của server.
  expect(view.queryByText(/SYNTHETIC/)).toBeNull();

  // Nút tắt: bấm thêm không gọi server lần nữa.
  await fireEvent.press(view.getByText("Thanh toán"));
  expect(startImpl).toHaveBeenCalledTimes(1);

  // Huỷ đóng bảng và xoá lý do.
  await fireEvent.press(view.getByText("Huỷ"));
  await waitFor(() => view.getByText("sheet-closed"));
});

it("lỗi khác vẫn đóng bảng (hành vi cũ), không hiện thông báo dữ liệu mẫu", async () => {
  startImpl = jest.fn().mockRejectedValue(reject({ success: false, error: { code: "PROVIDER_NOT_CONFIGURED", message: "x" } }));
  const view = await renderHarness();
  await fireEvent.press(view.getByText("mo-bang"));
  await waitFor(() => view.getByText("Thanh toán"));
  await act(async () => {
    await fireEvent.press(view.getByText("Thanh toán"));
  });
  await waitFor(() => view.getByText("sheet-closed"));
  expect(view.queryByText(SYNTHETIC_CHECKOUT_NOTICE)).toBeNull();
});
