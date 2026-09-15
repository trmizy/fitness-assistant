import type { ReactElement } from "react";
import { Text } from "react-native";
import { act, render, type RenderResult } from "@testing-library/react-native";

import { ToastProvider, useToast } from "../Toast";
import { toastDuration } from "../../../theme/motion";

/**
 * The toast has exactly two behaviours worth protecting: it disappears on its own after a fixed
 * time, and a second toast REPLACES the first rather than queueing behind it, with the clock
 * restarting. Both are easy to break by accident — a stale timer left running is the classic
 * version, and it cuts the NEW toast short.
 *
 * Everything is awaited because @testing-library/react-native 14 renders and commits
 * asynchronously; without that, assertions run before React has re-rendered and every query comes
 * back empty.
 */

function Trigger({ label = "Đã lưu" }: { label?: string }) {
  const toast = useToast();
  return <Text onPress={() => toast.show(label)}>fire</Text>;
}

function renderToast(ui: ReactElement): Promise<RenderResult> {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Presses a Text by its content and lets the resulting update flush. */
async function press(view: RenderResult, label: string) {
  await act(async () => {
    view.getByText(label).props.onPress();
  });
}

/** Advances fake timers and flushes whatever state change that caused. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe("Toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows nothing until something asks for a toast", async () => {
    const view = await renderToast(<Trigger />);
    expect(view.queryByText("Đã lưu")).toBeNull();
  });

  it("shows the message, then auto-dismisses after the design's duration", async () => {
    const view = await renderToast(<Trigger />);

    await press(view, "fire");
    expect(view.getByText("Đã lưu")).toBeTruthy();

    // One tick short of the deadline it must still be there — otherwise a regression that halves
    // the duration would still pass a naive "advance well past it" assertion.
    await advance(toastDuration - 1);
    expect(view.queryByText("Đã lưu")).toBeTruthy();

    await advance(1);
    expect(view.queryByText("Đã lưu")).toBeNull();
  });

  it("a second toast replaces the first and restarts the clock", async () => {
    function TwoTriggers() {
      const toast = useToast();
      return (
        <>
          <Text onPress={() => toast.show("Đầu tiên")}>first</Text>
          <Text onPress={() => toast.show("Thứ hai")}>second</Text>
        </>
      );
    }

    const view = await renderToast(<TwoTriggers />);

    await press(view, "first");

    // Most of the first toast's life has elapsed...
    await advance(toastDuration - 200);

    await press(view, "second");
    expect(view.queryByText("Đầu tiên")).toBeNull();
    expect(view.getByText("Thứ hai")).toBeTruthy();

    // ...and the first toast's leftover timer must NOT cut the second one short.
    await advance(300);
    expect(view.queryByText("Thứ hai")).toBeTruthy();

    await advance(toastDuration);
    expect(view.queryByText("Thứ hai")).toBeNull();
  });

  it("hide() dismisses immediately", async () => {
    function HideTrigger() {
      const toast = useToast();
      return (
        <>
          <Text onPress={() => toast.show("Tạm thời")}>show</Text>
          <Text onPress={() => toast.hide()}>hide</Text>
        </>
      );
    }

    const view = await renderToast(<HideTrigger />);

    await press(view, "show");
    expect(view.getByText("Tạm thời")).toBeTruthy();

    await press(view, "hide");
    expect(view.queryByText("Tạm thời")).toBeNull();
  });
});
