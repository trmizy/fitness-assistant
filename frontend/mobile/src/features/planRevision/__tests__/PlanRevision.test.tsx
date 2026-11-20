import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { AiRevisionSheet } from "../AiRevisionSheet";
import { PlanSyncCard } from "../PlanSyncCard";
import { deriveSyncState } from "../planRevision";
import { planService } from "../../../services/api";

/**
 * COMPONENT TEST (jest-expo, TEST FIXTURE): the real components render; only the network layer (planService) is replaced.
 * Not a device/emulator E2E.
 */
jest.mock("../../../theme/workspace", () => ({ useWorkspaceAccent: () => ({ primary: "#22C55E" }) }));
jest.mock("../../../services/api", () => ({ planService: { adjustPlan: jest.fn(), getJobStatus: jest.fn() } }));

const adjust = planService.adjustPlan as unknown as jest.Mock;
const jobStatus = planService.getJobStatus as unknown as jest.Mock;

describe("PlanSyncCard", () => {
  it("update available: shows the new version and 'Áp dụng bản mới' fires apply", async () => {
    const model = deriveSyncState({ program: { sourcePlanId: "p", aiPlanVersion: 1 }, planId: "p", planVersion: 2 })!;
    const onAction = jest.fn();
    const view = await render(<PlanSyncCard model={model} onAction={onAction} />);
    expect(view.getByText("Có bản cập nhật mới (v2) chưa áp dụng vào lịch tập")).toBeTruthy();
    await fireEvent.press(view.getByText("Áp dụng bản mới"));
    expect(onAction).toHaveBeenCalledWith("apply");
  });

  it("synced: status only, no button; not saved: 'Lưu vào lịch tập'; failed: 'Thử lại'; saving: spinner text only", async () => {
    const synced = await render(
      <PlanSyncCard model={deriveSyncState({ program: { sourcePlanId: "p", aiPlanVersion: 2 }, planId: "p", planVersion: 2 })!} onAction={jest.fn()} />,
    );
    expect(synced.getByText("Lịch tập đang dùng bản mới nhất")).toBeTruthy();
    expect(synced.queryByText("Áp dụng bản mới")).toBeNull();

    const notSaved = await render(<PlanSyncCard model={deriveSyncState({ program: null, planId: "p", planVersion: 1 })!} onAction={jest.fn()} />);
    expect(notSaved.getByText("Lưu vào lịch tập")).toBeTruthy();

    const onAction = jest.fn();
    const failed = await render(
      <PlanSyncCard model={deriveSyncState({ program: null, planId: "p", planVersion: 1, failedMessage: "Không thể lưu" })!} onAction={onAction} />,
    );
    await fireEvent.press(failed.getByText("Thử lại"));
    expect(onAction).toHaveBeenCalledWith("retry");

    const saving = await render(<PlanSyncCard model={deriveSyncState({ program: null, planId: "p", planVersion: 1, saving: true })!} onAction={jest.fn()} />);
    expect(saving.getByText("Đang đồng bộ lịch tập…")).toBeTruthy();
    expect(saving.queryByText("Thử lại")).toBeNull();
  });
});

describe("AiRevisionSheet", () => {
  const props = { open: true, onClose: jest.fn(), planId: "p1", currentVersion: 3, onRevised: jest.fn(), onReload: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it("409 VERSION_CONFLICT: plain Vietnamese message, caller is asked to reload, nothing is polled", async () => {
    adjust.mockRejectedValue({ response: { status: 409, data: { success: false, error: { code: "VERSION_CONFLICT", message: "x" } } } });
    const view = await render(<AiRevisionSheet {...props} />);
    await fireEvent.press(view.getByText("Giảm còn 3 buổi mỗi tuần"));
    await fireEvent.press(view.getByText("Chỉnh kế hoạch"));
    expect(await view.findByText("Kế hoạch vừa được cập nhật ở nơi khác, hãy tải lại")).toBeTruthy();
    expect(props.onReload).toHaveBeenCalledTimes(1);
    expect(jobStatus).not.toHaveBeenCalled();
    expect(props.onRevised).not.toHaveBeenCalled();
  });

  it("text under 5 characters is refused before any request; 422 NEEDS_CLARIFICATION shows the server's question", async () => {
    adjust.mockRejectedValue({ response: { status: 422, data: { success: false, error: { code: "NEEDS_CLARIFICATION", message: "Bạn muốn đổi buổi ngực hay buổi lưng?" } } } });
    const view = await render(<AiRevisionSheet {...props} />);
    await fireEvent.press(view.getByText("Chỉnh kế hoạch"));
    expect(await view.findByText("Hãy mô tả bạn muốn đổi gì trong kế hoạch.")).toBeTruthy();
    expect(adjust).not.toHaveBeenCalled();

    await fireEvent.press(view.getByText("Thêm 10 phút cardio cuối mỗi buổi"));
    await fireEvent.press(view.getByText("Chỉnh kế hoạch"));
    expect(await view.findByText("Bạn muốn đổi buổi ngực hay buổi lưng?")).toBeTruthy();
  });

  // LAST on purpose: two un-awaited presses (the point of the test) leave RNTL 14 with overlapping act() scopes, which breaks any test after it.
  it("a double tap sends ONE adjust with expectedVersion + an Idempotency-Key; polls the job; then asks the caller to refetch", async () => {
    adjust.mockResolvedValue({ planId: "p1", jobId: "j1", status: "QUEUED" });
    jobStatus.mockResolvedValue({ status: "COMPLETED" });
    const view = await render(<AiRevisionSheet {...props} />);
    await fireEvent.press(view.getByText("Tăng từ 4 lên 8 bài mỗi buổi")); // example chip fills the box
    const send = view.getByText("Chỉnh kế hoạch");
    // two taps delivered before the first re-render (no await between them)
    const taps = [fireEvent.press(send), fireEvent.press(send)];
    await Promise.all(taps);
    await waitFor(() => expect(props.onRevised).toHaveBeenCalledTimes(1), { timeout: 6000 });
    expect(adjust).toHaveBeenCalledTimes(1);
    expect(jobStatus).toHaveBeenCalledWith("j1");
    const [planId, text, , , options] = adjust.mock.calls[0];
    expect(planId).toBe("p1");
    expect(text).toBe("Tăng từ 4 lên 8 bài mỗi buổi");
    expect(options.expectedVersion).toBe(3);
    expect(options.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(await view.findByText(/Bản mới chưa tự áp dụng vào lịch tập/)).toBeTruthy();
  });

});
