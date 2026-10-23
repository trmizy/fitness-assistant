import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AMENITY_ICON_KEYS } from "../gymListing/amenityIcons";
import { AmenityIcon, LUCIDE_BY_NAME, amenityIconComponent } from "../gymListing/AmenityIcon";
import { AMENITY_ICON_LUCIDE } from "../gymListing/amenityIcons";
import { GymCard } from "../services/GymCard";
import { normalizeGym } from "../services/gymDirectory";
import GymDetailScreen from "../../../app/client/services/gyms/[id]";
import { gymService, locationService } from "../../services/api";

/**
 * Phase M2 — the client side of the gym amenities: the 30 icons, the directory card (cover + up to 4 chips), the detail page
 * (grouped amenity badges, friendly state for a gym that is no longer public).
 * Evidence label: TEST FIXTURE (jest-expo component test) — not a real-device run.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => ({
  get router() {
    return mockRouter;
  },
  useLocalSearchParams: () => ({ id: "gym-1" }),
}));

jest.mock("../services/BranchMap", () => ({ BranchMap: () => null }));
jest.mock("../services/GymReviews", () => ({ GymReviews: () => null }));
jest.mock("../../components/payment/PaymentMethodSheet", () => ({ PaymentMethodSheet: () => null, Notice: () => null }));
jest.mock("../payments/useGatewayCheckout", () => ({ useGatewayCheckout: () => ({ target: null, submitting: false, choose: jest.fn(), pay: jest.fn(), close: jest.fn() }) }));

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    gymService: {
      getGym: jest.fn(),
      listPlans: jest.fn(),
      getMembershipWarnings: jest.fn(),
      listMyMemberships: jest.fn(),
    },
    locationService: { getProvinces: jest.fn(), getWards: jest.fn() },
  };
});

const gymSvc = gymService as unknown as Record<string, jest.Mock>;
const locSvc = locationService as unknown as Record<string, jest.Mock>;

const A = (slug: string, name: string, category: string, iconKey: string) => ({ slug, name, category, iconKey });
const RAW = {
  id: "gym-1",
  brandId: "b1",
  name: "Gymini Quận 1",
  address: "1 Lê Lợi",
  city: "TP.HCM",
  status: "APPROVED",
  operationalStatus: "OPEN",
  fromPrice: 300000,
  brand: { id: "b1", name: "Gymini" },
  facilities: ["WIFI"],
  amenities: [
    A("WIFI", "Wifi miễn phí", "FACILITY", "wifi"),
    A("PARKING", "Bãi đỗ xe", "FACILITY", "car"),
    A("FREE_WEIGHTS", "Tạ tự do", "TRAINING_ZONE", "dumbbell"),
    A("SAUNA", "Xông hơi", "RECOVERY", "flame"),
    A("custom-boxing", "Phòng boxing", "TRAINING_ZONE", "trophy"),
    A("custom-x", "Quầy nước ép", "SERVICE", "not-an-icon"),
  ],
  coverPhotoUrl: "/media/gym-photos/p1",
  photos: [{ id: "p1", url: "/media/gym-photos/p1", category: null }],
};

describe("amenity icons", () => {
  it("every one of the 30 allowlist keys resolves to a real lucide component", () => {
    expect(AMENITY_ICON_KEYS).toHaveLength(30);
    for (const key of AMENITY_ICON_KEYS) {
      const name = AMENITY_ICON_LUCIDE[key];
      expect(LUCIDE_BY_NAME[name]).toBeTruthy();
      expect(amenityIconComponent(key)).toBe(LUCIDE_BY_NAME[name]);
    }
  });

  it("an unknown key draws the generic icon and still renders", async () => {
    expect(amenityIconComponent("not-an-icon")).toBe(LUCIDE_BY_NAME.Sparkles);
    expect(amenityIconComponent(null)).toBe(LUCIDE_BY_NAME.Sparkles);
    expect(() => render(<AmenityIcon iconKey="not-an-icon" />)).not.toThrow();
  });
});

describe("directory card", () => {
  it("shows the cover, at most 4 amenity chips and '+N' for the rest", async () => {
    const view = await render(<GymCard gym={normalizeGym(RAW)} onPress={jest.fn()} />);
    expect(view.getByLabelText("Ảnh Gymini Quận 1")).toBeTruthy();
    for (const n of ["Wifi miễn phí", "Bãi đỗ xe", "Tạ tự do", "Xông hơi"]) expect(view.getByText(n)).toBeTruthy();
    expect(view.queryByText("Phòng boxing")).toBeNull();
    expect(view.getByText("+2")).toBeTruthy();
  });

  it("no cover and no amenities: a plain card, no empty chip row", async () => {
    const view = await render(<GymCard gym={normalizeGym({ ...RAW, coverPhotoUrl: null, amenities: [] })} onPress={jest.fn()} />);
    expect(view.queryByLabelText("Ảnh Gymini Quận 1")).toBeNull();
    expect(view.queryByText(/^\+\d/)).toBeNull();
    expect(view.getByText("Gymini Quận 1")).toBeTruthy();
  });

  it("an old payload with only facilities still shows amenity chips", async () => {
    const { amenities: _drop, ...old } = RAW;
    const view = await render(<GymCard gym={normalizeGym(old)} onPress={jest.fn()} />);
    expect(view.getByText("Wifi miễn phí")).toBeTruthy();
  });

  it("tapping opens the gym", async () => {
    const onPress = jest.fn();
    const view = await render(<GymCard gym={normalizeGym(RAW)} onPress={onPress} />);
    await fireEvent.press(view.getByText("Gymini Quận 1"));
    expect(onPress).toHaveBeenCalled();
  });
});

describe("detail page", () => {
  const renderDetail = async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <GymDetailScreen />
      </QueryClientProvider>,
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(gymSvc).forEach((fn) => fn.mockReset());
    Object.values(locSvc).forEach((fn) => fn.mockReset());
    gymSvc.listPlans.mockResolvedValue([]);
    gymSvc.getMembershipWarnings.mockResolvedValue([]);
    gymSvc.listMyMemberships.mockResolvedValue([]);
    locSvc.getProvinces.mockResolvedValue([]);
    locSvc.getWards.mockResolvedValue([]);
  });

  it("shows the amenity badges grouped by category with their names", async () => {
    gymSvc.getGym.mockResolvedValue(RAW);
    const view = await renderDetail();
    expect(await view.findByText("Tiện ích & dịch vụ")).toBeTruthy();
    for (const g of ["Cơ sở vật chất", "Khu tập luyện", "Dịch vụ", "Phục hồi"]) expect(view.getByText(g)).toBeTruthy();
    for (const n of ["Wifi miễn phí", "Phòng boxing", "Quầy nước ép", "Xông hơi"]) expect(view.getByText(n)).toBeTruthy();
  });

  it("a gym that is no longer public (404) is a friendly empty state, not a broken page", async () => {
    gymSvc.getGym.mockRejectedValue({ response: { status: 404, data: {} } });
    gymSvc.listPlans.mockRejectedValue({ response: { status: 404, data: {} } });
    const view = await renderDetail();
    expect(await view.findByText("Phòng gym này hiện không hiển thị")).toBeTruthy();
    expect(view.queryByText("Không đọc được thông tin phòng gym")).toBeNull();
    await act(async () => {
      await fireEvent.press(view.getByText("Xem phòng gym khác"));
    });
    expect(mockRouter.replace).toHaveBeenCalledWith("/client/services");
  });

  it("the plans route alone answering 404 is handled the same way", async () => {
    gymSvc.getGym.mockResolvedValue(RAW);
    gymSvc.listPlans.mockRejectedValue({ response: { status: 404, data: {} } });
    const view = await renderDetail();
    expect(await view.findByText("Phòng gym này hiện không hiển thị")).toBeTruthy();
  });

  it("any other failure keeps the generic message", async () => {
    gymSvc.getGym.mockRejectedValue({ response: { status: 500, data: {} } });
    const view = await renderDetail();
    await waitFor(() => expect(view.getByText("Không đọc được thông tin phòng gym")).toBeTruthy());
  });
});
