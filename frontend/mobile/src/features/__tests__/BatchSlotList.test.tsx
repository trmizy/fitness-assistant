import { act, fireEvent, render } from "@testing-library/react-native";

import { BatchSlotList } from "../services/BatchSlotList";

/**
 * The slot list of the "đặt nhiều buổi" summary: one row per slot, a remove button, and the server's reason under a refused slot.
 * Evidence label: TEST FIXTURE (jest-expo component test) - not a device run.
 */
describe("BatchSlotList", () => {
  const slots = [
    { date: "2030-05-10", time: "07:00" },
    { date: "2030-05-11", time: "18:00" },
  ];

  it("renders one row per slot and removes the one tapped", async () => {
    const onRemove = jest.fn();
    const view = await render(<BatchSlotList slots={slots} onRemove={onRemove} />);
    expect(view.getByText("Th 6, 10/05 · 07:00")).toBeTruthy();
    expect(view.getByText("Th 7, 11/05 · 18:00")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByLabelText("Bỏ khung giờ Th 7, 11/05 · 18:00"));
    });
    expect(onRemove).toHaveBeenCalledWith(slots[1]);
  });

  it("shows the refusal reason under the slot it belongs to", async () => {
    const view = await render(
      <BatchSlotList
        slots={slots}
        errors={{ "2030-05-10 07:00": "Mỗi ngày bạn chỉ được đặt tối đa 2 buổi tập" }}
        onRemove={() => {}}
      />,
    );
    expect(view.getByText("Mỗi ngày bạn chỉ được đặt tối đa 2 buổi tập")).toBeTruthy();
    expect(view.queryByText(/Khung giờ này trùng/)).toBeNull();
  });

  it("renders nothing for an empty list", async () => {
    const view = await render(<BatchSlotList slots={[]} onRemove={() => {}} />);
    expect(view.toJSON()).toBeNull();
  });
});
