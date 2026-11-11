import { act, configure, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Location from "expo-location";

import ClientServicesScreen from "../../../app/client/services/index";
import { gymService, locationService, profileService } from "../../services/api";

// The first render of a cold module graph is slow when the whole suite runs in parallel; the default 1s lookup / 5s test limits are too tight.
configure({ asyncUtilTimeout: 10_000 });
jest.setTimeout(40_000);

/**
 * U2 — the client's "Dịch vụ" discovery tabs wired to the location-aware APIs: POST /profile/pts/search,
 * POST /gyms/search, the saved search area, the GPS button, the cursor-409 reload, and memberships that name their gym.
 *
 * Evidence label: TEST FIXTURE (jest-expo component test, API wrappers + expo-location mocked) — not a device run.
 */

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
}));

const mockToast = jest.fn();
jest.mock("../../components/ui/Toast", () => {
  const actual = jest.requireActual("../../components/ui/Toast");
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(), maybeCompleteAuthSession: jest.fn() }));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

let mockUserId = "u1";
jest.mock("../../context/AppContext", () => ({
  useApp: () => ({ user: { id: mockUserId }, isAuthenticated: true }),
}));

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    profileService: { ...actual.profileService, getProfile: jest.fn(), updateProfile: jest.fn(), searchPTs: jest.fn() },
    locationService: { getProvinces: jest.fn(), getWards: jest.fn() },
    gymService: { ...actual.gymService, searchGyms: jest.fn(), listGyms: jest.fn(), listMyMemberships: jest.fn() },
    contractService: { ...actual.contractService, getByClient: jest.fn() },
  };
});

const mocked = {
  getProfile: profileService.getProfile as jest.Mock,
  updateProfile: profileService.updateProfile as jest.Mock,
  searchPTs: profileService.searchPTs as jest.Mock,
  provinces: locationService.getProvinces as jest.Mock,
  wards: locationService.getWards as jest.Mock,
  searchGyms: gymService.searchGyms as jest.Mock,
  listGyms: gymService.listGyms as jest.Mock,
  memberships: gymService.listMyMemberships as jest.Mock,
  permission: Location.requestForegroundPermissionsAsync as unknown as jest.Mock,
  position: Location.getCurrentPositionAsync as unknown as jest.Mock,
};

const pt = (id: string, over: Record<string, unknown> = {}) => ({
  userId: id,
  firstName: `PT${id}`,
  lastName: "Test",
  specialties: ["Yoga"],
  avgRating: 4.5,
  ratingCount: 2,
  ptApplication: { serviceMode: "OFFLINE", fromPricePerSession: 200000 },
  distanceKm: null,
  distanceBasis: null,
  ...over,
});

const gym = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Gym ${id}`,
  brand: { name: "Brand X" },
  city: "Hà Nội",
  address: "1 Phố A",
  averageRating: 4.2,
  reviewCount: 3,
  fromPrice: "300000",
  distanceKm: null,
  status: "APPROVED",
  operationalStatus: "OPEN",
  ...over,
});

const page = (pts: unknown[], over: Record<string, unknown> = {}) => ({
  pts,
  nextCursor: null,
  hasMore: false,
  appliedScope: "national",
  ...over,
});

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

async function renderScreen() {
  const qc = client();
  // A fresh element each time, so a re-render (same cache, same screen instance) really re-renders the screen.
  const tree = () => (
    <QueryClientProvider client={qc}>
      <ClientServicesScreen />
    </QueryClientProvider>
  );
  const view = await render(tree());
  return Object.assign(view, { tree });
}

async function press(el: any) {
  await act(async () => {
    fireEvent.press(el);
  });
}

const lastBody = (fn: jest.Mock) => fn.mock.calls[fn.mock.calls.length - 1][0];

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = "u1";
  mocked.getProfile.mockResolvedValue({ profile: { searchProvinceCode: null, searchWardCode: null } });
  mocked.updateProfile.mockResolvedValue({ profile: {} });
  mocked.provinces.mockResolvedValue([{ code: 79, name: "Thành phố Hồ Chí Minh" }]);
  mocked.wards.mockResolvedValue([{ code: 26734, name: "Phường Tân Định" }]);
  mocked.searchPTs.mockResolvedValue(page([pt("1")]));
  mocked.searchGyms.mockResolvedValue({ gyms: [gym("g1")], nextCursor: null, hasMore: false, appliedScope: "national" });
  mocked.listGyms.mockResolvedValue([]);
  mocked.memberships.mockResolvedValue([]);
  mocked.permission.mockResolvedValue({ status: "granted" });
  mocked.position.mockResolvedValue({ coords: { latitude: 10.7761234, longitude: 106.7019876 } });
});

describe("Tìm PT", () => {
  it("opens with a national search through POST /profile/pts/search and never asks for the location", async () => {
    const view = await renderScreen();
    expect(await view.findByText("PT1 Test")).toBeTruthy();
    expect(view.getByText("Khu vực tìm kiếm")).toBeTruthy();
    expect(view.getByText("Dùng vị trí hiện tại")).toBeTruthy();
    expect(mocked.searchPTs).toHaveBeenCalledTimes(1);
    expect(lastBody(mocked.searchPTs)).toMatchObject({ scope: "national", mode: "ANY", sortBy: "default", limit: 20 });
    expect(lastBody(mocked.searchPTs).lat).toBeUndefined();
    expect(mocked.permission).not.toHaveBeenCalled();
    expect(mocked.position).not.toHaveBeenCalled();
  });

  it("starts from the saved area (codes only) in the very first search — no national flash first", async () => {
    mocked.getProfile.mockResolvedValue({ profile: { searchProvinceCode: 79, searchWardCode: 26734 } });
    const view = await renderScreen();
    expect(await view.findByText("PT1 Test")).toBeTruthy();
    expect(mocked.searchPTs).toHaveBeenCalledTimes(1);
    expect(lastBody(mocked.searchPTs)).toMatchObject({ scope: "near", areaProvince: 79, areaWard: 26734, radiusKm: 10 });
    expect(lastBody(mocked.searchPTs).lat).toBeUndefined();
  });

  it("the GPS button asks once, sends the fix rounded to 3 decimals in the body only, shows 'đường chim bay', and saves nothing", async () => {
    mocked.searchPTs.mockImplementation(async (body: any) =>
      body.lat != null
        ? page([pt("1", { distanceKm: 3.2, distanceBasis: "GPS" })], { appliedScope: "near" })
        : page([pt("1")]),
    );
    const view = await renderScreen();
    expect(await view.findByText("PT1 Test")).toBeTruthy();

    await press(view.getByText("Dùng vị trí hiện tại"));

    expect(await view.findByText("~3,2 km (đường chim bay)")).toBeTruthy();
    expect(mocked.permission).toHaveBeenCalledTimes(1);
    expect(lastBody(mocked.searchPTs)).toMatchObject({ scope: "near", lat: 10.776, lng: 106.702, radiusKm: 10 });
    expect(view.getByText("Đang dùng GPS")).toBeTruthy();
    // only area codes are ever written to the profile — and none were, for a GPS fix
    expect(mocked.updateProfile).not.toHaveBeenCalled();
    // the screen never prints coordinates
    expect(view.queryByText(/10\.776|106\.70/)).toBeNull();
  });

  it("account switch: the previous account's GPS fix and area never reach the next account's search", async () => {
    const view = await renderScreen();
    expect(await view.findByText("PT1 Test")).toBeTruthy();
    await press(view.getByText("Dùng vị trí hiện tại"));
    await waitFor(() => expect(lastBody(mocked.searchPTs).lat).toBe(10.776));

    mockUserId = "u2";
    mocked.getProfile.mockResolvedValue({ profile: { searchProvinceCode: null, searchWardCode: null } });
    mocked.searchPTs.mockClear();
    await act(async () => {
      await view.rerender(view.tree());
    });

    await waitFor(() => expect(mocked.searchPTs).toHaveBeenCalled());
    for (const call of mocked.searchPTs.mock.calls) {
      expect(call[0].lat).toBeUndefined();
      expect(call[0].lng).toBeUndefined();
      expect(call[0].scope).toBe("national");
    }
    expect(view.queryByText("Đang dùng GPS")).toBeNull();
    expect(view.getByText("Dùng vị trí hiện tại")).toBeTruthy();
  });

  it("a denied permission shows the Vietnamese notice and keeps the national list", async () => {
    mocked.permission.mockResolvedValue({ status: "denied" });
    const view = await renderScreen();
    expect(await view.findByText("PT1 Test")).toBeTruthy();
    await press(view.getByText("Dùng vị trí hiện tại"));
    expect(await view.findByText(/Chưa được cấp quyền vị trí/)).toBeTruthy();
    expect(mocked.position).not.toHaveBeenCalled();
    expect(lastBody(mocked.searchPTs).lat).toBeUndefined();
  });

  it("the online tier reads 'Dạy online'; a province-only search shows no distance", async () => {
    mocked.searchPTs.mockResolvedValue(
      page([pt("1", { ptApplication: { serviceMode: "ONLINE" } }), pt("2")], { appliedScope: "province" }),
    );
    const view = await renderScreen();
    expect(await view.findByText("Dạy online")).toBeTruthy();
    expect(view.queryByText(/km/)).toBeNull();
  });

  it("'Xem thêm' sends the cursor; a 409 CURSOR_EXPIRED reloads from page 1 and says 'Danh sách đã cập nhật'", async () => {
    mocked.searchPTs.mockImplementation(async (body: any) => {
      if (body.cursor === "c1") {
        throw { response: { status: 409, data: { error: { code: "CURSOR_EXPIRED" } } } };
      }
      return page([pt("1"), pt("2")], { hasMore: true, nextCursor: "c1" });
    });
    const view = await renderScreen();
    expect(await view.findByText("PT1 Test")).toBeTruthy();

    await press(view.getByText("Xem thêm"));

    expect(await view.findByText("Danh sách đã cập nhật — đã tải lại từ đầu.")).toBeTruthy();
    const bodies = mocked.searchPTs.mock.calls.map((c) => c[0]);
    expect(bodies[0].cursor).toBeUndefined();
    expect(bodies[1].cursor).toBe("c1");
    // the reload is a fresh page-1 request (no cursor)
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    expect(bodies[bodies.length - 1].cursor).toBeUndefined();
    expect(await view.findByText("PT1 Test")).toBeTruthy();
  });

  it("an empty radius search offers 'Mở rộng bán kính lên 20 km' and re-searches with it", async () => {
    mocked.getProfile.mockResolvedValue({ profile: { searchProvinceCode: 79, searchWardCode: 26734 } });
    mocked.searchPTs.mockImplementation(async (body: any) =>
      body.radiusKm === 20 ? page([pt("1", { distanceKm: 15, distanceBasis: "WARD_CENTER" })], { appliedScope: "near" }) : page([], { appliedScope: "near" }),
    );
    const view = await renderScreen();
    expect(await view.findByText("Không tìm thấy huấn luyện viên trong bán kính 10 km")).toBeTruthy();

    await press(view.getByText("Mở rộng bán kính lên 20 km"));

    await waitFor(() => expect(lastBody(mocked.searchPTs).radiusKm).toBe(20));
    expect(await view.findByText("~15,0 km từ trung tâm Phường Tân Định")).toBeTruthy();
  });

  it("a specialty chip is a server-side filter", async () => {
    const view = await renderScreen();
    expect(await view.findByText("PT1 Test")).toBeTruthy();
    await press(view.getByText("Tăng cơ"));
    await waitFor(() => expect(lastBody(mocked.searchPTs).filters).toEqual({ specialties: ["Tăng cơ"] }));
  });
});

describe("Phòng gym", () => {
  it("uses POST /gyms/search with the area, shows the distance, and never asks for the location on open", async () => {
    mocked.getProfile.mockResolvedValue({ profile: { searchProvinceCode: 79, searchWardCode: 26734 } });
    mocked.searchGyms.mockResolvedValue({
      gyms: [gym("g1", { distanceKm: 1.2 })],
      nextCursor: null,
      hasMore: false,
      appliedScope: "near",
    });
    const view = await renderScreen();
    await press(view.getByText("Phòng gym"));

    expect(await view.findByText("Gym g1")).toBeTruthy();
    expect(mocked.searchGyms).toHaveBeenCalled();
    expect(lastBody(mocked.searchGyms)).toMatchObject({ scope: "near", areaProvince: 79, areaWard: 26734, sort: "relevance" });
    expect(mocked.listGyms).not.toHaveBeenCalled();
    expect(mocked.permission).not.toHaveBeenCalled();
    expect(await view.findByText("~1,2 km từ trung tâm Phường Tân Định")).toBeTruthy();
    expect(view.getByText("Brand X")).toBeTruthy();
  });

  it("a cursor 409 on 'Xem thêm' reloads page 1 with the same notice", async () => {
    mocked.searchGyms.mockImplementation(async (body: any) => {
      if (body.cursor === "g-c1") throw { response: { status: 409, data: { code: "CURSOR_FILTER_MISMATCH" } } };
      return { gyms: [gym("g1")], nextCursor: "g-c1", hasMore: true, appliedScope: "national" };
    });
    const view = await renderScreen();
    await press(view.getByText("Phòng gym"));
    expect(await view.findByText("Gym g1")).toBeTruthy();

    await press(view.getByText("Xem thêm"));

    expect(await view.findByText("Danh sách đã cập nhật — đã tải lại từ đầu.")).toBeTruthy();
    expect(lastBody(mocked.searchGyms).cursor).toBeUndefined();
  });
});

describe("Hội viên", () => {
  it("names the gym from the membership's own gymName and does not read GET /gyms", async () => {
    mocked.memberships.mockResolvedValue([
      {
        id: "m1",
        gymId: "g1",
        gymName: "Iron District Fitness",
        planId: "p1",
        status: "ACTIVE",
        priceAtPurchase: 500000,
        durationDaysSnapshot: 30,
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ]);
    const view = await renderScreen();
    await press(view.getByText("Hội viên"));

    expect(await view.findByText("Iron District Fitness")).toBeTruthy();
    expect(mocked.listGyms).not.toHaveBeenCalled();
  });
});
