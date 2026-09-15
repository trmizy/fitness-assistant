import { Text } from "react-native";
import { act, render, type RenderResult } from "@testing-library/react-native";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { State } from "react-native-gesture-handler";

import { BottomSheet } from "../BottomSheet";
import { sheetDismissThreshold } from "../../../theme/motion";

/**
 * What matters about the sheet is the DECISION it makes when a drag ends: released past the
 * threshold it dismisses, released short of it it springs back and stays open. Getting that
 * boundary wrong is the difference between a sheet that closes when the user only meant to scroll
 * and one that traps them.
 *
 * Gestures are driven through gesture-handler's own Jest utilities, which feed the handler the same
 * event stream a real drag produces, so the component's actual `onUpdate`/`onEnd` run.
 */

async function renderSheet(onClose: () => void): Promise<RenderResult> {
  return render(
    <BottomSheet open onClose={onClose} title="Tiêu đề">
      <Text>nội dung</Text>
    </BottomSheet>,
  );
}

/** Feeds a downward drag of `distance` px and releases. */
async function dragDownAndRelease(distance: number) {
  await act(async () => {
    fireGestureHandler(getByGestureTestId("sheet-drag"), [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: distance / 2 },
      { translationY: distance },
      { state: State.END, translationY: distance },
    ]);
  });
}

describe("BottomSheet drag threshold", () => {
  it("renders its title and content while open", async () => {
    const view = await renderSheet(() => {});
    expect(view.getByText("Tiêu đề")).toBeTruthy();
    expect(view.getByText("nội dung")).toBeTruthy();
  });

  it("renders nothing while closed", async () => {
    const view = await render(
      <BottomSheet open={false} onClose={() => {}} title="Tiêu đề">
        <Text>nội dung</Text>
      </BottomSheet>,
    );
    expect(view.queryByText("nội dung")).toBeNull();
  });

  it("dismisses when released past the threshold", async () => {
    const onClose = jest.fn();
    await renderSheet(onClose);

    await dragDownAndRelease(sheetDismissThreshold + 20);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when released short of the threshold", async () => {
    const onClose = jest.fn();
    await renderSheet(onClose);

    // Deliberately just BELOW the boundary: an off-by-one here is exactly the bug this guards.
    await dragDownAndRelease(sheetDismissThreshold - 1);

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open for a drag exactly at the threshold", async () => {
    // The reference dismisses on `> threshold`, not `>=` — equal must not close.
    const onClose = jest.fn();
    await renderSheet(onClose);

    await dragDownAndRelease(sheetDismissThreshold);

    expect(onClose).not.toHaveBeenCalled();
  });
});
