import { AppState, Text } from "react-native";
import { act, render } from "@testing-library/react-native";

import { useCalendarDay } from "../useCalendarDay";

/**
 * Regression (real phone, 8/10): Trang chủ read the date once when its tab mounted, so an app
 * left open past midnight kept showing yesterday's numbers under "hôm nay".
 */

let focusCallback: (() => void) | undefined;
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void) => {
    focusCallback = cb;
  },
}));

function Probe() {
  const { dayKey } = useCalendarDay();
  return <Text>{dayKey}</Text>;
}

describe("useCalendarDay", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("moves to the new day when the screen is focused again after midnight", async () => {
    jest.setSystemTime(new Date(2026, 9, 7, 23, 50));
    const view = await render(<Probe />);
    expect(view.getByText("2026-10-07")).toBeTruthy();

    jest.setSystemTime(new Date(2026, 9, 8, 0, 5));
    await act(async () => focusCallback?.());
    expect(view.getByText("2026-10-08")).toBeTruthy();
  });

  it("moves to the new day by itself when midnight passes with the screen open", async () => {
    jest.setSystemTime(new Date(2026, 9, 8, 23, 55));
    const view = await render(<Probe />);
    expect(view.getByText("2026-10-08")).toBeTruthy();

    // No focus change, no app-state change — only the clock.
    await act(async () => {
      jest.advanceTimersByTime(6 * 60 * 1000);
    });
    expect(view.getByText("2026-10-09")).toBeTruthy();

    // And it is armed again for the night after.
    await act(async () => {
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(view.getByText("2026-10-10")).toBeTruthy();
  });

  it("moves to the new day when the app returns to the foreground", async () => {
    let onChange: ((state: string) => void) | undefined;
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((_type: string, handler: (state: string) => void) => {
      onChange = handler;
      return { remove: jest.fn() };
    }) as never);

    jest.setSystemTime(new Date(2026, 9, 7, 22, 0));
    const view = await render(<Probe />);
    jest.setSystemTime(new Date(2026, 9, 8, 7, 30));
    await act(async () => onChange?.("active"));
    expect(view.getByText("2026-10-08")).toBeTruthy();
    spy.mockRestore();
  });
});
