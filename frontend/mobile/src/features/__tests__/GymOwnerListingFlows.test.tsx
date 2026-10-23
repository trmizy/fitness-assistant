import { Alert } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AboutSection, FacilitiesSection, PhotosSection } from "../gymOwner/BranchSections";
import { ApplicationWizard } from "../partnerApplication/ApplicationWizard";
import GymOwnerGymsScreen from "../../../app/gym-owner/gyms";
import {
  applicationAmenityService,
  gymListingService,
  gymService,
  locationService,
  ownerAmenityService,
  partnerApplicationService,
  uploadGymListingPhoto,
} from "../../services/api";
import { pickImages } from "../../lib/pickFile";

/**
 * Phase M2 — the owner flows OUTSIDE the listing screen: a branch's read-only description / amenities / photos, the application
 * wizard's amenity step (resume, save, AMENITIES_REQUIRED), and the quick "Thêm chi nhánh" sheet.
 * Evidence label: TEST FIXTURE (jest-expo component test) — not a real-device run.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => ({ get router() { return mockRouter; } }));

jest.mock("../../context/AppContext", () => ({ useApp: () => ({ user: { id: "owner-1" }, logout: jest.fn() }) }));

const mockToast = jest.fn();
jest.mock("../../components/ui/Toast", () => {
  const actual = jest.requireActual("../../components/ui/Toast");
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock("../../lib/pickFile", () => ({ pickImages: jest.fn(), pickApplicationFile: jest.fn() }));
jest.mock("../gymOwner/MapPinPicker", () => ({ MapPinPicker: () => null }));

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    uploadGymListingPhoto: jest.fn(),
    uploadApplicationFile: jest.fn(),
    applicationAmenityService: { save: jest.fn(), catalog: jest.fn() },
    ownerAmenityService: { catalog: jest.fn(), propose: jest.fn(), updateProposal: jest.fn(), cancelProposal: jest.fn() },
    gymListingService: { get: jest.fn(), deletePhoto: jest.fn(), setCover: jest.fn(), reorderPhotos: jest.fn() },
    locationService: { getProvinces: jest.fn(), getWards: jest.fn() },
    gymService: {
      updateGym: jest.fn(),
      listGymPhotos: jest.fn(),
      listOwnedGyms: jest.fn(),
      listOwnedBrands: jest.fn(),
      getOnboardingStatus: jest.fn(),
      createGym: jest.fn(),
      updateGymDraft: jest.fn(),
    },
    partnerApplicationService: {
      get: jest.fn(),
      submit: jest.fn(),
      resubmit: jest.fn(),
      markIssueUpdated: jest.fn(),
      saveRepresentative: jest.fn(),
      saveBrand: jest.fn(),
      saveBranch: jest.fn(),
    },
  };
});

const gymSvc = gymService as unknown as Record<string, jest.Mock>;
const listingSvc = gymListingService as unknown as Record<string, jest.Mock>;
const amenitySvc = ownerAmenityService as unknown as Record<string, jest.Mock>;
const appAmenity = applicationAmenityService as unknown as Record<string, jest.Mock>;
const appSvc = partnerApplicationService as unknown as Record<string, jest.Mock>;
const locSvc = locationService as unknown as Record<string, jest.Mock>;
const upload = uploadGymListingPhoto as jest.Mock;
const pick = pickImages as jest.Mock;

const err = (status: number, code: string, message = "msg") => ({ response: { status, data: { success: false, error: { code, message }, message } } });
const am = (id: string, name: string, category = "FACILITY", iconKey = "wifi") => ({ id, slug: id, name, category, iconKey, sortOrder: 10, status: "ACTIVE", source: "SYSTEM" });
const WIFI = am("a-wifi", "Wifi miễn phí");
const WEIGHTS = am("a-weights", "Tạ tự do", "TRAINING_ZONE", "dumbbell");

let client: QueryClient;
const wrap = async (ui: React.ReactElement) => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};
const press = async (el: any) => {
  await act(async () => {
    await fireEvent.press(el);
  });
  // let the async work the press started (requests, refetches, the sheet closing) finish INSIDE an act, so the next one never overlaps it
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  for (const group of [gymSvc, listingSvc, amenitySvc, appAmenity, appSvc, locSvc]) Object.values(group).forEach((fn) => fn.mockReset());
  upload.mockReset();
  pick.mockReset();
  amenitySvc.catalog.mockResolvedValue({ amenities: [WIFI, WEIGHTS], proposals: [] });
  appAmenity.catalog.mockResolvedValue({ amenities: [WIFI, WEIGHTS], proposals: [] });
  locSvc.getProvinces.mockResolvedValue([]);
  locSvc.getWards.mockResolvedValue([]);
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
// Whatever a test started (a refetch, a closing sheet) must finish INSIDE an act before the next test begins.
afterEach(async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  alertSpy.mockRestore();
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("branch screen: an approved branch's description, amenities and photos are read-only", () => {
  const approved = { id: "g1", status: "APPROVED", description: "Mô tả đã duyệt", phone: "0900000000", email: "a@b.vn", facilities: ["WIFI"] };

  it("About: the description is shown, not editable; saving contact sends NO description (the server would refuse the whole PATCH)", async () => {
    gymSvc.updateGym.mockResolvedValue({});
    const view = await wrap(<AboutSection uid="owner-1" gym={approved} />);
    expect(view.getByText("Mô tả đã duyệt")).toBeTruthy();
    expect(view.queryByDisplayValue("Mô tả đã duyệt")).toBeNull();
    await fireEvent.changeText(view.getByDisplayValue("0900000000"), "0911111111");
    await press(view.getByText("Lưu liên hệ"));
    expect(gymSvc.updateGym).toHaveBeenCalledWith("g1", { phone: "0911111111", email: "a@b.vn" });
    await press(view.getByText("Sửa ở Tin đăng"));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/gym-owner/listing", params: { gymId: "g1" } });
  });

  it("About: a DRAFT branch keeps the wizard-like editing and sends the description", async () => {
    gymSvc.updateGym.mockResolvedValue({});
    const view = await wrap(<AboutSection uid="owner-1" gym={{ ...approved, status: "DRAFT" }} />);
    await fireEvent.changeText(view.getByDisplayValue("Mô tả đã duyệt"), "Mô tả mới");
    await press(view.getByText("Lưu giới thiệu & liên hệ"));
    expect(gymSvc.updateGym).toHaveBeenCalledWith("g1", { description: "Mô tả mới", phone: "0900000000", email: "a@b.vn" });
  });

  it("About: a 409 LISTING_REVIEW_REQUIRED from the old route is told in the app's words", async () => {
    gymSvc.updateGym.mockRejectedValue(err(409, "LISTING_REVIEW_REQUIRED"));
    const view = await wrap(<AboutSection uid="owner-1" gym={{ ...approved, status: "DRAFT" }} />);
    await fireEvent.changeText(view.getByDisplayValue("Mô tả đã duyệt"), "x");
    await press(view.getByText("Lưu giới thiệu & liên hệ"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/cần gửi duyệt/), "danger"));
  });

  it("Facilities: the real amenities read from the owner's branch (custom ones too, no mirror) are listed read-only with 'Sửa ở Tin đăng'", async () => {
    const gym = {
      ...approved,
      facilities: ["WIFI"],
      amenities: [WIFI, am("c-box", "Phòng boxing", "TRAINING_ZONE", "trophy"), { ...am("a-sauna", "Xông hơi", "RECOVERY", "flame"), status: "DISABLED" }],
      amenityProposals: [{ id: "00000000-0000-4000-8000-000000000090", name: "Quầy nước ép", kind: "NEW", status: "PENDING", suggestedCategory: "SERVICE", gymId: "g1" }],
    };
    const view = await wrap(<FacilitiesSection uid="owner-1" gym={gym} />);
    expect(view.getByText("Phòng boxing")).toBeTruthy();
    expect(view.getByText("Wifi miễn phí")).toBeTruthy();
    expect(view.queryByText("Xông hơi")).toBeNull(); // switched off in the catalogue: clients do not see it either
    expect(view.getByText("Quầy nước ép · chờ duyệt")).toBeTruthy();
    expect(view.queryByText("Lưu tiện ích")).toBeNull();
    expect(listingSvc.get).not.toHaveBeenCalled();
    await press(view.getByText("Sửa ở Tin đăng"));
    expect(mockRouter.push).toHaveBeenCalled();
  });

  it("Facilities: an older answer without `amenities` still shows the facilities mirror", async () => {
    const view = await wrap(<FacilitiesSection uid="owner-1" gym={approved} />);
    expect(view.getByText("Wifi miễn phí")).toBeTruthy();
  });

  it("Facilities: a branch waiting for first review is read-only with the reason", async () => {
    const view = await wrap(<FacilitiesSection uid="owner-1" gym={{ ...approved, status: "PENDING_REVIEW", amenities: [WIFI], amenityProposals: [] }} />);
    expect(view.getByText("Wifi miễn phí")).toBeTruthy();
    expect(view.getByText(/duyệt xong mới sửa được tiện ích/)).toBeTruthy();
    expect(view.queryByText("Sửa ở Tin đăng")).toBeNull();
  });

  it("Facilities: a DRAFT branch reads its REAL selection back (a custom amenity included) and saves through PATCH .../draft", async () => {
    gymSvc.updateGymDraft.mockResolvedValue({});
    amenitySvc.catalog.mockResolvedValue({ amenities: [WIFI, WEIGHTS, am("c-box", "Phòng boxing", "TRAINING_ZONE", "trophy")], proposals: [] });
    const gym = {
      ...approved,
      status: "DRAFT",
      facilities: ["WIFI"],
      amenities: [WIFI, am("c-box", "Phòng boxing", "TRAINING_ZONE", "trophy")],
      amenityProposals: [{ id: "00000000-0000-4000-8000-000000000090", name: "Quầy nước ép", kind: "NEW", status: "PENDING", suggestedCategory: "SERVICE", gymId: "g1" }],
    };
    const view = await wrap(<FacilitiesSection uid="owner-1" gym={gym} />);
    expect(await view.findByLabelText("Phòng boxing (đã chọn)")).toBeTruthy();
    expect(view.getByLabelText("Wifi miễn phí (đã chọn)")).toBeTruthy();
    expect(view.getByText("Quầy nước ép")).toBeTruthy();
    await press(view.getByLabelText("Tạ tự do"));
    await press(view.getByText("Lưu tiện ích"));
    expect(gymSvc.updateGymDraft).toHaveBeenCalledWith("g1", {
      amenityIds: ["a-wifi", "c-box", "a-weights"],
      proposalIds: ["00000000-0000-4000-8000-000000000090"],
    });
  });

  it("Facilities: a DRAFT branch cannot save an empty selection", async () => {
    amenitySvc.catalog.mockResolvedValue({ amenities: [WIFI], proposals: [] });
    const view = await wrap(<FacilitiesSection uid="owner-1" gym={{ ...approved, status: "DRAFT", amenities: [], amenityProposals: [] }} />);
    await view.findByLabelText("Wifi miễn phí");
    await press(view.getByText("Lưu tiện ích"));
    expect(gymSvc.updateGymDraft).not.toHaveBeenCalled();
  });

  it("Photos: read-only for an approved branch (no add / delete / reorder), with the button to the listing", async () => {
    gymSvc.listGymPhotos.mockResolvedValue([{ id: "p1", fileName: "p1.webp", url: "/media/gym-photos/p1", isCover: true }]);
    const view = await wrap(<PhotosSection uid="owner-1" gymId="g1" status="APPROVED" />);
    expect(await view.findByText("Ảnh bìa")).toBeTruthy();
    expect(view.queryByLabelText("Xoá ảnh")).toBeNull();
    expect(view.queryByLabelText("Đưa ra sau")).toBeNull();
    expect(view.queryByText(/Thêm ảnh/)).toBeNull();
    await press(view.getByText("Sửa ở Tin đăng"));
    expect(mockRouter.push).toHaveBeenCalled();
  });

  it("Photos: a branch waiting for its first review has no photo controls and says when it will", async () => {
    gymSvc.listGymPhotos.mockResolvedValue([]);
    const view = await wrap(<PhotosSection uid="owner-1" gymId="g1" status="PENDING_REVIEW" />);
    expect(await view.findByText(/duyệt xong mới thêm hoặc sửa ảnh/)).toBeTruthy();
    expect(view.queryByText("Sửa ở Tin đăng")).toBeNull();
  });

  it("Photos: a DRAFT branch uploads through presign/confirm, covers and deletes through the NEW routes", async () => {
    gymSvc.listGymPhotos.mockResolvedValue([
      { id: "p1", fileName: "p1.webp", url: "https://s3/1", isCover: true },
      { id: "p2", fileName: "p2.webp", url: "https://s3/2", isCover: false },
    ]);
    pick.mockResolvedValue([{ uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg", isImage: true }]);
    upload.mockResolvedValue({ photo: { id: "p3" }, deduplicated: false });
    listingSvc.setCover.mockResolvedValue({ photos: [] });
    listingSvc.reorderPhotos.mockResolvedValue({ photos: [] });
    listingSvc.deletePhoto.mockResolvedValue({ deleted: true });
    const view = await wrap(<PhotosSection uid="owner-1" gymId="g1" status="DRAFT" />);
    await view.findByText("Thêm ảnh (2/20)");

    await press(view.getByText("Thêm ảnh (2/20)"));
    await waitFor(() => expect(upload).toHaveBeenCalledWith("g1", expect.objectContaining({ name: "a.jpg" })));

    await press(view.getByLabelText("Đặt làm ảnh bìa"));
    expect(listingSvc.setCover).toHaveBeenCalledWith("g1", "p2");
    await press(view.getAllByLabelText("Đưa ra sau")[0]);
    expect(listingSvc.reorderPhotos).toHaveBeenCalledWith("g1", ["p2", "p1"]);
    await press(view.getAllByLabelText("Xoá ảnh")[0]);
    const buttons = alertSpy.mock.calls.at(-1)![2] as { text: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.text === "Xoá")!.onPress!());
    expect(listingSvc.deletePhoto).toHaveBeenCalledWith("g1", "p1");
  });

  it("Photos: a 410 UPLOAD_ROUTE_RETIRED is told as 'update the app', not a raw status", async () => {
    gymSvc.listGymPhotos.mockResolvedValue([{ id: "p1", fileName: "p1.webp", url: "https://s3/1", isCover: true }]);
    listingSvc.setCover.mockRejectedValue(err(410, "UPLOAD_ROUTE_RETIRED"));
    const view = await wrap(<PhotosSection uid="owner-1" gymId="g1" status="DRAFT" />);
    await view.findByText("Thêm ảnh (1/20)");
    // p1 is the cover; add a second photo so a cover button exists
    gymSvc.listGymPhotos.mockResolvedValue([
      { id: "p1", fileName: "p1.webp", url: "https://s3/1", isCover: true },
      { id: "p2", fileName: "p2.webp", url: "https://s3/2", isCover: false },
    ]);
    await act(async () => {
      await client.invalidateQueries();
    });
    await press(await view.findByLabelText("Đặt làm ảnh bìa"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/cập nhật ứng dụng/), "danger"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("application wizard: the amenity step", () => {
  const baseView = (over: Record<string, unknown> = {}) => ({
    accessState: "ONBOARDING",
    editable: true,
    minPhotos: 3,
    partner: {},
    brand: {},
    branch: {},
    photos: [],
    documents: [],
    issues: [],
    missing: [],
    amenities: [],
    amenityProposals: [],
    applicationFlowVersion: 2,
    ...over,
  });

  it("resumes AT the amenity step when the server's missing list starts with AMENITIES", async () => {
    appSvc.get.mockResolvedValue(baseView({ missing: [{ section: "AMENITIES", message: "Chưa chọn tiện ích nào cho chi nhánh" }, { section: "PHOTOS", message: "Cần ảnh" }] }));
    const view = await wrap(<ApplicationWizard />);
    expect(await view.findByText(/Bước 7\/10: Tiện ích/)).toBeTruthy();
    expect(await view.findByLabelText("Tạ tự do")).toBeTruthy();
    expect(view.getByText("Chưa chọn tiện ích nào cho chi nhánh")).toBeTruthy();
    expect(view.getAllByText("Lưu bước này").length).toBe(1);
  });

  it("saving sends the chosen ids and the kept proposals to PUT /owner/application/amenities", async () => {
    appSvc.get.mockResolvedValue(
      baseView({
        missing: [{ section: "AMENITIES", message: "x" }],
        amenities: [WIFI],
        amenityProposals: [{ id: "00000000-0000-4000-8000-000000000090", name: "Phòng boxing", kind: "NEW", status: "PENDING", suggestedCategory: "TRAINING_ZONE", gymId: "g" }],
      }),
    );
    appAmenity.save.mockResolvedValue({ amenities: [], amenityProposals: [], amenityCount: 2 });
    const view = await wrap(<ApplicationWizard />);
    await view.findByText(/Bước 7\/10: Tiện ích/);
    expect(await view.findByLabelText("Wifi miễn phí (đã chọn)")).toBeTruthy();
    await press(view.getByLabelText("Tạ tự do"));
    await press(view.getByText("Lưu bước này"));
    expect(appAmenity.save).toHaveBeenCalledWith({ amenityIds: ["a-wifi", "a-weights"], proposalIds: ["00000000-0000-4000-8000-000000000090"] });
  });

  it("a name that is already in the catalogue is selected instead of proposed; a new one is sent inline", async () => {
    appSvc.get.mockResolvedValue(baseView({ missing: [{ section: "AMENITIES", message: "x" }] }));
    appAmenity.save.mockResolvedValue({});
    const view = await wrap(<ApplicationWizard />);
    await view.findByText(/Bước 7\/10: Tiện ích/);
    await view.findByLabelText("Tạ tự do");

    await press(view.getByText("Đề xuất mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Phòng boxing"), "ta TU do");
    await press(view.getByLabelText("Nhóm Khu tập luyện"));
    await press(view.getByText("Thêm đề xuất"));
    expect(view.getByLabelText("Tạ tự do (đã chọn)")).toBeTruthy();
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/đã có sẵn/), "success");

    await press(view.getByText("Đề xuất mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Phòng boxing"), "Phòng boxing");
    await press(view.getByLabelText("Nhóm Khu tập luyện"));
    await press(view.getByText("Thêm đề xuất"));
    await press(view.getByText("Lưu bước này"));
    expect(appAmenity.save).toHaveBeenCalledWith({
      amenityIds: ["a-weights"],
      proposals: [{ name: "Phòng boxing", suggestedCategory: "TRAINING_ZONE" }],
      proposalIds: [],
    });
  });

  it("nothing chosen: the step cannot be saved and says why", async () => {
    appSvc.get.mockResolvedValue(baseView({ missing: [{ section: "AMENITIES", message: "x" }] }));
    const view = await wrap(<ApplicationWizard />);
    await view.findByText(/Bước 7\/10: Tiện ích/);
    expect((await view.findAllByText(/Chọn ít nhất một tiện ích/)).length).toBeGreaterThan(0);
    await press(view.getByText("Lưu bước này"));
    expect(appAmenity.save).not.toHaveBeenCalled();
  });

  it("the applicant reads the catalogue from the application's own route, never from /owner/amenities (gated until approval)", async () => {
    appSvc.get.mockResolvedValue(baseView({ missing: [{ section: "AMENITIES", message: "x" }] }));
    const view = await wrap(<ApplicationWizard />);
    await view.findByText(/Bước 7\/10: Tiện ích/);
    expect(await view.findByLabelText("Tạ tự do")).toBeTruthy();
    expect(appAmenity.catalog).toHaveBeenCalled();
    expect(amenitySvc.catalog).not.toHaveBeenCalled();
  });

  it("a catalogue that cannot be loaded is a retryable state", async () => {
    appSvc.get.mockResolvedValue(baseView({ missing: [{ section: "AMENITIES", message: "x" }] }));
    appAmenity.catalog.mockRejectedValue(err(503, "UNAVAILABLE"));
    const view = await wrap(<ApplicationWizard />);
    await view.findByText(/Bước 7\/10: Tiện ích/);
    expect(await view.findByText("Thử lại")).toBeTruthy();
  });

  it("the review step lists the chosen amenities, and 422 AMENITIES_REQUIRED sends the applicant back to the amenity step", async () => {
    appSvc.get.mockResolvedValue(baseView({ amenities: [WIFI], amenityProposals: [{ id: "p9", name: "Phòng boxing", kind: "NEW", status: "PENDING", suggestedCategory: "TRAINING_ZONE" }] }));
    appSvc.submit.mockRejectedValue(err(422, "AMENITIES_REQUIRED", "Hãy chọn ít nhất một tiện ích cho chi nhánh trước khi gửi duyệt."));
    const view = await wrap(<ApplicationWizard />);
    expect(await view.findByText(/Bước 10\/10/)).toBeTruthy();
    expect(view.getByText("Tiện ích chi nhánh")).toBeTruthy();
    expect(view.getByText("Wifi miễn phí")).toBeTruthy();
    expect(view.getByText("Phòng boxing · chờ duyệt")).toBeTruthy();

    await press(view.getByLabelText("Đồng ý điều khoản đối tác"));
    await press(view.getByText("Gửi hồ sơ"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/ít nhất một tiện ích/), "danger"));
    expect(await view.findByText(/Bước 7\/10: Tiện ích/)).toBeTruthy();
  });

  it("resubmit after the admin asked for amenities handles 422 the same way", async () => {
    appSvc.get.mockResolvedValue(
      baseView({ accessState: "CHANGES_REQUESTED", issues: [{ id: "i1", category: "AMENITIES", message: "Cần chọn tiện ích", status: "RESOLVED" }], amenities: [] }),
    );
    appSvc.resubmit.mockRejectedValue(err(422, "AMENITIES_REQUIRED", "Hãy chọn ít nhất một tiện ích cho chi nhánh trước khi gửi duyệt."));
    const view = await wrap(<ApplicationWizard />);
    await view.findByText(/Bước 10\/10/);
    expect(view.getAllByText("Tiện ích").length).toBeGreaterThan(1); // the step chip AND the issue category, which has a Vietnamese name
    await press(view.getByText("Gửi lại hồ sơ"));
    expect(await view.findByText(/Bước 7\/10: Tiện ích/)).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe("quick 'Thêm chi nhánh': at least one amenity", () => {
  const openSheet = async () => {
    gymSvc.getOnboardingStatus.mockResolvedValue({ role: "OWNER" });
    gymSvc.listOwnedGyms.mockResolvedValue([]);
    gymSvc.listOwnedBrands.mockResolvedValue([{ id: "b1", name: "Gymini", approvedName: "Gymini" }]);
    const view = await wrap(<GymOwnerGymsScreen />);
    await press(await view.findByText("Thêm chi nhánh"));
    await fireEvent.changeText(await view.findByPlaceholderText("Ví dụ: Gymini Quận 1"), "Gymini Q3");
    await fireEvent.changeText(view.getByPlaceholderText("123 Lê Lợi"), "5 Võ Văn Tần");
    return view;
  };

  it("the create button stays off until an amenity (or a proposal) is chosen, then sends amenityIds", async () => {
    gymSvc.createGym.mockResolvedValue({ id: "new" });
    const view = await openSheet();
    expect(await view.findByText("Chọn ít nhất một tiện ích (hoặc gửi một đề xuất) cho chi nhánh.")).toBeTruthy();
    await press(view.getByText("Tạo chi nhánh"));
    expect(gymSvc.createGym).not.toHaveBeenCalled();

    await press(await view.findByLabelText("Wifi miễn phí"));
    await press(view.getByText("Tạo chi nhánh"));
    expect(gymSvc.createGym).toHaveBeenCalledWith({ name: "Gymini Q3", address: "5 Võ Văn Tần", amenityIds: ["a-wifi"] });
  });

  it("a proposal alone satisfies it and is sent inline", async () => {
    gymSvc.createGym.mockResolvedValue({ id: "new" });
    const view = await openSheet();
    await view.findByLabelText("Wifi miễn phí");
    await press(view.getByText("Đề xuất mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Phòng boxing"), "Phòng boxing");
    await press(view.getByLabelText("Nhóm Khu tập luyện"));
    await press(view.getByText("Thêm đề xuất"));
    await press(view.getByText("Tạo chi nhánh"));
    expect(gymSvc.createGym).toHaveBeenCalledWith({
      name: "Gymini Q3",
      address: "5 Võ Văn Tần",
      amenityIds: [],
      proposals: [{ name: "Phòng boxing", suggestedCategory: "TRAINING_ZONE" }],
    });
  });

  it("if the server still answers 422 AMENITIES_REQUIRED the owner gets its sentence", async () => {
    gymSvc.createGym.mockRejectedValue(err(422, "AMENITIES_REQUIRED", "Hãy chọn ít nhất một tiện ích cho chi nhánh trước khi gửi duyệt."));
    const view = await openSheet();
    await press(await view.findByLabelText("Wifi miễn phí"));
    await press(view.getByText("Tạo chi nhánh"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/ít nhất một tiện ích/), "danger"));
  });

  it("the entry to 'Tin đăng & tiện ích' is the OWNER's alone", async () => {
    gymSvc.getOnboardingStatus.mockResolvedValue({ role: "OWNER" });
    gymSvc.listOwnedBrands.mockResolvedValue([{ id: "b1", name: "Gymini", approvedName: "Gymini" }]);
    gymSvc.listOwnedGyms.mockResolvedValue([{ id: "g1", name: "Q1", address: "1 Lê Lợi", status: "APPROVED", operationalStatus: "OPEN", brandId: "b1" }]);
    const owner = await wrap(<GymOwnerGymsScreen />);
    expect(await owner.findByText("Tin đăng & tiện ích")).toBeTruthy();
    await press(owner.getByText("Tin đăng & tiện ích"));
    expect(mockRouter.push).toHaveBeenCalledWith("/gym-owner/listing");
    owner.unmount();

    gymSvc.getOnboardingStatus.mockResolvedValue({ role: "MANAGER" });
    const manager = await wrap(<GymOwnerGymsScreen />);
    await manager.findByText("Q1");
    expect(manager.queryByText("Tin đăng & tiện ích")).toBeNull();
  });
});
