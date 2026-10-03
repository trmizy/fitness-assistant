import { act, fireEvent, render } from "@testing-library/react-native";

import { AgentBlock } from "../coach/AgentBlocks";
import { fitnessAgentService, type AgentChatBlock } from "../../services/api";

/**
 * WB-19 — the AI Coach plan previews web gained in eba5a74, and the "Để sau" fix. The workout
 * block is the shape ai-service really returned on 1/10 for "Tạo lịch tập 3 buổi mỗi tuần cho tôi"
 * (trimmed to two days); the nutrition one follows web's type (no LLM on the dev machine to get a
 * live one).
 */

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    fitnessAgentService: { ...actual.fitnessAgentService, confirm: jest.fn(), dismiss: jest.fn() },
  };
});

const reply = (block: Partial<AgentChatBlock>) => ({ sessionId: "s", conversationId: "c", block: block as AgentChatBlock });
const future = new Date(Date.now() + 3_600_000).toISOString();

const workout: AgentChatBlock = {
  type: "WORKOUT_PLAN_PREVIEW",
  actionId: "86f73c5d-45a4-4b96-8157-2391125aebb7",
  kind: "CREATE_WORKOUT_PLAN",
  risk: "MEDIUM",
  title: "Lịch tập do AI Coach tạo",
  goal: "WEIGHT_LOSS",
  daysPerWeek: 3,
  sessionMinutes: 60,
  expiresAt: future,
  note: "Bạn có thể yêu cầu chỉnh sửa hoặc lưu.",
  days: [
    {
      day: "Thứ 2 (Full Body A)",
      goal: "Strength — squat + press + pull pattern",
      firstDate: "2026-10-05",
      exercises: [
        { name: "Barbell Squat", sets: 4, reps: "5-7", restSeconds: 120 },
        { name: "Bench Press", sets: 4, reps: "6-8", restSeconds: 90 },
      ],
    },
    {
      day: "Thứ 4 (Full Body B)",
      goal: "Hypertrophy — hinge + incline + vertical pull",
      firstDate: "2026-10-07",
      exercises: [{ name: "Deadlift", sets: 4, reps: "5", restSeconds: 180 }],
    },
  ],
};

const nutrition: AgentChatBlock = {
  type: "NUTRITION_PLAN_PREVIEW",
  actionId: "a1",
  risk: "LOW",
  expiresAt: future,
  targetNote: "Theo mục tiêu dinh dưỡng hiện tại của bạn",
  excludedFoods: ["đậu phộng"],
  softPreferences: ["ít cay"],
  dailyCaloriesTarget: 2200,
  mealsPerDay: 3,
  proteinTargetGrams: 149.6,
  carbTargetGrams: 230.2,
  fatTargetGrams: 70,
  nutritionDays: [
    {
      dayNumber: 1,
      title: "Ngày 1",
      totalCalories: 2180,
      meals: [
        {
          mealType: "BREAKFAST",
          title: "Bữa sáng",
          calories: 600,
          protein: 40,
          carbs: 60,
          fat: 20,
          items: [{ name: "Yến mạch", quantity: 80, unit: "g", calories: 300 }],
        },
      ],
    },
  ],
};

async function press(el: any) {
  await act(async () => {
    fireEvent.press(el);
  });
}

beforeEach(() => jest.clearAllMocks());

describe("WORKOUT_PLAN_PREVIEW", () => {
  it("shows the plan summary and opens a day to its exercises", async () => {
    const view = await render(<AgentBlock block={workout} onReply={jest.fn()} />);
    expect(view.getByText("Lịch tập do AI Coach tạo")).toBeTruthy();
    expect(view.getByText("Rủi ro trung bình")).toBeTruthy();
    expect(view.getByText("3 buổi/tuần · khoảng 60 phút/buổi · Giảm mỡ")).toBeTruthy();
    expect(view.queryByText(/Barbell Squat/)).toBeNull();
    await press(view.getByText("Thứ 2 (Full Body A) — Strength — squat + press + pull pattern · từ 05/10"));
    expect(view.getByText(/Barbell Squat — 4 × 5-7 · nghỉ 120s/)).toBeTruthy();
  });

  it("'Lưu lịch tập này' confirms the same action web confirms", async () => {
    (fitnessAgentService.confirm as jest.Mock).mockResolvedValue(reply({ type: "ACTION_RESULT", message: "ok" }));
    const onReply = jest.fn();
    const view = await render(<AgentBlock block={workout} onReply={onReply} />);
    await press(view.getByText("Lưu lịch tập này"));
    expect(fitnessAgentService.confirm).toHaveBeenCalledWith(workout.actionId);
    expect(onReply).toHaveBeenCalled();
    expect(view.getByText("Đã lưu")).toBeTruthy();
  });

  it("'Bỏ qua bản này' cancels the draft on the server, then locks the card", async () => {
    (fitnessAgentService.dismiss as jest.Mock).mockResolvedValue(
      reply({ type: "ACTION_RESULT", message: "Đã bỏ qua bản nháp này — chưa lưu gì vào hệ thống." }),
    );
    const onReply = jest.fn();
    const view = await render(<AgentBlock block={workout} onReply={onReply} />);
    await press(view.getByText("Bỏ qua bản này"));
    expect(fitnessAgentService.dismiss).toHaveBeenCalledWith(workout.actionId);
    expect(fitnessAgentService.confirm).not.toHaveBeenCalled();
    expect(view.getByText("Đã bỏ qua")).toBeTruthy();
    await press(view.getByText("Lưu lịch tập này"));
    expect(fitnessAgentService.confirm).not.toHaveBeenCalled();
  });

  it("an expired draft cannot be saved", async () => {
    const view = await render(<AgentBlock block={{ ...workout, expiresAt: "2020-01-01T00:00:00Z" }} onReply={jest.fn()} />);
    expect(view.getByText("Bản nháp này đã hết hạn — hãy nhờ AI Coach tạo lại.")).toBeTruthy();
    await press(view.getByText("Lưu lịch tập này"));
    expect(fitnessAgentService.confirm).not.toHaveBeenCalled();
  });
});

describe("NUTRITION_PLAN_PREVIEW", () => {
  it("shows targets, exclusions and meals; save/skip call confirm/dismiss", async () => {
    const view = await render(<AgentBlock block={nutrition} onReply={jest.fn()} />);
    expect(view.getByText("Thực đơn do AI Coach tạo")).toBeTruthy();
    expect(view.getByText("~2200 kcal/ngày · 3 bữa/ngày · P150g C230g F70g")).toBeTruthy();
    expect(view.getByText(/Đã loại trừ: đậu phộng/)).toBeTruthy();
    expect(view.getByText(/Gợi ý cho AI \(không đảm bảo\): ít cay/)).toBeTruthy();
    await press(view.getByText("Ngày 1 — 2180 kcal"));
    expect(view.getByText(/Yến mạch — 80/)).toBeTruthy();
    (fitnessAgentService.dismiss as jest.Mock).mockResolvedValue(reply({ type: "ACTION_RESULT" }));
    await press(view.getByText("Bỏ qua bản này"));
    expect(fitnessAgentService.dismiss).toHaveBeenCalledWith("a1");
  });
});

describe("ACTION_CONFIRMATION — 'Để sau' (web L1 fix)", () => {
  it("postpones locally: never claims 'Đã xác nhận', confirm stays available", async () => {
    const block: AgentChatBlock = { type: "ACTION_CONFIRMATION", actionId: "x1", kind: "LOG_WORKOUT", expiresAt: future };
    const view = await render(<AgentBlock block={block} onReply={jest.fn()} />);
    await press(view.getByText("Để sau"));
    expect(view.queryByText("Đã xác nhận")).toBeNull();
    expect(view.getByText("Đã để sau — chưa thực hiện gì. Bạn vẫn có thể bấm Xác nhận khi sẵn sàng.")).toBeTruthy();
    (fitnessAgentService.confirm as jest.Mock).mockResolvedValue(reply({ type: "ACTION_RESULT" }));
    await press(view.getByText("Xác nhận"));
    expect(fitnessAgentService.confirm).toHaveBeenCalledWith("x1");
  });
});
