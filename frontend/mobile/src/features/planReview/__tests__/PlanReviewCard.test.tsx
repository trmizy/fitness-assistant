import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PlanReviewCard } from "../PlanReviewCard";
import { planReviewApi } from "../planReviewApi";
import { contractService } from "../../../services/api";

/**
 * COMPONENT TEST (jest-expo, TEST FIXTURE): the card's real logic + rendering run; only the network layer (planReviewApi,
 * contractService) is replaced. This is NOT an emulator/device E2E — no Android SDK/device exists on this machine.
 * Focus: the guarantees the user cares about — nothing is announced as sent until the server confirms, a double tap sends once with
 * one idempotency key, errors are readable, an outdated approval is never shown as plain "approved".
 */
const mockToast = { show: jest.fn() };
jest.mock("../../../components/ui", () => {
  const actual = jest.requireActual("../../../components/ui");
  return { ...actual, useToast: () => mockToast };
});
jest.mock("../../../context/AppContext", () => ({ useApp: () => ({ user: { id: "client-1" } }) }));
jest.mock("../../../theme/workspace", () => ({ useWorkspaceAccent: () => ({ primary: "#22C55E" }) }));
jest.mock("../planReviewApi", () => ({ planReviewApi: { mine: jest.fn(), submit: jest.fn(), cancel: jest.fn() } }));
jest.mock("../../../services/api", () => ({ contractService: { getByClient: jest.fn() } }));

const api = planReviewApi as unknown as Record<"mine" | "submit" | "cancel", jest.Mock>;
const contracts = contractService.getByClient as jest.Mock;
const PT = [{ ptUserId: "pt-1", ptProfile: { firstName: "Minh", lastName: "Trần" } }];

const item = (over: Record<string, unknown> = {}) => ({
  id: "r1", subjectId: "p1", subjectVersion: 1, contentHash: "h", status: "PENDING_REVIEW", revision: 1, clientNote: null, decisionNote: null,
  decidedAt: null, submittedAt: "2026-11-20T00:00:00Z", effectiveState: "OPEN", isOutdated: false, ...over,
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
async function mount(props: Partial<React.ComponentProps<typeof PlanReviewCard>> = {}) {
  const view = render(
    <QueryClientProvider client={newClient()}>
      <PlanReviewCard programId="p1" programName="Kế hoạch A" programVersion={3} {...props} />
    </QueryClientProvider>,
  );
  return view;
}

/**
 * Every tap goes through an AWAITED act scope. A bare `fireEvent.press(...)` left un-awaited lets the next tap (or the next
 * test) open a new act scope before the previous async one has closed; RNTL then reports overlapping act() calls and the
 * failure cascades into every later test of the file.
 */
async function press(...els: Parameters<typeof fireEvent.press>[0][]) {
  await act(async () => {
    for (const el of els) fireEvent.press(el);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  contracts.mockResolvedValue(PT);
  api.mine.mockResolvedValue([]);
});

describe("PlanReviewCard", () => {
  it("renders nothing without an ACTIVE PT contract", async () => {
    contracts.mockResolvedValue([]);
    const view = await mount();
    await waitFor(() => expect(contracts).toHaveBeenCalled());
    await waitFor(() => expect(view.queryByText("PT duyệt kế hoạch")).toBeNull());
  });

  it("offers 'Gửi PT duyệt', then a confirmation that states what is shared", async () => {
    const view = await mount();
    await press(await view.findByText("Gửi PT duyệt"));
    expect(await view.findByText(/bản sao cố định/)).toBeTruthy();
    expect(view.getByText(/không kèm\s+chỉ số InBody/)).toBeTruthy();
    expect(view.getByText(/Gửi tới: Minh Trần/)).toBeTruthy();
  });

  it("double tap on 'Xác nhận gửi' sends ONCE, bound to the version the user sees, with one idempotency key", async () => {
    let resolve!: (v: unknown) => void;
    api.submit.mockImplementation(() => new Promise((r) => (resolve = r)));
    const view = await mount();
    await press(await view.findByText("Gửi PT duyệt"));
    const confirm = await view.findByText("Xác nhận gửi");
    // Both taps are delivered inside ONE act scope, i.e. before React re-renders (isPending is still false) - this is what a
    // real double tap looks like and what the synchronous ref guard exists for.
    await press(confirm, confirm);
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    const arg = api.submit.mock.calls[0][0];
    expect(arg).toMatchObject({ ptUserId: "pt-1", expectedVersion: 3 });
    expect(arg.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(mockToast.show).not.toHaveBeenCalledWith(expect.stringMatching(/Đã gửi/), expect.anything());
    await act(async () => resolve({ request: item(), replayed: false }));
    await waitFor(() => expect(mockToast.show).toHaveBeenCalledWith("Đã gửi kế hoạch cho PT.", "success"));
  });

  it("NEVER announces success when the server did not confirm: offline error -> readable message, still on the confirm step", async () => {
    api.submit.mockRejectedValue(new Error("Network Error")); // no response => offline
    const view = await mount();
    await press(await view.findByText("Gửi PT duyệt"));
    await press(await view.findByText("Xác nhận gửi"));
    await waitFor(() => expect(mockToast.show).toHaveBeenCalled());
    const [msg, tone] = mockToast.show.mock.calls[0];
    expect(tone).toBe("danger");
    expect(msg).toMatch(/Không có kết nối mạng/);
    expect(msg).toMatch(/chưa được gửi/);
    expect(mockToast.show).not.toHaveBeenCalledWith("Đã gửi kế hoạch cho PT.", "success");
    expect(view.getByText("Xác nhận gửi")).toBeTruthy(); // can retry after reconnect
  });

  it("after a failed send, retry (reconnect) re-sends with the SAME idempotency key", async () => {
    api.submit.mockRejectedValueOnce(new Error("Network Error")).mockResolvedValueOnce({ request: item(), replayed: true });
    const view = await mount();
    await press(await view.findByText("Gửi PT duyệt"));
    await press(await view.findByText("Xác nhận gửi"));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    await press(await view.findByText("Xác nhận gửi"));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
    expect(api.submit.mock.calls[1][0].idempotencyKey).toBe(api.submit.mock.calls[0][0].idempotencyKey);
  });

  it("stale plan (409) -> readable message; contract ended (403) -> readable message; never success", async () => {
    api.submit.mockRejectedValueOnce({ response: { status: 409, data: { code: "STALE_REVISION" } } });
    const view = await mount();
    await press(await view.findByText("Gửi PT duyệt"));
    await press(await view.findByText("Xác nhận gửi"));
    await waitFor(() => expect(mockToast.show).toHaveBeenCalledWith(expect.stringMatching(/đã thay đổi/), "danger"));
    api.submit.mockRejectedValueOnce({ response: { status: 403, data: { code: "NO_ACTIVE_CONTRACT" } } });
    await press(await view.findByText("Xác nhận gửi"));
    await waitFor(() => expect(mockToast.show).toHaveBeenCalledWith(expect.stringMatching(/hợp đồng PT/), "danger"));
  });

  it("open request: only 'Huỷ yêu cầu' (no second submit)", async () => {
    api.mine.mockResolvedValue([item()]);
    const view = await mount();
    expect(await view.findByText("Đang chờ PT duyệt")).toBeTruthy();
    expect(view.getByText("Huỷ yêu cầu")).toBeTruthy();
    expect(view.queryByText("Gửi PT duyệt")).toBeNull();
  });

  it("shows the PT's feedback and offers 'Gửi lại cho PT' after changes were requested", async () => {
    api.mine.mockResolvedValue([item({ status: "CHANGES_REQUESTED", effectiveState: "CHANGES_REQUESTED", decisionNote: "Thêm bài vai" })]);
    const view = await mount();
    expect(await view.findByText("PT yêu cầu chỉnh sửa")).toBeTruthy();
    expect(view.getByText("Thêm bài vai")).toBeTruthy();
    expect(view.getByText("Gửi lại cho PT")).toBeTruthy();
  });

  it("an approval that no longer applies is NOT shown as 'PT đã duyệt'", async () => {
    api.mine.mockResolvedValue([item({ status: "APPROVED", effectiveState: "APPROVED_OUTDATED", isOutdated: true })]);
    const view = await mount();
    expect(await view.findByText(/Đã duyệt bản cũ/)).toBeTruthy();
    expect(view.queryByText("PT đã duyệt")).toBeNull();
    expect(view.getByText(/không còn áp dụng/)).toBeTruthy();
    expect(view.getByText("Gửi lại cho PT")).toBeTruthy();
  });

  it("shows a read-error message when the review state cannot be loaded (does not pretend there is none)", async () => {
    api.mine.mockRejectedValue(new Error("Network Error"));
    const view = await mount();
    expect(await view.findByText(/Không có kết nối mạng/)).toBeTruthy();
  });
});
