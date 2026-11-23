import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CheckinExceptionsPanel } from "../gymOwner/AssistedCheckinPanel";
import GymOwnerPlansScreen from "../../../app/gym-owner/plans";
import GymOwnerWalletScreen from "../../../app/gym-owner/wallet";
import FinanceScreen from "../../../app/gym-owner/finance";
import { gymService } from "../../services/api";

/**
 * Gym owner (mobile): approve / reject check-in exceptions on the front desk, the create-plan refusal inside its sheet, and
 * "Ví" merged into "Tài chính".
 * Evidence label: TEST FIXTURE (jest-expo component test, mocked gymService) - NOT a real-device run and NOT a real HTTP call.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return {
    get router() {
      return mockRouter;
    },
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{String(href)}</Text>,
    useFocusEffect: () => {},
    useLocalSearchParams: () => ({}),
  };
});

jest.mock("../../context/AppContext", () => ({ useApp: () => ({ user: { id: "owner-1" }, logout: jest.fn() }) }));

const mockToast = jest.fn();
jest.mock("../../components/ui/Toast", () => {
  const actual = jest.requireActual("../../components/ui/Toast");
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    gymService: {
      getOnboardingStatus: jest.fn(),
      listCheckinExceptions: jest.fn(),
      decideCheckinException: jest.fn(),
      listOwnedBrands: jest.fn(),
      listOwnedPlans: jest.fn(),
      createPlan: jest.fn(),
      updatePlan: jest.fn(),
      listOwnedGyms: jest.fn(),
      getOwnedWallet: jest.fn(),
      listGymWithdrawals: jest.fn(),
      listOwnedMemberships: jest.fn(),
      getPtCommissionSummary: jest.fn(),
    },
  };
});

const svc = gymService as unknown as Record<string, jest.Mock>;

const err = (status: number, code: string, message = "msg") => ({ response: { status, data: { success: false, error: { code, message } } } });
const FUTURE = new Date(Date.now() + 6 * 3600_000).toISOString();

const OWNER_PERMS = [
  "checkin.exception.request",
  "checkin.exception.approve",
  "finance.wallet.view",
  "finance.withdrawals.view",
  "finance.withdraw",
  "finance.export",
  "plan.write",
];
const status = (role: string, permissions: string[]) => ({ role, permissions, payout: null });
const OWNER = status("OWNER", OWNER_PERMS);
const MANAGER = status("MANAGER", ["checkin.exception.request", "checkin.exception.approve", "plan.view"]);
const RECEPTIONIST = status("RECEPTIONIST", ["checkin.exception.request"]);
const ACCOUNTANT = status("ACCOUNTANT", ["finance.wallet.view", "finance.withdrawals.view", "finance.export"]);

const exRow = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  membershipId: "m1",
  status: "PENDING",
  displayName: "Nguyễn An",
  memberCode: "ABCD-1234",
  planName: "Gói tháng",
  requestReason: "Quên điện thoại và hết pin",
  requestedByName: "Lễ tân Hoa",
  createdAt: new Date().toISOString(),
  expiresAt: FUTURE,
  decisionReason: null,
  decidedByName: null,
  decidedAt: null,
  mine: false,
  ...over,
});

let client: QueryClient;
// Several rounds: the role query resolves first, the screens' own queries start after it.
const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
};
const wrap = async (ui: React.ReactElement) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  await flush();
  return view;
};
const press = async (el: any) => {
  await act(async () => {
    await fireEvent.press(el);
  });
  await flush();
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(svc).forEach((fn) => fn.mockReset());
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("front desk: approve / reject a check-in exception", () => {
  const list = (canApprove: boolean, exceptions: unknown[]) => ({ canApprove, exceptions });

  it("owner: sees Duyệt / Từ chối on someone else's open request, and not on his own, an approved or an expired one", async () => {
    svc.getOnboardingStatus.mockResolvedValue(OWNER);
    svc.listCheckinExceptions.mockResolvedValue(
      list(true, [
        exRow({ id: "e1" }),
        exRow({ id: "e2", displayName: "Của tôi", mine: true }),
        exRow({ id: "e3", displayName: "Đã duyệt", status: "APPROVED" }),
        exRow({ id: "e4", displayName: "Quá hạn", expiresAt: new Date(Date.now() - 3600_000).toISOString() }),
      ]),
    );
    const view = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    expect(view.getAllByText("Duyệt")).toHaveLength(1);
    expect(view.getAllByText("Từ chối")).toHaveLength(1);
    expect(view.getByText("Yêu cầu do bạn tạo, cần người khác duyệt.")).toBeTruthy();
  });

  it("manager: the backend grants checkin.exception.approve to the manager, so the buttons show", async () => {
    svc.getOnboardingStatus.mockResolvedValue(MANAGER);
    svc.listCheckinExceptions.mockResolvedValue(list(true, [exRow()]));
    const view = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    expect(view.getByText("Duyệt")).toBeTruthy();
    expect(view.getByText("Từ chối")).toBeTruthy();
  });

  it("receptionist: read-only (no permission, server says canApprove=false)", async () => {
    svc.getOnboardingStatus.mockResolvedValue(RECEPTIONIST);
    svc.listCheckinExceptions.mockResolvedValue(list(false, [exRow({ mine: true })]));
    const view = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    expect(view.getByText("Yêu cầu ngoại lệ của bạn")).toBeTruthy();
    expect(view.queryByText("Duyệt")).toBeNull();
    expect(view.queryByText("Từ chối")).toBeNull();
  });

  it("fail-closed: permissions[] missing (old server) or role unknown -> no buttons even if the list says canApprove", async () => {
    svc.listCheckinExceptions.mockResolvedValue(list(true, [exRow()]));
    svc.getOnboardingStatus.mockResolvedValue({ role: "OWNER" });
    const a = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    expect(a.queryByText("Duyệt")).toBeNull();
    await a.unmount();
    svc.getOnboardingStatus.mockResolvedValue(null);
    const b = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    expect(b.queryByText("Duyệt")).toBeNull();
  });

  it("approve: confirmation names member + branch, a reason is required, a double tap sends ONE request, list + badge refresh, success toast", async () => {
    svc.getOnboardingStatus.mockResolvedValue(OWNER);
    svc.listCheckinExceptions.mockResolvedValue(list(true, [exRow()]));
    let finish!: (v: unknown) => void;
    svc.decideCheckinException.mockImplementation(() => new Promise((r) => (finish = r)));
    const view = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    const invalidate = jest.spyOn(client, "invalidateQueries");

    await press(view.getByText("Duyệt"));
    expect(view.getByText("Duyệt ngoại lệ check-in cho Nguyễn An tại Q1")).toBeTruthy();
    // no reason yet -> cannot confirm
    await press(view.getByText("Xác nhận duyệt"));
    expect(svc.decideCheckinException).not.toHaveBeenCalled();
    // too short -> still no
    await fireEvent.changeText(view.getByLabelText("Lý do duyệt hoặc từ chối"), "abc");
    await press(view.getByText("Xác nhận duyệt"));
    expect(svc.decideCheckinException).not.toHaveBeenCalled();

    await fireEvent.changeText(view.getByLabelText("Lý do duyệt hoặc từ chối"), "  Đã đối chiếu ảnh hồ sơ  ");
    const confirm = view.getByText("Xác nhận duyệt");
    await act(async () => {
      await fireEvent.press(confirm);
      await fireEvent.press(confirm); // double tap
    });
    expect(svc.decideCheckinException).toHaveBeenCalledTimes(1);
    expect(svc.decideCheckinException).toHaveBeenCalledWith("g1", "e1", "approve", "Đã đối chiếu ảnh hồ sơ");

    await act(async () => {
      finish({ id: "e1", status: "APPROVED" });
    });
    await flush();
    expect(mockToast).toHaveBeenCalledWith("Đã duyệt ngoại lệ", "success");
    const keys = invalidate.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown[] }).queryKey));
    expect(keys).toContain(JSON.stringify(["frontdesk-exceptions", "owner-1", "g1"]));
    expect(keys).toContain(JSON.stringify(["frontdesk-pending-exception-count", "owner-1"]));
    expect(svc.decideCheckinException).toHaveBeenCalledTimes(1);
  });

  it("reject sends the reject verb", async () => {
    svc.getOnboardingStatus.mockResolvedValue(OWNER);
    svc.listCheckinExceptions.mockResolvedValue(list(true, [exRow()]));
    svc.decideCheckinException.mockResolvedValue({ id: "e1", status: "REJECTED" });
    const view = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    await press(view.getByText("Từ chối"));
    await fireEvent.changeText(view.getByLabelText("Lý do duyệt hoặc từ chối"), "Ảnh không khớp người trước mặt");
    await press(view.getByText("Xác nhận từ chối"));
    expect(svc.decideCheckinException).toHaveBeenCalledWith("g1", "e1", "reject", "Ảnh không khớp người trước mặt");
    expect(mockToast).toHaveBeenCalledWith("Đã từ chối ngoại lệ", "success");
  });

  it("a refusal is written INSIDE the sheet in plain Vietnamese (never the code), the list reloads when stale", async () => {
    svc.getOnboardingStatus.mockResolvedValue(OWNER);
    svc.listCheckinExceptions.mockResolvedValue(list(true, [exRow()]));
    svc.decideCheckinException.mockRejectedValue(err(409, "EXCEPTION_ALREADY_DECIDED"));
    const view = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    const listCallsBefore = svc.listCheckinExceptions.mock.calls.length;
    await press(view.getByText("Duyệt"));
    await fireEvent.changeText(view.getByLabelText("Lý do duyệt hoặc từ chối"), "Đã xác minh qua ảnh");
    await press(view.getByText("Xác nhận duyệt"));
    const box = view.getByTestId("exception-decision-refusal");
    expect(box).toBeTruthy();
    expect(view.getByText(/vừa được người khác xử lý/)).toBeTruthy();
    expect(view.queryByText(/EXCEPTION_ALREADY_DECIDED/)).toBeNull();
    expect(mockToast).not.toHaveBeenCalled(); // a root toast would be hidden under the sheet
    expect(svc.listCheckinExceptions.mock.calls.length).toBeGreaterThan(listCallsBefore); // stale list reloaded
    // the answer will not change -> the only action left is closing
    expect(view.queryByText("Xác nhận duyệt")).toBeNull();
    expect(view.getByText("Đóng")).toBeTruthy();
  });

  it("a refusal that can be retried (reason rejected by the server) keeps the confirm button", async () => {
    svc.getOnboardingStatus.mockResolvedValue(OWNER);
    svc.listCheckinExceptions.mockResolvedValue(list(true, [exRow()]));
    svc.decideCheckinException.mockRejectedValueOnce(err(400, "REASON_REQUIRED"));
    const view = await wrap(<CheckinExceptionsPanel gymId="g1" gymName="Q1" />);
    await press(view.getByText("Duyệt"));
    await fireEvent.changeText(view.getByLabelText("Lý do duyệt hoặc từ chối"), "đủ năm ký tự");
    await press(view.getByText("Xác nhận duyệt"));
    expect(view.getByTestId("exception-decision-refusal")).toBeTruthy();
    expect(view.getByText("Xác nhận duyệt")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("create-plan sheet: a refusal is shown inside the sheet", () => {
  it("shows the server message in the sheet (InlineRefusal) and raises no root toast", async () => {
    svc.getOnboardingStatus.mockResolvedValue(OWNER);
    svc.listOwnedBrands.mockResolvedValue([{ id: "b1", name: "Gymini Gym", approvedName: "Gymini Gym" }]);
    svc.listOwnedPlans.mockResolvedValue([]);
    svc.createPlan.mockRejectedValue(err(400, "VALIDATION_ERROR", "Tên gói đã tồn tại"));
    const view = await wrap(<GymOwnerPlansScreen />);
    await press(view.getByText("Gói mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Gói tháng"), "Gói tháng");
    await fireEvent.changeText(view.getByPlaceholderText("500000"), "500000");
    await press(view.getByText("Tạo gói"));
    expect(svc.createPlan).toHaveBeenCalledTimes(1);
    expect(view.getByTestId("plan-create-refusal")).toBeTruthy();
    expect(view.getByText("Tên gói đã tồn tại")).toBeTruthy();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("a network failure (no response) still says something readable inside the sheet", async () => {
    svc.getOnboardingStatus.mockResolvedValue(OWNER);
    svc.listOwnedBrands.mockResolvedValue([{ id: "b1", name: "Gymini Gym" }]);
    svc.listOwnedPlans.mockResolvedValue([]);
    svc.createPlan.mockRejectedValue(new Error("Network Error"));
    const view = await wrap(<GymOwnerPlansScreen />);
    await press(view.getByText("Gói mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Gói tháng"), "Gói tháng");
    await fireEvent.changeText(view.getByPlaceholderText("500000"), "500000");
    await press(view.getByText("Tạo gói"));
    expect(view.getByText("Không tạo được gói. Vui lòng thử lại.")).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("Ví merged into Tài chính", () => {
  const GYM = { id: "g1", name: "Q1", status: "APPROVED", brandId: "b1" };
  const setupFinance = (st: unknown) => {
    svc.getOnboardingStatus.mockResolvedValue(st);
    svc.listOwnedGyms.mockResolvedValue([GYM]);
    svc.listOwnedMemberships.mockResolvedValue([]);
    svc.getOwnedWallet.mockResolvedValue({ availableBalance: 0, withdrawable: 0, pendingBalance: 0 });
    svc.listGymWithdrawals.mockResolvedValue([]);
    svc.listOwnedPlans.mockResolvedValue([]);
    svc.getPtCommissionSummary.mockResolvedValue({});
  };

  it("owner: Tài chính has a 'Ví & rút tiền' entry that opens the (hidden) wallet route", async () => {
    setupFinance(OWNER);
    const view = await wrap(<FinanceScreen />);
    await waitFor(() => expect(view.getByText("Ví & rút tiền")).toBeTruthy());
    await press(view.getByLabelText("Mở Ví và yêu cầu rút tiền"));
    expect(mockRouter.push).toHaveBeenCalledWith("/gym-owner/wallet", undefined);
  });

  it("accountant: keeps the read-only numbers in Tài chính but gets NO wallet / withdraw entry", async () => {
    setupFinance(ACCOUNTANT);
    const view = await wrap(<FinanceScreen />);
    await waitFor(() => expect(view.getByText("Lịch sử rút tiền")).toBeTruthy());
    expect(view.queryByText("Ví & rút tiền")).toBeNull();
  });

  it("owner without permissions[] (old server): no entry (fail-closed)", async () => {
    setupFinance({ role: "OWNER" });
    const view = await wrap(<FinanceScreen />);
    await waitFor(() => expect(view.getByText("Lịch sử rút tiền")).toBeTruthy());
    expect(view.queryByText("Ví & rút tiền")).toBeNull();
  });

  it("old route /gym-owner/wallet: the owner still sees the wallet (balance + withdraw button)", async () => {
    svc.getOnboardingStatus.mockResolvedValue(OWNER);
    svc.listOwnedGyms.mockResolvedValue([GYM]);
    svc.getOwnedWallet.mockResolvedValue({ availableBalance: 500000, withdrawable: 500000, pendingBalance: 0 });
    svc.listGymWithdrawals.mockResolvedValue([{ id: "w1", amount: 100000, status: "REJECTED", rejectionReason: "Sai tài khoản", createdAt: "2026-11-01T00:00:00.000Z" }]);
    const view = await wrap(<GymOwnerWalletScreen />);
    await waitFor(() => expect(view.getByText("Yêu cầu rút tiền")).toBeTruthy());
    expect(view.getByText("Có thể rút")).toBeTruthy();
    expect(view.getByTestId("gym-withdrawal-rejection-reason")).toBeTruthy();
    expect(view.queryByTestId("redirect")).toBeNull();
  });

  it("old route /gym-owner/wallet: a manager / receptionist is redirected to their own home, and no wallet call is made", async () => {
    svc.listOwnedGyms.mockResolvedValue([GYM]);
    svc.getOnboardingStatus.mockResolvedValue(MANAGER);
    const a = await wrap(<GymOwnerWalletScreen />);
    await waitFor(() => expect(a.getByTestId("redirect")).toBeTruthy());
    expect(a.getByTestId("redirect").props.children).toBe("/gym-owner/dashboard");
    expect(svc.getOwnedWallet).not.toHaveBeenCalled();
    await a.unmount();
    svc.getOnboardingStatus.mockResolvedValue(RECEPTIONIST);
    const b = await wrap(<GymOwnerWalletScreen />);
    await waitFor(() => expect(b.getByTestId("redirect")).toBeTruthy());
    expect(b.getByTestId("redirect").props.children).toBe("/gym-owner/front-desk");
    expect(svc.getOwnedWallet).not.toHaveBeenCalled();
  });
});
