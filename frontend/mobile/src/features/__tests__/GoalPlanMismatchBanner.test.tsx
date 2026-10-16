import { act, fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";

import { GoalPlanMismatchBanner } from "../nutrition/MealPlanParts";
import type { NutritionGoalPlanConsistency } from "../../services/api";

/**
 * 14B.3 (PG-A4) — web's goal↔plan mismatch banner. The dev account's plan matches its goal (the
 * server says MATCHED), and producing a mismatch would mean changing a real NutritionGoal, so the
 * banner is pinned here against the server's own response shape.
 */

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

const state = (status: NutritionGoalPlanConsistency["status"]): NutritionGoalPlanConsistency =>
  ({
    status,
    activeGoal: null,
    activeProgram: null,
    mismatches: [
      { field: "calories", planValue: 2000, goalValue: 1800 },
      { field: "protein", planValue: 150, goalValue: 160 },
    ],
    recommendedAction: "",
  }) as unknown as NutritionGoalPlanConsistency;

describe("GoalPlanMismatchBanner", () => {
  it("hidden while the plan matches the goal", async () => {
    const view = await render(<GoalPlanMismatchBanner state={state("MATCHED")} onKeep={jest.fn()} />);
    expect(view.queryByText(/Thực đơn hiện tại/)).toBeNull();
  });

  it("macro mismatch: says so, lists plan → goal per field, offers both actions", async () => {
    const onKeep = jest.fn();
    const view = await render(<GoalPlanMismatchBanner state={state("MACRO_MISMATCH")} onKeep={onKeep} />);
    expect(view.getByText("Bạn đã đổi mục tiêu dinh dưỡng. Thực đơn hiện tại có thể vẫn theo mục tiêu cũ.")).toBeTruthy();
    expect(view.getByText("Calo")).toBeTruthy();
    expect(view.getByText("2000 → 1800")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("Vẫn giữ thực đơn này"));
    });
    expect(onKeep).toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(view.getByText("Tạo lại thực đơn"));
    });
    expect(router.push).toHaveBeenCalledWith("/client/ai-coach");
  });

  it("stale goal wording", async () => {
    const view = await render(<GoalPlanMismatchBanner state={state("STALE_GOAL_CHANGED")} onKeep={jest.fn()} />);
    expect(view.getByText("Mục tiêu dinh dưỡng đã đổi kể từ khi thực đơn này được tạo.")).toBeTruthy();
  });
});
