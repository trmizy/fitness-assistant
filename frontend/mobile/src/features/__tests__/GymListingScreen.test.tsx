import { Alert } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { GymListingScreen } from "../gymListing/GymListingScreen";
import { gymListingService, gymService, ownerAmenityService, uploadGymListingPhoto } from "../../services/api";
import { pickImages } from "../../lib/pickFile";

/**
 * Phase M2 — the Gym Owner "Tin đăng & tiện ích" screen, state by state. The service layer is mocked at the HTTP-wrapper boundary, so
 * what runs for real is everything the screen decides: which state it shows, what it sends (`expectedDraftVersion`, the payload), and
 * how it answers a 409 / 422. Server shapes are the ones in gym-listing.service.ts / gym-listing.helpers.ts / gym-amenity-catalog.service.ts.
 *
 * Evidence label: TEST FIXTURE (jest-expo component test) — not a real-browser or real-device run.
 */

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true };
jest.mock("expo-router", () => ({ get router() { return mockRouter; } }));

jest.mock("../../context/AppContext", () => ({ useApp: () => ({ user: { id: "owner-1" } }) }));

const mockToast = jest.fn();
jest.mock("../../components/ui/Toast", () => {
  const actual = jest.requireActual("../../components/ui/Toast");
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock("../../lib/pickFile", () => ({ pickImages: jest.fn() }));

jest.mock("../../services/api", () => {
  const actual = jest.requireActual("../../services/api");
  return {
    ...actual,
    uploadGymListingPhoto: jest.fn(),
    gymService: { getOnboardingStatus: jest.fn(), listOwnedGyms: jest.fn() },
    ownerAmenityService: { catalog: jest.fn(), propose: jest.fn(), updateProposal: jest.fn(), cancelProposal: jest.fn() },
    gymListingService: {
      get: jest.fn(),
      createDraft: jest.fn(),
      saveDraft: jest.fn(),
      submit: jest.fn(),
      withdraw: jest.fn(),
      discard: jest.fn(),
      rebase: jest.fn(),
      preview: jest.fn(),
      presign: jest.fn(),
      confirm: jest.fn(),
      deletePhoto: jest.fn(),
    },
  };
});

const svc = gymListingService as unknown as Record<string, jest.Mock>;
const amenitySvc = ownerAmenityService as unknown as Record<string, jest.Mock>;
const gymSvc = gymService as unknown as Record<string, jest.Mock>;
const upload = uploadGymListingPhoto as jest.Mock;
const pick = pickImages as jest.Mock;

const G = "11111111-1111-4111-8111-111111111111";
const P = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const am = (id: string, name: string, category = "FACILITY", iconKey = "wifi", status = "ACTIVE") => ({
  id,
  slug: id,
  name,
  category,
  iconKey,
  sortOrder: 10,
  status,
  source: "SYSTEM",
});
const WIFI = am("a-wifi", "Wifi miễn phí");
const WEIGHTS = am("a-weights", "Tạ tự do", "TRAINING_ZONE", "dumbbell");
const SAUNA_OFF = am("a-sauna", "Xông hơi", "RECOVERY", "flame", "DISABLED");

const payload = (over: Record<string, unknown> = {}, photoIds: string[] = [P(1), P(2)]) => ({
  description: "Phòng tập hiện đại",
  amenityIds: [WIFI.id],
  proposalIds: [],
  photoIds,
  coverPhotoId: photoIds[0] ?? null,
  ...over,
});

const revision = (over: Record<string, unknown> = {}, payloadOver: Record<string, unknown> = {}, photoIds?: string[]) => ({
  id: "rev-1",
  gymId: G,
  status: "DRAFT",
  source: "OWNER",
  parentRevisionId: null,
  baseVersion: 3,
  draftVersion: 2,
  payload: payload(payloadOver, photoIds),
  systemAdjustments: [],
  ownerNote: null,
  reviewNote: null,
  submittedAt: null,
  reviewedAt: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  stale: false,
  ...over,
});

const photoRow = (n: number, status = "PUBLISHED") => ({
  id: P(n),
  status,
  url: status === "PUBLISHED" ? `/media/gym-photos/${P(n)}` : `https://s3.example/${n}?sig=1`,
  expiresAt: status === "PUBLISHED" ? null : "2026-10-20T01:00:00.000Z",
  isCover: n === 1,
  sortOrder: n - 1,
});

const listing = (over: Record<string, unknown> = {}) => ({
  gym: { id: G, name: "Gymini Quận 1", status: "APPROVED", operationalStatus: "OPEN" },
  listingVersion: 3,
  listingPublishedAt: "2026-10-01T00:00:00.000Z",
  published: { payload: payload({}, [P(1)]), photos: [{ id: P(1), url: `/media/gym-photos/${P(1)}`, isCover: true, sortOrder: 0 }] },
  openRevision: null,
  photos: [photoRow(1), photoRow(2)],
  amenities: [WIFI],
  proposals: [],
  history: [],
  limits: { maxPhotos: 20, maxStagedPhotos: 40 },
  ...over,
});

const proposalRow = (over: Record<string, unknown> = {}) => ({
  id: P(90),
  gymId: G,
  kind: "NEW",
  targetAmenityId: null,
  name: "Phòng boxing",
  suggestedCategory: "TRAINING_ZONE",
  note: null,
  status: "PENDING",
  resultingAmenityId: null,
  rejectReason: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  ...over,
});

const ownedGym = (over: Record<string, unknown> = {}) => ({ id: G, name: "Gymini Quận 1", address: "1 Lê Lợi", status: "APPROVED", operationalStatus: "OPEN", brandId: "b1", ...over });

const err = (status: number, code: string, extra: Record<string, unknown> = {}) => ({
  response: { status, data: { success: false, error: { code, message: "msg" }, message: "msg", ...extra } },
});

let client: QueryClient;
let alertSpy: jest.SpyInstance;

async function renderScreen(initialGymId: string | null = G) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <GymListingScreen initialGymId={initialGymId} />
    </QueryClientProvider>,
  );
}

async function press(el: any) {
  await act(async () => {
    await fireEvent.press(el);
  });
  // let the async work the press started (requests, refetches, the sheet closing) finish INSIDE an act, so the next one never overlaps it
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function pressAlert(label: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  expect(call).toBeTruthy();
  const button = (call[2] as { text: string; onPress?: () => void }[]).find((b) => b.text === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button!.onPress?.();
  });
}

const lastAlert = () => alertSpy.mock.calls[alertSpy.mock.calls.length - 1];

/** Answers a save like the server: the payload as sent, draftVersion + 1. */
function echoSave() {
  svc.saveDraft.mockImplementation(async (_gymId: string, body: any) => ({ revision: revision({ draftVersion: body.expectedDraftVersion + 1 }, body.payload) }));
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const group of [svc, amenitySvc, gymSvc]) Object.values(group).forEach((fn) => fn.mockReset());
  upload.mockReset();
  pick.mockReset();
  gymSvc.getOnboardingStatus.mockResolvedValue({ role: "OWNER" });
  gymSvc.listOwnedGyms.mockResolvedValue([ownedGym()]);
  amenitySvc.catalog.mockResolvedValue({ amenities: [WIFI, WEIGHTS], proposals: [] });
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
// Whatever a test started (a refetch, a closing sheet) must finish INSIDE an act before the next test begins.
afterEach(async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  alertSpy.mockRestore();
});

describe("who can open it, and which branch", () => {
  it("a MANAGER is told it is the owner's alone — no listing call is made", async () => {
    gymSvc.getOnboardingStatus.mockResolvedValue({ role: "MANAGER" });
    const view = await renderScreen();
    expect(await view.findByText("Chỉ chủ sở hữu quản lý tin đăng")).toBeTruthy();
    expect(svc.get).not.toHaveBeenCalled();
    expect(amenitySvc.catalog).not.toHaveBeenCalled();
  });

  it("the picker lists every branch; only APPROVED / SUSPENDED are tappable, the rest say why", async () => {
    gymSvc.listOwnedGyms.mockResolvedValue([
      ownedGym({ id: "g-ok", name: "Chi nhánh duyệt" }),
      ownedGym({ id: "g-susp", name: "Chi nhánh tạm ngưng", status: "SUSPENDED" }),
      ownedGym({ id: "g-pend", name: "Chi nhánh chờ", status: "PENDING_REVIEW" }),
      ownedGym({ id: "g-draft", name: "Chi nhánh nháp", status: "DRAFT" }),
      ownedGym({ id: "g-rej", name: "Chi nhánh bị loại", status: "REJECTED" }),
      ownedGym({ id: "g-closed", name: "Chi nhánh đóng", operationalStatus: "PERMANENTLY_CLOSED" }),
    ]);
    const view = await renderScreen(null);
    expect(await view.findByText("Chi nhánh duyệt")).toBeTruthy();
    expect(view.getByText(/chờ Gymini duyệt lần đầu/)).toBeTruthy();
    expect(view.getByText(/còn ở bước nháp/)).toBeTruthy();
    expect(view.getByText(/bị từ chối nên chưa có tin đăng/)).toBeTruthy();
    expect(view.getByText(/đóng cửa vĩnh viễn/)).toBeTruthy();

    await press(view.getByLabelText("Chi nhánh chờ (chưa sửa được)"));
    expect(svc.get).not.toHaveBeenCalled();

    svc.get.mockResolvedValue(listing());
    await press(view.getByLabelText("Chi nhánh tạm ngưng"));
    await waitFor(() => expect(svc.get).toHaveBeenCalledWith("g-susp"));
  });

  it("opened from a notification with ?gymId=… of a branch that is not editable: shows the picker with the reason", async () => {
    gymSvc.listOwnedGyms.mockResolvedValue([ownedGym({ status: "PENDING_REVIEW" })]);
    const view = await renderScreen(G);
    expect(await view.findByText(/Gymini Quận 1: Chi nhánh đang chờ/)).toBeTruthy();
    expect(svc.get).not.toHaveBeenCalled();
  });
});

describe("status states", () => {
  it("nothing open: shows the published listing and offers to start a draft", async () => {
    svc.get.mockResolvedValue(listing());
    svc.createDraft.mockResolvedValue({ revision: revision() });
    const view = await renderScreen();
    expect(await view.findByText("Đang hiển thị với khách")).toBeTruthy();
    expect(view.queryByText("Lưu nháp")).toBeNull();
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));

    await press(view.getByText("Soạn bản sửa mới"));
    expect(svc.createDraft).toHaveBeenCalledWith(G, {});
    expect(await view.findByText("Đang soạn")).toBeTruthy();
    expect(view.getByLabelText("Wifi miễn phí (đã chọn)")).toBeTruthy();
  });

  it("Chờ duyệt: read-only, but the owner can withdraw", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({ status: "PENDING", submittedAt: "2026-10-19T00:00:00.000Z" }) }));
    const view = await renderScreen();
    expect(await view.findByText("Chờ duyệt")).toBeTruthy();
    expect(view.queryByText("Lưu nháp")).toBeNull();
    expect(view.queryByText("Gửi duyệt")).toBeNull();
    expect(view.queryByText("Thêm ảnh")).toBeNull();

    svc.withdraw.mockResolvedValue({ withdrawnRevisionId: "rev-1", revision: revision({ id: "rev-2", draftVersion: 1, parentRevisionId: "rev-1" }) });
    svc.get.mockResolvedValue(listing({ openRevision: revision({ id: "rev-2", draftVersion: 1, parentRevisionId: "rev-1" }) }));
    await press(view.getByText("Rút lại để sửa tiếp"));
    expect(lastAlert()[0]).toBe("Rút lại bản sửa?");
    await pressAlert("Rút lại");
    expect(svc.withdraw).toHaveBeenCalledWith(G);
    expect(await view.findByText("Gửi duyệt")).toBeTruthy();
  });

  it("Cần chỉnh sửa shows the admin's note", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({ reviewNote: "Ảnh số 2 chưa phù hợp" }) }));
    const view = await renderScreen();
    expect(await view.findByText("Cần chỉnh sửa")).toBeTruthy();
    expect(view.getByText("Ảnh số 2 chưa phù hợp")).toBeTruthy();
  });

  it("Bị từ chối shows the reason and can copy the rejected revision", async () => {
    svc.get.mockResolvedValue(listing({ history: [{ id: "rev-9", status: "REJECTED", reviewNote: "Nội dung quảng cáo quá đà", reviewedAt: new Date().toISOString(), closedAt: new Date().toISOString() }] }));
    const v2 = await renderScreen();
    expect(await v2.findByText("Bị từ chối")).toBeTruthy();
    expect(v2.getByText("Nội dung quảng cáo quá đà")).toBeTruthy();
    svc.createDraft.mockResolvedValue({ revision: revision({ parentRevisionId: "rev-9" }) });
    await press(v2.getByText("Soạn lại từ bản bị từ chối"));
    expect(svc.createDraft).toHaveBeenCalledWith(G, { copyFromRevisionId: "rev-9" });
  });

  it("a draft whose public listing moved can be rebased, carrying expectedDraftVersion", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({ stale: true }) }));
    svc.rebase.mockResolvedValue({ revision: revision({ draftVersion: 3, stale: false, baseVersion: 4 }) });
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await press(view.getByText("Cập nhật theo bản mới"));
    expect(svc.rebase).toHaveBeenCalledWith(G, { expectedDraftVersion: 2 });
  });

  it("a load failure is a retryable state; a branch the server refuses (409) can be swapped for another", async () => {
    svc.get.mockRejectedValue(err(409, "LISTING_NOT_AVAILABLE"));
    const view = await renderScreen();
    expect(await view.findByText("Không tải được tin đăng")).toBeTruthy();
    expect(view.getByText(/chưa có tin đăng để sửa/)).toBeTruthy();
    expect(view.getByText("Chọn chi nhánh khác")).toBeTruthy();
  });
});

describe("amenities", () => {
  const openDraft = async (over: Record<string, unknown> = {}) => {
    svc.get.mockResolvedValue(listing({ openRevision: revision(), ...over }));
    const view = await renderScreen();
    await view.findByLabelText("Wifi miễn phí (đã chọn)");
    return view;
  };

  it("shows the catalogue as chips grouped by category; a toggle is saved with expectedDraftVersion", async () => {
    const view = await openDraft();
    expect(view.getByText("Khu tập luyện")).toBeTruthy();
    expect(view.getByLabelText("Tạ tự do")).toBeTruthy();
    await press(view.getByLabelText("Tạ tự do"));
    expect(view.getByLabelText("Tạ tự do (đã chọn)")).toBeTruthy();
    echoSave();
    await press(view.getByText("Lưu nháp"));
    const [gymId, body] = svc.saveDraft.mock.calls[0];
    expect(gymId).toBe(G);
    expect(body.expectedDraftVersion).toBe(2);
    expect(body.payload.amenityIds).toEqual([WIFI.id, WEIGHTS.id]);
    expect(Object.keys(body.payload).sort()).toEqual(["amenityIds", "coverPhotoId", "description", "photoIds", "proposalIds"]);
  });

  it("proposing a name that is ALREADY a catalogue amenity selects it — no proposal is created", async () => {
    const view = await openDraft();
    amenitySvc.propose.mockResolvedValue({ matchedAmenity: WEIGHTS });
    await press(view.getByText("Đề xuất mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Phòng boxing"), "ta tu do");
    await press(view.getByLabelText("Nhóm Khu tập luyện"));
    await press(view.getByText("Gửi đề xuất"));
    expect(amenitySvc.propose).toHaveBeenCalledWith({ gymId: G, name: "ta tu do", suggestedCategory: "TRAINING_ZONE" });
    expect(await view.findByLabelText("Tạ tự do (đã chọn)")).toBeTruthy();
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/đã có sẵn.*đã chọn giúp/), "success");
  });

  it("a brand-new name becomes a pending proposal that goes into the draft's proposalIds", async () => {
    const view = await openDraft();
    amenitySvc.propose.mockResolvedValue({ kind: "NEW", created: true, proposal: proposalRow() });
    await press(view.getByText("Đề xuất mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Phòng boxing"), "Phòng boxing");
    await press(view.getByLabelText("Nhóm Khu tập luyện"));
    await press(view.getByText("Gửi đề xuất"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/Đã gửi đề xuất "Phòng boxing"/), "success"));
    echoSave();
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft.mock.calls[0][1].payload.proposalIds).toEqual([P(90)]);
  });

  it("a DISABLED name answers REENABLE: the owner is told it was sent to Gymini to switch back on", async () => {
    const view = await openDraft();
    amenitySvc.propose.mockResolvedValue({ kind: "REENABLE", created: true, proposal: proposalRow({ kind: "REENABLE", targetAmenityId: SAUNA_OFF.id, name: "Xông hơi", suggestedCategory: "RECOVERY" }) });
    await press(view.getByText("Đề xuất mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Phòng boxing"), "Xông hơi");
    await press(view.getByLabelText("Nhóm Phục hồi"));
    await press(view.getByText("Gửi đề xuất"));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/tạm ngưng.*bật lại/), "success"));
  });

  it("the name check runs before sending: 1 character is refused client-side", async () => {
    const view = await openDraft();
    await press(view.getByText("Đề xuất mới"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Phòng boxing"), "a");
    await press(view.getByLabelText("Nhóm Dịch vụ"));
    expect(view.getByText(/tối thiểu 2 ký tự/)).toBeTruthy();
    await press(view.getByText("Gửi đề xuất"));
    expect(amenitySvc.propose).not.toHaveBeenCalled();
  });

  it("a PENDING proposal of this branch can be edited and cancelled; another branch's is not shown", async () => {
    amenitySvc.catalog.mockResolvedValue({ amenities: [WIFI, WEIGHTS], proposals: [proposalRow(), proposalRow({ id: P(91), gymId: "other-gym", name: "Của chi nhánh khác" })] });
    const view = await openDraft({ proposals: [proposalRow()] });
    expect(await view.findByText("Phòng boxing")).toBeTruthy();
    expect(view.queryByText("Của chi nhánh khác")).toBeNull();

    amenitySvc.updateProposal.mockResolvedValue({ proposal: proposalRow({ name: "Phòng boxing Thái" }) });
    await press(view.getByText("Sửa"));
    await fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Phòng boxing"), "Phòng boxing Thái");
    await press(view.getByText("Lưu đề xuất"));
    expect(amenitySvc.updateProposal).toHaveBeenCalledWith(P(90), { name: "Phòng boxing Thái", suggestedCategory: "TRAINING_ZONE", note: null });

    amenitySvc.cancelProposal.mockResolvedValue({ cancelled: true, proposalId: P(90) });
    await press(view.getByText("Huỷ đề xuất"));
    expect(lastAlert()[0]).toBe("Huỷ đề xuất?");
    await pressAlert("Huỷ đề xuất");
    expect(amenitySvc.cancelProposal).toHaveBeenCalledWith(P(90));
  });

  it("a proposal already decided by Gymini is a 409 with a clear sentence", async () => {
    amenitySvc.catalog.mockResolvedValue({ amenities: [WIFI], proposals: [proposalRow()] });
    const view = await openDraft({ proposals: [proposalRow()] });
    await view.findByText("Phòng boxing");
    amenitySvc.cancelProposal.mockRejectedValue(err(409, "PROPOSAL_ALREADY_DECIDED"));
    await press(view.getByText("Huỷ đề xuất"));
    await pressAlert("Huỷ đề xuất");
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/đã được Gymini xử lý/), "danger"));
  });

  it("amenities switched off in the catalogue: a notice with 'Đề xuất bật lại' that creates a REENABLE proposal", async () => {
    const view = await openDraft({
      amenities: [WIFI, SAUNA_OFF],
      openRevision: revision({ systemAdjustments: [{ type: "AMENITY_DISABLED_REMOVED", amenityId: SAUNA_OFF.id, name: "Xông hơi" }] }),
    });
    expect(view.getByText("Một số tiện ích đã ngừng trong danh mục")).toBeTruthy();
    expect(view.getByText("Xông hơi")).toBeTruthy();
    amenitySvc.propose.mockResolvedValue({ kind: "REENABLE", created: true, proposal: proposalRow({ kind: "REENABLE", targetAmenityId: SAUNA_OFF.id, name: "Xông hơi", suggestedCategory: "RECOVERY" }) });
    await press(view.getByText("Đề xuất bật lại"));
    expect(amenitySvc.propose).toHaveBeenCalledWith({ gymId: G, name: "Xông hơi", suggestedCategory: "RECOVERY" });
  });

  it("once a REENABLE request is waiting, the button gives way to a sentence", async () => {
    const waiting = proposalRow({ kind: "REENABLE", targetAmenityId: SAUNA_OFF.id, name: "Xông hơi", suggestedCategory: "RECOVERY" });
    amenitySvc.catalog.mockResolvedValue({ amenities: [WIFI], proposals: [waiting] });
    const view = await openDraft({
      amenities: [WIFI, SAUNA_OFF],
      proposals: [waiting],
      openRevision: revision({ systemAdjustments: [{ type: "AMENITY_DISABLED_REMOVED", amenityId: SAUNA_OFF.id, name: "Xông hơi" }] }),
    });
    expect(await view.findByText("Đã gửi đề xuất bật lại")).toBeTruthy();
    expect(view.queryByText("Đề xuất bật lại")).toBeNull();
  });
});

describe("submit", () => {
  it("is refused client-side with no amenity at all; with one, it saves then submits with the NEW version", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({}, { amenityIds: [], proposalIds: [] }) }));
    const view = await renderScreen();
    await view.findByText("Gửi duyệt");
    await press(view.getByText("Gửi duyệt"));
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/ít nhất một tiện ích/), "danger");
    expect(alertSpy).not.toHaveBeenCalled();

    await press(view.getByLabelText("Wifi miễn phí"));
    echoSave();
    svc.submit.mockResolvedValue({ revision: revision({ status: "PENDING" }) });
    await press(view.getByText("Gửi duyệt"));
    expect(lastAlert()[0]).toBe("Gửi duyệt bản sửa?");
    await pressAlert("Gửi duyệt");
    expect(svc.saveDraft).toHaveBeenCalledTimes(1);
    expect(svc.submit).toHaveBeenCalledWith(G, { expectedDraftVersion: 3 });
  });

  it("422 AMENITIES_REQUIRED from the server is shown, not swallowed", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    svc.submit.mockRejectedValue(err(422, "AMENITIES_REQUIRED"));
    const view = await renderScreen();
    await view.findByText("Gửi duyệt");
    await press(view.getByText("Gửi duyệt"));
    await pressAlert("Gửi duyệt");
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/ít nhất một tiện ích/), "danger"));
  });

  it("409 AMENITY_DISABLED at submit offers 'Bỏ và gửi lại': it drops those amenities, saves, and submits again", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({}, { amenityIds: [WIFI.id, SAUNA_OFF.id] }), amenities: [WIFI, SAUNA_OFF] }));
    svc.submit.mockRejectedValueOnce(err(409, "AMENITY_DISABLED", { amenities: [{ id: SAUNA_OFF.id, name: "Xông hơi" }] }));
    echoSave();
    const view = await renderScreen();
    await view.findByText("Gửi duyệt");
    await press(view.getByText("Gửi duyệt"));
    await pressAlert("Gửi duyệt");
    expect(lastAlert()[0]).toBe("Có tiện ích đã ngừng");
    svc.submit.mockResolvedValueOnce({ revision: revision({ status: "PENDING" }) });
    await pressAlert("Bỏ và gửi lại");
    await waitFor(() => expect(svc.submit).toHaveBeenCalledTimes(2));
    expect(svc.saveDraft.mock.calls.at(-1)![1].payload.amenityIds).toEqual([WIFI.id]);
    expect(svc.submit.mock.calls[1][1]).toEqual({ expectedDraftVersion: expect.any(Number) });
  });

  it("409 DRAFT_STALE opens the reload-or-overwrite dialog; 409 LISTING_STALE the rebase dialog", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Gửi duyệt");
    await press(view.getByLabelText("Tạ tự do"));
    svc.saveDraft.mockRejectedValueOnce(err(409, "DRAFT_STALE", { revision: revision({ draftVersion: 5 }, { description: "Của thiết bị khác" }) }));
    await press(view.getByText("Lưu nháp"));
    expect(lastAlert()[0]).toBe("Bản nháp đã thay đổi");
    await pressAlert("Tải bản mới nhất");
    expect(view.getByDisplayValue("Của thiết bị khác")).toBeTruthy();

    svc.submit.mockRejectedValueOnce(err(409, "LISTING_STALE", { revision: revision({ stale: true }) }));
    await press(view.getByText("Gửi duyệt"));
    await pressAlert("Gửi duyệt");
    expect(lastAlert()[0]).toBe("Tin đăng đã thay đổi");
    svc.rebase.mockResolvedValue({ revision: revision({ draftVersion: 6, baseVersion: 4 }) });
    await pressAlert("Cập nhật theo bản mới");
    expect(svc.rebase).toHaveBeenCalledWith(G, { expectedDraftVersion: expect.any(Number) });
  });
});

describe("photos: 20 per branch, order, cover, upload retry", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => P(i + 1));
  const withPhotos = (n: number) =>
    listing({ openRevision: revision({}, {}, ids(n)), photos: ids(n).map((_, i) => photoRow(i + 1)) });

  it("a 21st photo is refused with a clear message, and the picker never opens", async () => {
    svc.get.mockResolvedValue(withPhotos(20));
    const view = await renderScreen();
    await view.findByText("Ảnh chi nhánh 20/20");
    expect(view.getByText(/Đã đủ 20\/20 ảnh/)).toBeTruthy();
    await press(view.getByText("Thêm ảnh"));
    expect(pick).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/tối đa 20 ảnh/), "danger");
  });

  it("the picker is asked for exactly the room left", async () => {
    svc.get.mockResolvedValue(withPhotos(2));
    pick.mockResolvedValue([]);
    const view = await renderScreen();
    await view.findByText("Ảnh chi nhánh 2/20");
    await press(view.getByText("Thêm ảnh"));
    expect(pick).toHaveBeenCalledWith(18, 8 * 1024 * 1024);
  });

  it("↑ / ↓ reorder and the new order is what gets saved; the first has no ↑, the last no ↓", async () => {
    svc.get.mockResolvedValue(withPhotos(2));
    const view = await renderScreen();
    await view.findByText("Ảnh chi nhánh 2/20");
    await press(view.getByLabelText("Đưa ảnh 1 lên"));
    await press(view.getByLabelText("Đưa ảnh 2 xuống"));
    expect(view.getByText("Đã lưu")).toBeTruthy(); // still clean: nothing moved
    await press(view.getByLabelText("Đưa ảnh 2 lên"));
    await press(view.getAllByText("Đặt làm bìa")[0]);
    echoSave();
    await press(view.getByText("Lưu nháp"));
    const body = svc.saveDraft.mock.calls[0][1];
    expect(body.payload.photoIds).toEqual([P(2), P(1)]);
    expect(body.payload.coverPhotoId).toBe(P(2));
    expect(body.expectedDraftVersion).toBe(2);
  });

  it("an upload that fails shows the reason and Thử lại; the retry attaches the photo", async () => {
    svc.get.mockResolvedValue(withPhotos(2));
    pick.mockResolvedValue([{ uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg", isImage: true }]);
    upload.mockRejectedValueOnce({ original: err(422, "IMAGE_TOO_LARGE"), message: "x" });
    const view = await renderScreen();
    await view.findByText("Ảnh chi nhánh 2/20");
    await press(view.getByText("Thêm ảnh"));
    expect(await view.findByText("Chưa tải được a.jpg")).toBeTruthy();
    expect(view.getByText(/vượt quá 8 MB/)).toBeTruthy();

    upload.mockResolvedValueOnce({ photo: { id: P(3), status: "STAGED", url: "https://s3.example/3?sig=1", expiresAt: "2026-10-20T01:00:00.000Z", isCover: false, sortOrder: 0 }, deduplicated: false });
    await press(view.getByText("Thử lại"));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1][0]).toBe(G);
    expect(await view.findByText("Ảnh chi nhánh 3/20")).toBeTruthy();
  });

  it("deleting a not-yet-public photo asks first, calls the gym route, and keeps the version in step", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({}, {}, [P(1), P(2)]), photos: [photoRow(1), photoRow(2, "STAGED")] }));
    svc.deletePhoto.mockResolvedValue({ deleted: true });
    const view = await renderScreen();
    await view.findByText("Ảnh chi nhánh 2/20");
    await press(view.getAllByText("Xóa ảnh")[0]);
    expect(lastAlert()[0]).toBe("Xóa ảnh này?");
    await pressAlert("Xóa ảnh");
    expect(svc.deletePhoto).toHaveBeenCalledWith(G, P(2));
    expect(await view.findByText("Ảnh chi nhánh 1/20")).toBeTruthy();
  });
});

describe("preview", () => {
  it("saves first, then reads the preview and draws amenities with their icons and pending ones as 'chờ duyệt'", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    svc.preview.mockResolvedValue({
      isPreview: true,
      revisionStatus: "DRAFT",
      name: "Gymini Quận 1",
      address: "1 Lê Lợi",
      city: null,
      description: "Phòng tập hiện đại",
      amenities: [{ id: WIFI.id, slug: "WIFI", name: "Wifi miễn phí", category: "FACILITY", iconKey: "wifi", disabled: false }],
      pendingAmenities: [{ proposalId: P(90), name: "Phòng boxing", suggestedCategory: "TRAINING_ZONE", kind: "NEW" }],
      photos: [],
      coverPhotoUrl: null,
      photoUrlsExpireAt: null,
    });
    const view = await renderScreen();
    await view.findByText("Gửi duyệt");
    await press(view.getByLabelText("Tạ tự do"));
    echoSave();
    await press(view.getByText("Xem trước"));
    expect(svc.saveDraft).toHaveBeenCalledTimes(1);
    expect(await view.findByText("Phòng boxing · chờ duyệt")).toBeTruthy();
  });
});
