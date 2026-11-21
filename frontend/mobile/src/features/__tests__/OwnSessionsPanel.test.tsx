import { act, configure, fireEvent, render } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SlotCalendarPicker } from "../services/SlotCalendarPicker";
import { availabilityService } from "../../services/api";

configure({ asyncUtilTimeout: 10_000 });
jest.setTimeout(40_000);

/**
 * The client's own sessions on the chosen day are listed above the free slots ("Buổi của bạn trong ngày này").
 * Evidence label: TEST FIXTURE (jest-expo component test, API wrappers mocked) - not a device run.
 */
jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    availabilityService: { ...actual.availabilityService, getAvailability: jest.fn(), getBookableSlots: jest.fn() },
  };
});

const day = new Date();
day.setDate(day.getDate() + 3);
const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
const at = (h: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).toISOString();

function renderPicker(props: Record<string, unknown>) {
  (availabilityService.getAvailability as jest.Mock).mockResolvedValue([]);
  (availabilityService.getBookableSlots as jest.Mock).mockResolvedValue(["10:00"]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SlotCalendarPicker ptUserId="pt1" leadHours={24} date={key} time={null} onChange={() => {}} emptyDayText="trống" {...(props as any)} />
    </QueryClientProvider>,
  );
}

describe("own sessions on the chosen day", () => {
  it("lists the session with time range, status and PT name, and opens it on tap", async () => {
    const onOpen = jest.fn();
    const view = await renderPicker({
      ownSessions: [
        { id: "s1", status: "REQUESTED", startAt: at(9), endAt: at(10), ptName: "An PT" },
        { id: "s2", status: "CANCELLED", startAt: at(11), endAt: at(12) },
      ],
      onOpenSession: onOpen,
    });
    expect(await view.findByText("Buổi của bạn trong ngày này")).toBeTruthy();
    expect(view.getByText("09:00–10:00")).toBeTruthy();
    expect(view.getByText(/Chờ PT xác nhận · An PT/)).toBeTruthy();
    expect(view.queryByText("11:00–12:00")).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByText("09:00–10:00"));
    });
    expect(onOpen).toHaveBeenCalledWith("s1");
  });

  it("shows no panel when the client has nothing that day", async () => {
    const view = await renderPicker({ ownSessions: [] });
    await view.findByText(/Khung giờ trống/);
    expect(view.queryByText("Buổi của bạn trong ngày này")).toBeNull();
  });
});
