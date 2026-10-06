import { act, fireEvent, render } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ClientNutritionCoachCard } from "../pt/ClientCoachCards";
import { ptCoachService } from "../../services/api";

/**
 * 14B.2 (PG-A5) — the coach's nutrition card. The dev database has no pending AI nutrition proposal
 * (it needs weeks of real weight data), so the Duyệt / Sửa / Từ chối wiring is pinned here against
 * web's summary shape; the read side and the diet-break refusal were checked live (ADAPTERS §44).
 */

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

const mockToast = jest.fn();
jest.mock("../../components/ui/Toast", () => {
  const actual = jest.requireActual("../../components/ui/Toast");
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    ptCoachService: {
      ...actual.ptCoachService,
      getClientSummary: jest.fn(),
      approveNutritionRecommendation: jest.fn(),
      rejectNutritionRecommendation: jest.fn(),
      modifyNutritionRecommendation: jest.fn(),
      triggerDietBreakRecommendation: jest.fn(),
    },
  };
});

const summary = (decision: any) => ({
  activeCycle: { id: "cycle-1", cycleIndex: 2, name: "Giai đoạn khởi đầu" },
  cycleSummary: null,
  feedbackSummary: null,
  priorDecisions: [],
  latestAssessment: null,
  nutrition: {
    activeGoal: { calories: 2000, protein: 150, carbs: 200, fat: 65, triggeredBy: "MANUAL", goalMode: "RECOMMENDED" },
    activeProgram: null,
    consistency: { status: "NO_ACTIVE_PROGRAM" },
    latestNutritionDecision: decision,
  },
});

const pending = {
  assessmentId: "as-1",
  decision: "PROPOSE_ADJUSTMENT",
  confidence: "MEDIUM",
  headline: "Giảm 150 kcal để tiếp tục giảm mỡ",
  explanation: null,
  userDecision: "PENDING",
  reviewedAt: null,
  reviewedByRole: null,
  ptNote: null,
  canPtAct: true,
};

async function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={client}>
      <ClientNutritionCoachCard clientUserId="client-1" />
    </QueryClientProvider>,
  );
  // The summary query resolves asynchronously; wait for its data rather than one act() tick.
  await view.findByText("2000 kcal · 150g đạm");
  return view;
}

async function press(el: any) {
  await act(async () => {
    fireEvent.press(el);
  });
}

beforeEach(() => jest.clearAllMocks());

describe("ClientNutritionCoachCard", () => {
  it("a pending proposal offers Duyệt / Sửa / Từ chối and no diet-break trigger", async () => {
    (ptCoachService.getClientSummary as jest.Mock).mockResolvedValue(summary(pending));
    const view = await renderCard();
    expect(view.getByText("2000 kcal · 150g đạm")).toBeTruthy();
    expect(view.getByText("Đề xuất điều chỉnh")).toBeTruthy();
    expect(view.getByText("Giảm 150 kcal để tiếp tục giảm mỡ")).toBeTruthy();
    expect(view.queryByText("🧊 Đề xuất diet break")).toBeNull();

    (ptCoachService.approveNutritionRecommendation as jest.Mock).mockResolvedValue({});
    await press(view.getByText("Duyệt"));
    expect(ptCoachService.approveNutritionRecommendation).toHaveBeenCalledWith("client-1", "cycle-1", "as-1");

    (ptCoachService.rejectNutritionRecommendation as jest.Mock).mockResolvedValue({});
    await press(view.getByText("Từ chối"));
    expect(ptCoachService.rejectNutritionRecommendation).toHaveBeenCalledWith("client-1", "cycle-1", "as-1");
  });

  it("Sửa sends the coach's own numbers, prefilled from the current goal", async () => {
    (ptCoachService.getClientSummary as jest.Mock).mockResolvedValue(summary(pending));
    (ptCoachService.modifyNutritionRecommendation as jest.Mock).mockResolvedValue({});
    const view = await renderCard();
    await press(view.getByText("Sửa"));
    await act(async () => {
      fireEvent.changeText(view.getByDisplayValue("2000"), "2100");
    });
    await press(view.getByText("Lưu điều chỉnh"));
    expect(ptCoachService.modifyNutritionRecommendation).toHaveBeenCalledWith(
      "client-1",
      "cycle-1",
      { calories: 2100, protein: 150, carbs: 200, fat: 65 },
      "as-1",
      undefined,
    );
  });

  it("nothing pending: shows the diet-break trigger instead, and the server's refusal as a toast", async () => {
    (ptCoachService.getClientSummary as jest.Mock).mockResolvedValue(summary(null));
    (ptCoachService.triggerDietBreakRecommendation as jest.Mock).mockRejectedValue({
      response: { data: { error: "Diet break chỉ áp dụng cho chu kỳ giảm cân (WEIGHT_LOSS)." } },
    });
    const view = await renderCard();
    expect(view.queryByText("Duyệt")).toBeNull();
    await press(view.getByText("🧊 Đề xuất diet break"));
    expect(ptCoachService.triggerDietBreakRecommendation).toHaveBeenCalledWith("client-1", "cycle-1");
    expect(mockToast).toHaveBeenCalledWith("Diet break chỉ áp dụng cho chu kỳ giảm cân (WEIGHT_LOSS).", "danger");
  });
});
