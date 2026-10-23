import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import TrainerDetailScreen from "../../../app/client/services/pt/[id]";
import { contractService, profileService, ptServicePackageService } from "../../services/api";

/**
 * Phase M1 — the CLIENT side of Listing Management on the trainer detail screen: the physique gallery,
 * the package version that rides on a contract request, the 409 PACKAGE_CHANGED dialog, and the 404 state
 * for a hidden trainer.
 *
 * Evidence label: TEST FIXTURE (jest-expo component test, API wrappers mocked).
 */

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: "pt-1" }),
  useFocusEffect: () => {},
}));

const mockToast = jest.fn();
jest.mock("../../components/ui/Toast", () => {
  const actual = jest.requireActual("../../components/ui/Toast");
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock("../chat/useOpenChat", () => ({ useOpenChat: () => ({ openChat: jest.fn(), opening: false }) }));

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    profileService: { ...actual.profileService, getPTDetail: jest.fn(), listPTs: jest.fn() },
    ptServicePackageService: { ...actual.ptServicePackageService, getPackagesForPT: jest.fn() },
    contractService: { ...actual.contractService, requestContract: jest.fn(), getGymOptions: jest.fn() },
  };
});

const detail = (over: Record<string, unknown> = {}) => ({
  userId: "pt-1",
  firstName: "Lan",
  lastName: "Trần",
  photoUrl: null,
  specialties: ["Tăng cơ"],
  isAcceptingClients: true,
  ptSuspended: false,
  avgRating: 4.5,
  ratingCount: 3,
  ptApplication: { serviceMode: "ONLINE", professionalBio: "Bio của Lan", fromPricePerSession: 200000, fromPackagePrice: 2000000 },
  fromPricePerSession: 200000,
  fromPackagePrice: 2000000,
  physiquePhotos: [
    { id: "ph-1", url: "/media/pt-physique/ph-1", isCover: true, sortOrder: 0 },
    { id: "ph-2", url: "/media/pt-physique/ph-2", isCover: false, sortOrder: 1 },
  ],
  coverPhotoUrl: "/media/pt-physique/ph-1",
  recentReviews: [],
  ...over,
});

const pkg = (over: Record<string, unknown> = {}) => ({
  id: "pkg-1",
  ptUserId: "pt-1",
  name: "Gói 10 buổi",
  description: null,
  sessionCount: 10,
  price: "2000000",
  sessionMode: "ONLINE",
  sessionDurationMinutes: 60,
  validityDays: null,
  isActive: true,
  archivedAt: null,
  version: 4,
  ...over,
});

const mocked = {
  detail: profileService.getPTDetail as jest.Mock,
  list: profileService.listPTs as jest.Mock,
  packages: ptServicePackageService.getPackagesForPT as jest.Mock,
  request: contractService.requestContract as jest.Mock,
  gymOptions: contractService.getGymOptions as jest.Mock,
};

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TrainerDetailScreen />
    </QueryClientProvider>,
  );
}

async function press(el: any) {
  await act(async () => {
    fireEvent.press(el);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked.list.mockResolvedValue({ pts: [] });
  mocked.gymOptions.mockResolvedValue({ gyms: [] });
});

describe("trainer detail — Listing Management (client side)", () => {
  it("shows the physique gallery on the intro tab", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg()]);
    const view = await renderScreen();
    expect(await view.findByText("1/2")).toBeTruthy(); // GymPhotoGallery counter: first of two public photos
  });

  it("a trainer with no public photos has no gallery", async () => {
    mocked.detail.mockResolvedValue(detail({ physiquePhotos: [], coverPhotoUrl: null }));
    mocked.packages.mockResolvedValue([pkg()]);
    const view = await renderScreen();
    expect(await view.findByText("Bio của Lan")).toBeTruthy();
    expect(view.queryByText("1/2")).toBeNull();
  });

  it("a hidden / suspended trainer (404) gets a friendly state, not 'could not read'", async () => {
    mocked.detail.mockRejectedValue({ response: { status: 404, data: { error: "PT not found" } } });
    mocked.packages.mockRejectedValue({ response: { status: 404, data: { error: "PT not found" } } });
    const view = await renderScreen();
    expect(await view.findByText("Huấn luyện viên không còn hiển thị")).toBeTruthy();
    expect(view.queryByText("Không đọc được hồ sơ huấn luyện viên")).toBeNull();
  });

  it("packages show their prices, 'Gói từ …', and the request carries the version on screen", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg()]);
    mocked.request.mockResolvedValue({ id: "c1" });
    const view = await renderScreen();
    await press(await view.findByText("Gói dịch vụ"));
    expect(await view.findByText("Gói 10 buổi")).toBeTruthy();
    expect(view.getByText(/Gói từ/)).toBeTruthy();

    await press(view.getByText("Gói 10 buổi"));
    await press(view.getByText("Gửi yêu cầu huấn luyện"));
    await waitFor(() => expect(mocked.request).toHaveBeenCalledTimes(1));
    const body = mocked.request.mock.calls[0][0];
    expect(body.packageId).toBe("pkg-1");
    expect(body.expectedPackageVersion).toBe(4);
    expect("price" in body).toBe(false);
  });

  it("409 PACKAGE_CHANGED: shows 'Gói đã thay đổi — xem giá mới', refetches, and the next request carries the NEW version", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg()]);
    mocked.request.mockRejectedValueOnce({
      response: {
        status: 409,
        data: { code: "PACKAGE_CHANGED", error: "Gói dịch vụ đã thay đổi.", package: pkg({ price: "2500000", version: 5 }) },
      },
    });
    const view = await renderScreen();
    await press(await view.findByText("Gói dịch vụ"));
    await press(await view.findByText("Gói 10 buổi"));
    await press(view.getByText("Gửi yêu cầu huấn luyện"));

    expect(await view.findByText("Gói đã thay đổi — xem giá mới")).toBeTruthy();
    expect(mockToast).not.toHaveBeenCalledWith(expect.anything(), "danger"); // not shown as a generic failure

    // the trainer's new terms are what the refetch returns
    mocked.packages.mockResolvedValue([pkg({ price: "2500000", version: 5 })]);
    mocked.request.mockResolvedValue({ id: "c1" });
    await press(view.getByText("Xem giá mới"));
    await waitFor(() => expect(mocked.packages.mock.calls.length).toBeGreaterThanOrEqual(2));
    // nothing was sent behind the client's back
    expect(mocked.request).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(view.getAllByText(/2\.500\.000/).length).toBeGreaterThan(0));
    await press(view.getByText("Gửi yêu cầu huấn luyện"));
    await waitFor(() => expect(mocked.request).toHaveBeenCalledTimes(2));
    expect(mocked.request.mock.calls[1][0].expectedPackageVersion).toBe(5);
  });
});
