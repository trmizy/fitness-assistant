import { act, fireEvent, render } from "@testing-library/react-native";

import {
  EquipmentPicker,
  TRAINING_LOCATION_PRESETS,
  TrainingLocationPresetRow,
} from "../EquipmentPicker";
import type { EquipmentCatalogItem } from "../../services/api";

/**
 * SH-03's equipment step. The catalog names are English while the UI is Vietnamese, so the
 * Vietnamese search path (category labels + hand-picked aliases) is the part most likely to rot
 * unnoticed; the internal fallback entries must never be offered; and a preset must hand back
 * exactly its own slugs (the device test checked "Gym tại nhà" selected 8 items).
 */

function item(slug: string, name: string, category: string, aliases: string[] = []): EquipmentCatalogItem {
  return { id: `id-${slug}`, slug, name, category, aliases, description: null };
}

const catalog: EquipmentCatalogItem[] = [
  item("barbell", "Barbell", "FREE_WEIGHTS"),
  item("dumbbell", "Dumbbell", "FREE_WEIGHTS", ["DB"]),
  item("bench", "Bench (flat/incline/adjustable)", "BENCHES_RACKS"),
  item("leg-press-machine", "Leg Press Machine", "LEG_MACHINES"),
  item("resistance-band", "Resistance Band", "OTHER"),
  item("generic-machine", "Generic Machine", "OTHER"),
  item("specialty-strongman", "Strongman Equipment", "OTHER"),
];

async function press(element: any) {
  await act(async () => {
    fireEvent.press(element);
  });
}

async function type(element: any, text: string) {
  await act(async () => {
    fireEvent.changeText(element, text);
  });
}

describe("EquipmentPicker", () => {
  it("never offers the internal fallback entries", async () => {
    const view = await render(
      <EquipmentPicker catalog={catalog} selectedSlugs={new Set()} onChange={jest.fn()} />,
    );
    expect(view.getByText("Barbell")).toBeTruthy();
    expect(view.queryByText("Generic Machine")).toBeNull();
    expect(view.queryByText("Strongman Equipment")).toBeNull();
  });

  it("groups by category in the catalog's order with Vietnamese headers", async () => {
    const view = await render(
      <EquipmentPicker catalog={catalog} selectedSlugs={new Set()} onChange={jest.fn()} />,
    );
    expect(view.getByText("Tạ tự do")).toBeTruthy();
    expect(view.getByText("Ghế / Giá đỡ")).toBeTruthy();
    expect(view.getByText("Máy tập chân")).toBeTruthy();
  });

  it("finds English catalog items by Vietnamese words: a category label or a curated alias", async () => {
    const view = await render(
      <EquipmentPicker catalog={catalog} selectedSlugs={new Set()} onChange={jest.fn()} />,
    );
    const search = view.getByPlaceholderText("Tìm thiết bị...");

    await type(search, "máy");
    expect(view.getByText("Leg Press Machine")).toBeTruthy();
    expect(view.queryByText("Barbell")).toBeNull();

    await type(search, "dây thun");
    expect(view.getByText("Resistance Band")).toBeTruthy();
    expect(view.queryByText("Leg Press Machine")).toBeNull();

    await type(search, "db");
    expect(view.getByText("Dumbbell")).toBeTruthy();

    await type(search, "không có thứ này");
    expect(view.getByText("Không tìm thấy thiết bị phù hợp.")).toBeTruthy();
  });

  it("toggling an item hands back a new set without mutating the one passed in", async () => {
    const selected = new Set(["barbell"]);
    const onChange = jest.fn();
    const view = await render(
      <EquipmentPicker catalog={catalog} selectedSlugs={selected} onChange={onChange} />,
    );
    expect(view.getByText("Đã chọn 1")).toBeTruthy();

    await press(view.getByText("Dumbbell"));
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(["barbell", "dumbbell"]);

    await press(view.getByText("Barbell"));
    expect([...onChange.mock.calls[1][0]]).toEqual([]);

    expect([...selected]).toEqual(["barbell"]);
  });

  it("'Chọn tất cả' and 'Bỏ chọn' act on one category only", async () => {
    const onChange = jest.fn();
    const view = await render(
      <EquipmentPicker catalog={catalog} selectedSlugs={new Set(["bench"])} onChange={onChange} />,
    );

    // The first category rendered is Tạ tự do.
    await press(view.getAllByText("Chọn tất cả")[0]);
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(["barbell", "bench", "dumbbell"]);

    // Ghế / Giá đỡ is the second.
    await press(view.getAllByText("Bỏ chọn")[1]);
    expect([...onChange.mock.calls[1][0]]).toEqual([]);
  });
});

describe("TrainingLocationPresetRow", () => {
  it("applies exactly the preset's slugs and explains what it chose", async () => {
    const onApply = jest.fn();
    const view = await render(<TrainingLocationPresetRow onApply={onApply} />);
    const homeGym = TRAINING_LOCATION_PRESETS.find((p) => p.key === "HOME_GYM")!;

    await press(view.getByText("Gym tại nhà"));
    expect(onApply).toHaveBeenCalledWith(homeGym.slugs);
    expect(homeGym.slugs).toHaveLength(8);
    expect(view.getByText(homeGym.description)).toBeTruthy();

    await press(view.getByText("Bỏ gợi ý"));
    expect(view.queryByText(homeGym.description)).toBeNull();
  });
});
