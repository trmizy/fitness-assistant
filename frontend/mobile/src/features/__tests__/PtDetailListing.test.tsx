import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { router } from "expo-router";

import TrainerDetailScreen from "../../../app/client/services/pt/[id]";
import { availabilityService, contractService, profileService, ptServicePackageService } from "../../services/api";

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
    availabilityService: { ...actual.availabilityService, getAvailability: jest.fn(), getBookableSlots: jest.fn() },
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
  availability: availabilityService.getAvailability as jest.Mock,
  bookableSlots: availabilityService.getBookableSlots as jest.Mock,
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
  mocked.availability.mockResolvedValue([
    { dayOfWeek: "MONDAY", startTime: "13:00", endTime: "17:00", isActive: true },
    { dayOfWeek: "MONDAY", startTime: "08:00", endTime: "11:00", isActive: true },
  ]);
  mocked.bookableSlots.mockResolvedValue(["08:00", "09:00"]);
});

it("shows published weekly coaching hours separately from dated bookable slots", async () => {
  mocked.detail.mockResolvedValue(detail());
  mocked.packages.mockResolvedValue([pkg()]);
  const view = await renderScreen();

  expect(await view.findByText("Lịch dạy thường lệ")).toBeTruthy();
  expect(view.getByText("08:00–11:00")).toBeTruthy();
  expect(view.getByText("13:00–17:00")).toBeTruthy();
  expect(view.getByText("1 ngày/tuần")).toBeTruthy();
  expect(view.getAllByText("Nghỉ")).toHaveLength(6);
  expect(view.getByText("Giờ trống có thể đặt")).toBeTruthy();
  expect(view.getByText("09:00")).toBeTruthy();
  expect(mocked.availability).toHaveBeenCalledWith("pt-1");
});

describe("trainer detail — Listing Management (client side)", () => {
  it("shows the physique gallery on the intro tab", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg()]);
    const view = await renderScreen();
    expect(await view.findByText("1/2")).toBeTruthy(); // GymPhotoGallery counter: first of two public photos
    expect(await view.findByText("Giờ trống có thể đặt")).toBeTruthy();
    expect(view.getByText("08:00")).toBeTruthy();
  });

  it("U2: opens a trainer by id alone — never downloads the trainer list, even for a trainer with 0 packages on sale", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([]);
    const view = await renderScreen();
    expect(await view.findByText("Bio của Lan")).toBeTruthy();
    expect(mocked.detail).toHaveBeenCalledWith("pt-1");
    expect(mocked.list).not.toHaveBeenCalled();
  });

  it("U2: the physique photos carry the 'Ảnh minh hoạ' attribution line", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg()]);
    const view = await renderScreen();
    expect(await view.findByText("1/2")).toBeTruthy();
    expect(view.getByText("Ảnh minh hoạ ·")).toBeTruthy();
    expect(view.getByText("Nguồn ảnh & giấy phép")).toBeTruthy();
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

describe("trainer detail — N15M-14 venue outside the Gymini system", () => {
  const openRequest = async (view: any) => {
    await press(await view.findByText("Gói dịch vụ"));
    await press(await view.findByText("Gói 10 buổi"));
  };

  it("offline package, no gym: the warning sheet opens first and NOTHING is sent until 'Tôi đồng ý'", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg({ sessionMode: "OFFLINE" })]);
    mocked.request.mockResolvedValue({ id: "c1" });
    const view = await renderScreen();
    await openRequest(view);

    await press(view.getByText("Gửi yêu cầu huấn luyện"));
    expect(await view.findByText("Nơi tập ngoài hệ thống Gymini")).toBeTruthy();
    expect(view.getByText(/Gymini không chịu trách nhiệm/)).toBeTruthy();
    expect(mocked.request).not.toHaveBeenCalled();

    // the other choice sends nothing either
    await press(view.getByText("Chọn gói/PT khác"));
    expect(mocked.request).not.toHaveBeenCalled();

    await press(view.getByText("Gửi yêu cầu huấn luyện"));
    await press(await view.findByText("Tôi đồng ý"));
    await waitFor(() => expect(mocked.request).toHaveBeenCalledTimes(1));
    expect(mocked.request.mock.calls[0][0].acknowledgedIndependentVenue).toBe(true);
    expect("gymId" in mocked.request.mock.calls[0][0]).toBe(false);
  });

  it("an online package never shows the warning and never sends the flag", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg({ sessionMode: "ONLINE" })]);
    mocked.request.mockResolvedValue({ id: "c1" });
    const view = await renderScreen();
    await openRequest(view);
    await press(view.getByText("Gửi yêu cầu huấn luyện"));
    await waitFor(() => expect(mocked.request).toHaveBeenCalledTimes(1));
    expect(view.queryByText("Nơi tập ngoài hệ thống Gymini")).toBeNull();
    expect("acknowledgedIndependentVenue" in mocked.request.mock.calls[0][0]).toBe(false);
  });

  it("the server's 409 INDEPENDENT_VENUE_ACK_REQUIRED opens the same sheet instead of a generic error", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg({ sessionMode: "ONLINE" })]);
    mocked.request.mockRejectedValueOnce({ response: { status: 409, data: { code: "INDEPENDENT_VENUE_ACK_REQUIRED", error: "Nơi tập nằm ngoài hệ thống Gymini ..." } } });
    const view = await renderScreen();
    await openRequest(view);
    await press(view.getByText("Gửi yêu cầu huấn luyện"));
    expect(await view.findByText("Tôi đồng ý")).toBeTruthy();
    expect(mockToast).not.toHaveBeenCalledWith(expect.anything(), "danger");
  });
});

describe("trainer detail — gợi ý mua gói hội viên (regression UI-03 ẩn mất nút)", () => {
  const branch = (over: Record<string, unknown> = {}) => ({
    gymId: "mekong-1",
    name: "Mekong Fitness Q1",
    city: "TP.HCM",
    isPtTrainingLocation: false,
    membership: { hasActiveMembership: false, planName: null, endDate: null },
    eligibility: { canRequest: false, reason: "MEMBERSHIP_REQUIRED" },
    ...over,
  });
  const openOffline = async (view: any) => {
    await press(await view.findByText("Gói dịch vụ"));
    await press(await view.findByText("Gói 10 buổi"));
  };

  it("MEMBERSHIP_REQUIRED + chưa chọn phòng + không phải nơi tập của PT: vẫn hiện lời gợi ý và nút 'Mua gói hội viên' tới đúng gym", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg({ sessionMode: "OFFLINE" })]);
    mocked.gymOptions.mockResolvedValue({ pt: { referralCode: "QGT7KPJW" }, gyms: [branch()] });
    const view = await renderScreen();
    await openOffline(view);

    expect(await view.findByText("Mekong Fitness Q1")).toBeTruthy();
    expect(view.getByText(/cần có gói hội viên/)).toBeTruthy();
    await press(view.getByText("Mua gói hội viên"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/client/services/gyms/[id]",
      params: { id: "mekong-1", returnTo: "/client/services/pt/pt-1?packageId=pkg-1&gymId=mekong-1", referral: "QGT7KPJW" },
    });
  });

  it("đang có hợp đồng với PT này (ACTIVE_CONTRACT_EXISTS): nói đúng lý do + nút 'Xem hợp đồng', không còn 'chưa có phòng gym nào'", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg({ sessionMode: "OFFLINE" })]);
    mocked.gymOptions.mockResolvedValue({ requestBlockedReason: "ACTIVE_CONTRACT_EXISTS", gymsReason: "REQUEST_BLOCKED", gyms: [] });
    const view = await renderScreen();
    await openOffline(view);

    expect(await view.findByTestId("gym-options-blocked")).toBeTruthy();
    expect(view.getAllByText(/Bạn đang có hợp đồng với PT này/).length).toBeGreaterThan(0);
    expect(view.queryByText(/chưa có phòng gym nào/)).toBeNull();
    await press(view.getByText("Xem hợp đồng"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/client/services", params: { tab: "contracts" } });
  });

  it("lý do chặn khác (gói hội viên không đủ hạn) ở chi nhánh không phải nơi tập vẫn được ẩn — không có nút mua", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg({ sessionMode: "OFFLINE" })]);
    mocked.gymOptions.mockResolvedValue({
      gyms: [branch({ eligibility: { canRequest: false, reason: "MEMBERSHIP_DOES_NOT_COVER_CONTRACT" } })],
    });
    const view = await renderScreen();
    await openOffline(view);

    expect(await view.findByText("Mekong Fitness Q1")).toBeTruthy();
    expect(view.queryByText("Mua gói hội viên")).toBeNull();
    expect(view.queryByText(/không đủ thời hạn/)).toBeNull();
  });

  it("gói hội viên hết hạn trước hợp đồng (quy tắc 19/11): chi nhánh vẫn chọn được, có cảnh báo và nút 'Gia hạn' mở gói của gym kèm gợi ý ngày hợp đồng", async () => {
    mocked.detail.mockResolvedValue(detail());
    mocked.packages.mockResolvedValue([pkg({ sessionMode: "OFFLINE" })]);
    mocked.gymOptions.mockResolvedValue({
      pt: { referralCode: "QGT7KPJW" },
      gyms: [
        branch({
          isPtTrainingLocation: true,
          membership: { hasActiveMembership: true, planName: "Gói 1 tháng", endDate: "2026-12-19T00:00:00.000Z" },
          eligibility: {
            canRequest: true,
            reason: null,
            coverage: { coversContract: false, membershipEndsAt: "2026-12-19T12:00:00.000Z", contractEndsAt: "2027-01-30T00:00:00.000Z" },
          },
        }),
      ],
    });
    const view = await renderScreen();
    await openOffline(view);

    expect(await view.findByText("Mekong Fitness Q1")).toBeTruthy();
    expect(view.getByText(/Gói hội viên hết hạn 19[/]12, cần gia hạn/)).toBeTruthy();
    expect(view.queryByText("Mua gói hội viên")).toBeNull();
    await press(view.getByText("Gia hạn"));
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/client/services/gyms/[id]",
      params: { id: "mekong-1", returnTo: "/client/services/pt/pt-1?packageId=pkg-1&gymId=mekong-1", referral: "QGT7KPJW", coverUntil: "2027-01-30T00:00:00.000Z" },
    });
  });
});
