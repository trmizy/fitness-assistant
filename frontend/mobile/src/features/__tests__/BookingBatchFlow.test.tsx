import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { router } from "expo-router";
import BookingScreen from "../../../app/client/services/booking";
import { availabilityService, contractService, sessionService } from "../../services/api";

configure({ asyncUtilTimeout: 10_000 });
jest.setTimeout(40_000);

/**
 * The "Đặt buổi tập mới" sheet: line up slots on different days, review them, send ONE batch request; per-slot refusals are
 * shown under the slot. Evidence label: TEST FIXTURE (jest-expo component test, API wrappers mocked) - not a device run.
 */

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
}));

// The call button pulls in push-notification native modules that have nothing to do with booking.
jest.mock("../call/JoinSessionButton", () => ({ JoinSessionButton: () => null }));

const mockToast = jest.fn();
jest.mock("../../components/ui/Toast", () => {
  const actual = jest.requireActual("../../components/ui/Toast");
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    contractService: { ...actual.contractService, getByClient: jest.fn() },
    availabilityService: { ...actual.availabilityService, getAvailability: jest.fn(), getBookableSlots: jest.fn() },
    sessionService: {
      ...actual.sessionService,
      getMyUpcoming: jest.fn(),
      listPendingConfirmation: jest.fn(),
      getContractSessions: jest.fn(),
      getRescheduleHistory: jest.fn(),
      bookSession: jest.fn(),
      bookSessionsBatch: jest.fn(),
    },
  };
});

const m = {
  contracts: contractService.getByClient as jest.Mock,
  availability: availabilityService.getAvailability as jest.Mock,
  slots: availabilityService.getBookableSlots as jest.Mock,
  upcoming: sessionService.getMyUpcoming as jest.Mock,
  pending: sessionService.listPendingConfirmation as jest.Mock,
  history: sessionService.getContractSessions as jest.Mock,
  book: sessionService.bookSession as jest.Mock,
  batch: sessionService.bookSessionsBatch as jest.Mock,
};

const WEEK = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

beforeEach(() => {
  jest.clearAllMocks();
  m.contracts.mockResolvedValue([
    {
      id: "c1", ptUserId: "pt1", status: "ACTIVE", packageName: "Gói 10 buổi", totalSessions: 10, usedSessions: 0,
      sessionMode: "ONLINE", endDate: null, ptProfile: { firstName: "An", lastName: "PT" },
    },
  ]);
  m.availability.mockResolvedValue(WEEK.map((dayOfWeek) => ({ dayOfWeek, isActive: true, startTime: "06:00", endTime: "20:00" })));
  m.slots.mockResolvedValue(["07:00", "09:00"]);
  m.upcoming.mockResolvedValue([]);
  m.pending.mockResolvedValue([]);
  m.history.mockResolvedValue([]);
});

async function press(el: any) {
  await act(async () => {
    fireEvent.press(el);
  });
}

async function openSheetAndPickTwoDays() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const view = await render(
    <QueryClientProvider client={qc}>
      <BookingScreen />
    </QueryClientProvider>,
  );
  await press(await view.findByText("Đặt buổi tập mới"));
  // Days with free slots are labelled "…, còn khung giờ trống" once their slot lists have loaded.
  const days = await view.findAllByLabelText(/còn khung giờ trống/);
  expect(days.length).toBeGreaterThan(2);
  await press(days[0]);
  await press(await view.findByText("07:00"));
  await press(view.getByText(/^Thêm vào danh sách/));
  const days2 = await view.findAllByLabelText(/còn khung giờ trống/);
  await press(days2[1]);
  await press(await view.findByText("09:00"));
  return view;
}

describe("booking several slots at once", () => {
  it("lines up slots on two days, shows the summary and sends ONE batch request", async () => {
    m.batch.mockResolvedValue({ sessions: [{}, {}] });
    const view = await openSheetAndPickTwoDays();
    // The still-selected 09:00 is included automatically when going to the summary.
    await press(view.getByText(/^Xem lại và đặt 2 buổi/));
    expect(await view.findByText("Bạn sắp gửi 2 yêu cầu đặt buổi:")).toBeTruthy();
    await press(view.getByText("Đặt 2 buổi"));
    await waitFor(() => expect(m.batch).toHaveBeenCalledTimes(1));
    const [contractId, payload] = m.batch.mock.calls[0];
    expect(contractId).toBe("c1");
    expect(payload.slots).toHaveLength(2);
    expect(payload.slots[0].scheduledTime).toBe("07:00");
    expect(payload.slots[1].scheduledTime).toBe("09:00");
    expect(payload.slots[0].scheduledDate).not.toBe(payload.slots[1].scheduledDate);
    expect(payload.sessionMode).toBe("ONLINE");
    expect(m.book).not.toHaveBeenCalled();
  });

  it("a refused batch keeps the summary open and shows the server's reason under the slot", async () => {
    const view = await openSheetAndPickTwoDays();
    await press(view.getByText(/^Xem lại và đặt 2 buổi/));
    await view.findByText("Bạn sắp gửi 2 yêu cầu đặt buổi:");
    m.batch.mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: "Chưa đặt được: 1/2 khung giờ không hợp lệ.",
          slotErrors: [],
        },
      },
    });
    // Make the refusal concern the first slot: read its date from the request the screen is about to send.
    m.batch.mockImplementation(async (_id: string, payload: any) => {
      const first = payload.slots[0];
      throw {
        response: {
          status: 409,
          data: {
            error: "Chưa đặt được: 1/2 khung giờ không hợp lệ.",
            slotErrors: [
              { index: 0, scheduledDate: first.scheduledDate, scheduledTime: first.scheduledTime, error: "Mỗi ngày bạn chỉ được đặt tối đa 2 buổi tập" },
            ],
          },
        },
      };
    });
    await press(view.getByText("Đặt 2 buổi"));
    expect(await view.findByText("Mỗi ngày bạn chỉ được đặt tối đa 2 buổi tập")).toBeTruthy();
    expect(view.getByText(/Chưa có buổi nào được tạo/)).toBeTruthy();
    expect(mockToast).toHaveBeenCalledWith("Chưa đặt được: 1/2 khung giờ không hợp lệ.", "danger");
  });

  it("R2-02: a 3rd slot on a day that already has 2 is refused visibly, not counted, and the CTA still goes on with the 2 added", async () => {
    m.slots.mockResolvedValue(["07:00", "09:00", "11:00"]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const view = await render(
      <QueryClientProvider client={qc}>
        <BookingScreen />
      </QueryClientProvider>,
    );
    await press(await view.findByText("Đặt buổi tập mới"));
    const days = await view.findAllByLabelText(/còn khung giờ trống/);
    await press(days[0]);
    await press(await view.findByText("07:00"));
    await press(view.getByText(/^Thêm vào danh sách/));
    await press((await view.findAllByLabelText(/còn khung giờ trống/))[0]);
    await press(await view.findByText("09:00"));
    await press(view.getByText(/^Thêm vào danh sách/));
    await press((await view.findAllByLabelText(/còn khung giờ trống/))[0]);
    await press(await view.findByText("11:00"));
    // The refused 11:00 is not counted, and its reason is on screen next to the button.
    expect(await view.findByText(/Khung giờ vừa chọn không được thêm: Mỗi ngày chỉ đặt tối đa 2 buổi/)).toBeTruthy();
    expect(view.getByTestId("batch-pick-error")).toBeTruthy();
    await press(view.getByText(/^Xem lại và đặt 2 buổi/));
    expect(await view.findByText("Bạn sắp gửi 2 yêu cầu đặt buổi:")).toBeTruthy();
  });

  it("one slot still uses the single booking request", async () => {
    m.book.mockResolvedValue({ id: "s1" });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const view = await render(
      <QueryClientProvider client={qc}>
        <BookingScreen />
      </QueryClientProvider>,
    );
    await press(await view.findByText("Đặt buổi tập mới"));
    const days = await view.findAllByLabelText(/còn khung giờ trống/);
    await press(days[0]);
    await press(await view.findByText("07:00"));
    const bookButtons = view.getAllByText("Đặt buổi tập"); // sheet title + button
    await press(bookButtons[bookButtons.length - 1]);
    await waitFor(() => expect(m.book).toHaveBeenCalledTimes(1));
    expect(m.book.mock.calls[0][1]).toMatchObject({ scheduledTime: "07:00" });
    expect(m.batch).not.toHaveBeenCalled();
  });

  it("a booking refused for no membership that day shows the reason + a renewal button that opens that gym's plans", async () => {
    m.book.mockRejectedValue({
      response: {
        status: 422,
        data: {
          error: "Gói hội viên của bạn không có hiệu lực vào ngày 25/12 nên không thể đặt buổi.",
          code: "SESSION_NOT_COVERED_BY_MEMBERSHIP",
          details: { gymId: "gym-7", date: "2026-12-25T01:00:00.000Z", membershipEndsAt: "2026-12-01T00:00:00.000Z" },
        },
      },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const view = await render(
      <QueryClientProvider client={qc}>
        <BookingScreen />
      </QueryClientProvider>,
    );
    await press(await view.findByText("Đặt buổi tập mới"));
    const days = await view.findAllByLabelText(/còn khung giờ trống/);
    await press(days[0]);
    await press(await view.findByText("07:00"));
    const bookButtons = view.getAllByText("Đặt buổi tập");
    await press(bookButtons[bookButtons.length - 1]);
    expect(await view.findByText(/không có hiệu lực vào ngày 25\/12/)).toBeTruthy();
    await press(view.getByText("Gia hạn gói hội viên"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/client/services/gyms/[id]", params: { id: "gym-7" } });
  });
});
