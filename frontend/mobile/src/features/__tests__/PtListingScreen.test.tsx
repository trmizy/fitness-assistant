import { Alert } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { PtListingScreen } from "../ptListing/PtListingScreen";
import { ptListingService, uploadPtPhysiquePhoto } from "../../services/api";
import { pickImages } from "../../lib/pickFile";
import { LISTING_ERROR_VI } from "../ptListing/ptListing";

/**
 * Phase M1 — the PT "Tin đăng" screen, state by state. The service layer is mocked at the HTTP-wrapper
 * boundary (`ptListingService`, `uploadPtPhysiquePhoto`), so what runs for real is everything the screen
 * decides: which state it shows, what it sends (`expectedDraftVersion`, the payload), and how it answers
 * a 409. Server shapes are the ones in pt-listing.service.ts / pt-listing.schemas.ts.
 *
 * Evidence label: TEST FIXTURE (jest-expo component test) — not a real-browser or real-device run.
 */

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true } }));

jest.mock("../../context/AppContext", () => ({ useApp: () => ({ user: { id: "pt-1" } }) }));

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
    uploadPtPhysiquePhoto: jest.fn(),
    ptListingService: {
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

const svc = ptListingService as unknown as Record<string, jest.Mock>;
const upload = uploadPtPhysiquePhoto as jest.Mock;
const pick = pickImages as jest.Mock;

const P = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const profile = (over: Record<string, unknown> = {}) => ({
  professionalBio: "Huấn luyện viên 6 năm kinh nghiệm",
  mainSpecialties: ["Tăng cơ"],
  trainingMethodsApproach: null,
  targetClientGroups: [],
  primaryTrainingGoals: [],
  languages: ["Tiếng Việt"],
  websiteUrl: null,
  linkedinUrl: null,
  ...over,
});

const payload = (photoIds: string[] = [P(1), P(2)], over: Record<string, unknown> = {}) => ({
  profile: profile(),
  packages: [
    { id: "pkg-1", name: "Gói 10 buổi", description: null, price: 2000000, sessionCount: 10, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 90, isActive: true },
  ],
  photoIds,
  coverPhotoId: photoIds[0] ?? null,
  ...over,
});

const revision = (over: Record<string, unknown> = {}, photoIds?: string[]) => ({
  id: "rev-1",
  status: "DRAFT",
  source: "OWNER",
  parentRevisionId: null,
  baseVersion: 3,
  draftVersion: 2,
  payload: payload(photoIds),
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
  url: status === "PUBLISHED" ? `/media/pt-physique/${P(n)}` : `https://s3.example/${n}?sig=1`,
  expiresAt: status === "PUBLISHED" ? null : "2026-10-20T01:00:00.000Z",
  isCover: n === 1,
  sortOrder: n - 1,
});

const listing = (over: Record<string, unknown> = {}) => ({
  listingVersion: 3,
  listingPublishedAt: "2026-10-01T00:00:00.000Z",
  published: {
    payload: payload([P(1)]),
    packages: [{ id: "pkg-1", name: "Gói 10 buổi", description: null, price: "2000000", sessionCount: 10, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 90, isActive: true, version: 4 }],
    photos: [{ id: P(1), url: `/media/pt-physique/${P(1)}`, isCover: true, sortOrder: 0 }],
  },
  openRevision: null,
  photos: [photoRow(1), photoRow(2)],
  history: [],
  limits: { maxPhotos: 5, maxPackages: 10, maxStagedPhotos: 15 },
  ...over,
});

const err = (status: number, code: string, message = "msg", extra: Record<string, unknown> = {}) => ({
  response: { status, data: { success: false, error: { code, message }, message, ...extra } },
});

let client: QueryClient;
let alertSpy: jest.SpyInstance;

async function renderScreen() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <PtListingScreen />
    </QueryClientProvider>,
  );
}

async function press(el: any) {
  await act(async () => {
    fireEvent.press(el);
  });
}

/** Presses a button of the last Alert.alert (a native dialog has no tree to query). */
async function pressAlert(label: string) {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  expect(call).toBeTruthy();
  const button = (call[2] as { text: string; onPress?: () => void }[]).find((b) => b.text === label);
  expect(button).toBeTruthy();
  await act(async () => {
    button!.onPress?.();
  });
}

/** Answers a save like the server does: the payload as sent (already normalized), draftVersion + 1. */
function echoSave(once = false) {
  const impl = async (body: any) => ({ revision: revision({ draftVersion: body.expectedDraftVersion + 1, payload: body.payload }) });
  if (once) svc.saveDraft.mockImplementationOnce(impl);
  else svc.saveDraft.mockImplementation(impl);
}

const lastAlert = () => alertSpy.mock.calls[alertSpy.mock.calls.length - 1];

beforeEach(() => {
  jest.clearAllMocks();
  Object.values(svc).forEach((fn) => fn.mockReset());
  upload.mockReset();
  pick.mockReset();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

describe("status states", () => {
  it("nothing open: shows the published listing and offers to start a draft", async () => {
    svc.get.mockResolvedValue(listing());
    svc.createDraft.mockResolvedValue({ revision: revision() });
    const view = await renderScreen();
    expect(await view.findByText("Đang hiển thị với khách")).toBeTruthy();
    expect(view.queryByText("Lưu nháp")).toBeNull();
    // from now on the server holds the draft (the screen re-reads after a decision)
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));

    await press(view.getByText("Soạn bản sửa mới"));
    expect(svc.createDraft).toHaveBeenCalledWith({});
    expect(await view.findByText("Đang soạn")).toBeTruthy();
    expect(view.getByText("Gói 10 buổi")).toBeTruthy();
  });

  it("Chờ duyệt: read-only — no editor, no Lưu nháp, but the trainer can withdraw", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({ status: "PENDING", submittedAt: "2026-10-19T00:00:00.000Z" }) }));
    const view = await renderScreen();
    expect(await view.findByText("Chờ duyệt")).toBeTruthy();
    expect(view.queryByText("Lưu nháp")).toBeNull();
    expect(view.queryByText("Gửi duyệt")).toBeNull();
    expect(view.queryByText("Thêm ảnh")).toBeNull();
    expect(view.getByText("Rút lại để sửa tiếp")).toBeTruthy();

    svc.withdraw.mockResolvedValue({ withdrawnRevisionId: "rev-1", revision: revision({ id: "rev-2", draftVersion: 1, parentRevisionId: "rev-1" }) });
    svc.get.mockResolvedValue(listing({ openRevision: revision({ id: "rev-2", draftVersion: 1, parentRevisionId: "rev-1" }) }));
    await press(view.getByText("Rút lại để sửa tiếp"));
    expect(lastAlert()[0]).toBe("Rút lại bản sửa?");
    await pressAlert("Rút lại");
    expect(svc.withdraw).toHaveBeenCalledTimes(1);
    expect(await view.findByText("Gửi duyệt")).toBeTruthy(); // back to an editable draft
    expect(view.getByText("Đang soạn")).toBeTruthy();
  });

  it("Cần chỉnh sửa: shows the admin's note and the editor", async () => {
    svc.get.mockResolvedValue(
      listing({ openRevision: revision({ parentRevisionId: "rev-0", reviewNote: "Ảnh số 2 chưa phù hợp, vui lòng thay" }) }),
    );
    const view = await renderScreen();
    expect(await view.findByText("Cần chỉnh sửa")).toBeTruthy();
    expect(view.getByText("Ghi chú của quản trị viên")).toBeTruthy();
    expect(view.getByText("Ảnh số 2 chưa phù hợp, vui lòng thay")).toBeTruthy();
    expect(view.getByText("Gửi duyệt")).toBeTruthy();
  });

  it("Bị từ chối: shows the reason, keeps the published listing, and can copy the rejected revision", async () => {
    svc.get.mockResolvedValue(
      listing({ history: [{ id: "rev-9", status: "REJECTED", reviewNote: "Nội dung quảng cáo quá đà", reviewedAt: new Date().toISOString(), closedAt: new Date().toISOString() }] }),
    );
    const view = await renderScreen();
    expect(await view.findByText("Bị từ chối")).toBeTruthy();
    expect(view.getByText("Nội dung quảng cáo quá đà")).toBeTruthy();
    expect(view.getByText("Đang hiển thị với khách")).toBeTruthy();

    svc.createDraft.mockResolvedValue({ revision: revision({ parentRevisionId: "rev-9" }) });
    await press(view.getByText("Soạn lại từ bản bị từ chối"));
    expect(svc.createDraft).toHaveBeenCalledWith({ copyFromRevisionId: "rev-9" });
  });

  it("Đã duyệt: announces the decision", async () => {
    svc.get.mockResolvedValue(listing({ history: [{ id: "rev-9", status: "APPROVED", reviewNote: null, reviewedAt: new Date().toISOString() }] }));
    const view = await renderScreen();
    expect(await view.findByText("Đã duyệt")).toBeTruthy();
    expect(view.getByText("Soạn bản sửa mới")).toBeTruthy();
  });

  it("a draft whose public listing moved offers 'Cập nhật theo bản mới', and rebase carries expectedDraftVersion", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({ stale: true }) }));
    svc.rebase.mockResolvedValue({ revision: revision({ draftVersion: 3, stale: false, baseVersion: 4 }) });
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await press(view.getByText("Cập nhật theo bản mới"));
    expect(svc.rebase).toHaveBeenCalledWith({ expectedDraftVersion: 2 });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith("Đã cập nhật bản nháp theo tin đăng mới", "success"));
  });

  it("a load failure is a retryable state, not a blank screen", async () => {
    svc.get.mockRejectedValue(err(503, "UNAVAILABLE"));
    const view = await renderScreen();
    expect(await view.findByText("Không tải được tin đăng")).toBeTruthy();
    svc.get.mockResolvedValue(listing());
    await press(view.getByText("Thử lại"));
    expect(await view.findByText("Đang hiển thị với khách")).toBeTruthy();
  });
});

describe("saving and photo order", () => {
  it("↑ moves a photo up; saving sends the new order with expectedDraftVersion", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 2/5");

    expect(view.getByText("Đã lưu")).toBeTruthy(); // nothing to save yet
    await press(view.getByLabelText("Đưa ảnh 2 lên"));
    expect(view.getByText("Lưu nháp")).toBeTruthy();

    echoSave();
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft).toHaveBeenCalledTimes(1);
    const body = svc.saveDraft.mock.calls[0][0];
    expect(body.expectedDraftVersion).toBe(2);
    expect(body.payload.photoIds).toEqual([P(2), P(1)]);
    expect(Object.keys(body.payload).sort()).toEqual(["coverPhotoId", "packages", "photoIds", "profile"]);
    await waitFor(() => expect(view.getByText("Đã lưu")).toBeTruthy());

    // the next save uses the NEW version the server answered
    await press(view.getByLabelText("Đưa ảnh 1 xuống"));
    echoSave();
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft.mock.calls[1][0].expectedDraftVersion).toBe(3);
  });

  it("↓ on the last photo and ↑ on the first are disabled (nothing to move)", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 2/5");
    await press(view.getByLabelText("Đưa ảnh 1 lên"));
    await press(view.getByLabelText("Đưa ảnh 2 xuống"));
    expect(view.getByText("Đã lưu")).toBeTruthy(); // still clean: nothing moved
  });

  it("'Đặt làm bìa' changes the cover that is sent", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 2/5");
    await press(view.getAllByText("Đặt làm bìa")[0]); // only photo 2 offers it (photo 1 is the cover)
    echoSave();
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft.mock.calls[0][0].payload.coverPhotoId).toBe(P(2));
  });
});

describe("photos: the 5-photo limit and uploads", () => {
  const fiveListing = () => {
    const ids = [P(1), P(2), P(3), P(4), P(5)];
    return listing({ openRevision: revision({}, ids), photos: ids.map((_, i) => photoRow(i + 1)) });
  };

  it("a 6th photo is refused with a clear message, and the picker never opens", async () => {
    svc.get.mockResolvedValue(fiveListing());
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 5/5");
    expect(view.getByText(/Đã đủ 5\/5 ảnh/)).toBeTruthy();

    await press(view.getByText("Thêm ảnh"));
    expect(pick).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/tối đa 5 ảnh hình thể/), "danger");
  });

  it("the picker is asked for exactly the room left", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    pick.mockResolvedValue([]);
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 2/5");
    await press(view.getByText("Thêm ảnh"));
    expect(pick).toHaveBeenCalledWith(3, 8 * 1024 * 1024);
  });

  it("upload fails → the photo stays as a failed row; 'Thử lại' uploads it again and the photo joins the draft", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const file = { uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg", isImage: true };
    pick.mockResolvedValue([file]);
    upload.mockRejectedValueOnce(Object.assign(new Error("Không gửi được ảnh lên — kiểm tra kết nối rồi thử lại."), { step: "upload" }));
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 2/5");

    await press(view.getByText("Thêm ảnh"));
    expect(await view.findByText("Chưa tải được a.jpg")).toBeTruthy();
    expect(view.getByText(/kiểm tra kết nối/)).toBeTruthy();
    expect(view.getByText("Ảnh hình thể 2/5")).toBeTruthy(); // nothing was added

    upload.mockResolvedValueOnce({ photo: { id: P(3), status: "STAGED", url: "https://s3.example/3?sig=1", expiresAt: "2026-10-20T01:00:00.000Z", isCover: false, sortOrder: 0 }, deduplicated: false });
    await press(view.getByText("Thử lại"));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenLastCalledWith(file);
    expect(await view.findByText("Ảnh hình thể 3/5")).toBeTruthy();
    expect(view.queryByText("Chưa tải được a.jpg")).toBeNull();
    expect(view.getByText("Chưa công khai")).toBeTruthy(); // STAGED badge on the new photo

    echoSave();
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft.mock.calls[0][0].payload.photoIds).toEqual([P(1), P(2), P(3)]);
  });

  it("a server refusal at confirm (e.g. a corrupt image) shows its Vietnamese sentence, not a generic error", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    pick.mockResolvedValue([{ uri: "file:///b.jpg", name: "b.jpg", type: "image/jpeg", isImage: true }]);
    upload.mockRejectedValueOnce(Object.assign(new Error("Máy chủ chưa xác nhận được ảnh."), { step: "confirm", original: err(422, "IMAGE_INVALID") }));
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 2/5");
    await press(view.getByText("Thêm ảnh"));
    expect(await view.findByText(LISTING_ERROR_VI.IMAGE_INVALID)).toBeTruthy();
  });

  it("'Bỏ' drops a failed upload without retrying it", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    pick.mockResolvedValue([{ uri: "file:///c.jpg", name: "c.jpg", type: "image/jpeg", isImage: true }]);
    upload.mockRejectedValueOnce(Object.assign(new Error("Không gửi được ảnh lên — kiểm tra kết nối rồi thử lại."), { step: "upload" }));
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 2/5");
    await press(view.getByText("Thêm ảnh"));
    await press(await view.findByText("Bỏ"));
    expect(view.queryByText("Chưa tải được c.jpg")).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("deleting a STAGED photo asks first, calls the API, and the next save expects the version the server bumped", async () => {
    // photo 2 is STAGED and part of the SAVED draft → the server bumps draftVersion by one on delete
    svc.get.mockResolvedValue(listing({ openRevision: revision(), photos: [photoRow(1), photoRow(2, "STAGED")] }));
    const view = await renderScreen();
    await view.findByText("Ảnh hình thể 2/5");

    await press(view.getByText("Xóa ảnh"));
    expect(lastAlert()[0]).toBe("Xóa ảnh này?");
    svc.deletePhoto.mockResolvedValue({ deleted: true });
    svc.get.mockResolvedValue(listing({ openRevision: revision({ draftVersion: 3 }, [P(1)]), photos: [photoRow(1)] }));
    await pressAlert("Xóa ảnh");
    expect(svc.deletePhoto).toHaveBeenCalledWith(P(2));
    expect(await view.findByText("Ảnh hình thể 1/5")).toBeTruthy();
    // Our own delete moved the server to 3; that is NOT a conflict, so no dialog.
    expect(alertSpy).toHaveBeenCalledTimes(1);

    // edit something and save: the version sent is 3 (what the server holds now), not the stale 2
    await act(async () => {
      fireEvent.changeText(view.getByDisplayValue("Huấn luyện viên 6 năm kinh nghiệm"), "Đã chỉnh");
    });
    echoSave();
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft.mock.calls[0][0].expectedDraftVersion).toBe(3);
  });
});

describe("409 dialogs", () => {
  async function editBio(view: any, text: string) {
    await act(async () => {
      fireEvent.changeText(view.getByDisplayValue("Huấn luyện viên 6 năm kinh nghiệm"), text);
    });
  }

  it("DRAFT_STALE on save: offers reload vs overwrite — 'Ghi đè' resends with the server's version", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await editBio(view, "Bản của tôi");

    const serverDraft = revision({ draftVersion: 5, payload: payload([P(1), P(2)], { profile: profile({ professionalBio: "Bản từ máy khác" }) }) });
    svc.saveDraft.mockRejectedValueOnce(err(409, "DRAFT_STALE", "english", { revision: serverDraft, listingVersion: 3 }));
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft.mock.calls[0][0].expectedDraftVersion).toBe(2);
    expect(lastAlert()[0]).toBe("Bản nháp đã thay đổi");
    expect(lastAlert()[1]).toContain(LISTING_ERROR_VI.DRAFT_STALE);
    expect((lastAlert()[2] as any[]).map((b) => b.text)).toEqual(["Tải bản mới nhất", "Ghi đè bằng bản của tôi"]);

    echoSave(true);
    await pressAlert("Ghi đè bằng bản của tôi");
    await waitFor(() => expect(svc.saveDraft).toHaveBeenCalledTimes(2));
    const second = svc.saveDraft.mock.calls[1][0];
    expect(second.expectedDraftVersion).toBe(5);
    expect(second.payload.profile.professionalBio).toBe("Bản của tôi");
  });

  it("DRAFT_STALE on save: 'Tải bản mới nhất' replaces the form with the server's draft and sends nothing", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await editBio(view, "Bản của tôi");

    const serverDraft = revision({ draftVersion: 5, payload: payload([P(1), P(2)], { profile: profile({ professionalBio: "Bản từ máy khác" }) }) });
    svc.saveDraft.mockRejectedValueOnce(err(409, "DRAFT_STALE", "x", { revision: serverDraft, listingVersion: 3 }));
    await press(view.getByText("Lưu nháp"));
    await pressAlert("Tải bản mới nhất");
    expect(await view.findByDisplayValue("Bản từ máy khác")).toBeTruthy();
    expect(svc.saveDraft).toHaveBeenCalledTimes(1);
    expect(view.getByText("Đã lưu")).toBeTruthy();
  });

  it("the draft moved on the server while the trainer has unsaved edits (another phone): asks, never overwrites silently", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await editBio(view, "Bản của tôi chưa lưu");

    // a refetch (pull to refresh, push, coming back to the app) brings a draft this phone did not write
    const moved = revision({ draftVersion: 7, payload: payload([P(1), P(2)], { profile: profile({ professionalBio: "Bản từ máy khác" }) }) });
    svc.get.mockResolvedValue(listing({ openRevision: moved }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["pt-listing", "pt-1"] });
    });
    await waitFor(() => expect(alertSpy).toHaveBeenCalledTimes(1));
    expect(lastAlert()[0]).toBe("Bản nháp đã thay đổi");
    expect(svc.saveDraft).not.toHaveBeenCalled(); // the trainer has not been overwritten OR overwriting
    expect(view.getByDisplayValue("Bản của tôi chưa lưu")).toBeTruthy(); // their edits are still on screen

    echoSave(true);
    await pressAlert("Ghi đè bằng bản của tôi");
    await waitFor(() => expect(svc.saveDraft).toHaveBeenCalledTimes(1));
    expect(svc.saveDraft.mock.calls[0][0].expectedDraftVersion).toBe(7);
    expect(svc.saveDraft.mock.calls[0][0].payload.profile.professionalBio).toBe("Bản của tôi chưa lưu");
  });

  it("with NO unsaved edits, a draft that moved elsewhere is simply shown (nothing to protect)", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    const moved = revision({ draftVersion: 7, payload: payload([P(1), P(2)], { profile: profile({ professionalBio: "Bản từ máy khác" }) }) });
    svc.get.mockResolvedValue(listing({ openRevision: moved }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["pt-listing", "pt-1"] });
    });
    expect(await view.findByDisplayValue("Bản từ máy khác")).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("LISTING_STALE on submit: offers 'Cập nhật theo bản mới' (rebase) or keep editing", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");

    await press(view.getByText("Gửi duyệt"));
    expect(lastAlert()[0]).toBe("Gửi duyệt bản sửa?");
    svc.submit.mockRejectedValueOnce(err(409, "LISTING_STALE", "x", { revision: revision({ stale: true }), listingVersion: 4 }));
    await pressAlert("Gửi duyệt");
    expect(svc.submit).toHaveBeenCalledWith({ expectedDraftVersion: 2 });

    expect(lastAlert()[0]).toBe("Tin đăng đã thay đổi");
    expect((lastAlert()[2] as any[]).map((b) => b.text)).toEqual(["Tiếp tục sửa", "Cập nhật theo bản mới"]);

    svc.rebase.mockResolvedValue({ revision: revision({ draftVersion: 3, baseVersion: 4 }) });
    await pressAlert("Cập nhật theo bản mới");
    await waitFor(() => expect(svc.rebase).toHaveBeenCalledWith({ expectedDraftVersion: 2 }));
  });

  it("submit with unsaved edits saves first and submits the version the save returned", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await editBio(view, "Bản sửa trước khi gửi");

    echoSave();
    svc.submit.mockResolvedValue({ revision: revision({ status: "PENDING", draftVersion: 3 }) });
    await press(view.getByText("Gửi duyệt"));
    await pressAlert("Gửi duyệt");
    await waitFor(() => expect(svc.submit).toHaveBeenCalledTimes(1));
    expect(svc.saveDraft.mock.calls[0][0].expectedDraftVersion).toBe(2);
    expect(svc.submit).toHaveBeenCalledWith({ expectedDraftVersion: 3 });
  });

  it("DRAFT_STALE on submit goes through the same reload / overwrite dialog", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await press(view.getByText("Gửi duyệt"));
    svc.submit.mockRejectedValueOnce(err(409, "DRAFT_STALE", "x", { revision: revision({ draftVersion: 9 }), listingVersion: 3 }));
    await pressAlert("Gửi duyệt");
    expect(lastAlert()[0]).toBe("Bản nháp đã thay đổi");
  });

  it("REVISION_UNDER_REVIEW (submitted from another phone) is a message and a reload, not a dialog", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await editBio(view, "x");
    svc.saveDraft.mockRejectedValueOnce(err(409, "REVISION_UNDER_REVIEW", "english", { revision: revision({ status: "PENDING" }), listingVersion: 3 }));
    await press(view.getByText("Lưu nháp"));
    expect(mockToast).toHaveBeenCalledWith(LISTING_ERROR_VI.REVISION_UNDER_REVIEW, "danger");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("client-side validation stops a bad draft before the round trip", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText("https://"), "example.com");
    });
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.stringMatching(/http/), "danger");
  });
});

describe("decisions refresh what clients read", () => {
  it("submitting invalidates the trainer's own keys AND the public PT keys", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    const spy = jest.spyOn(client, "invalidateQueries");

    svc.submit.mockResolvedValue({ revision: revision({ status: "PENDING" }) });
    await press(view.getByText("Gửi duyệt"));
    await pressAlert("Gửi duyệt");
    await waitFor(() => expect(svc.submit).toHaveBeenCalled());

    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as any).queryKey));
    for (const expected of ['["pt-listing","pt-1"]', '["pts-list"]', '["pts-list-pages"]', '["pt-detail","pt-1"]', '["pt-packages","pt-1"]']) {
      expect(keys).toContain(expected);
    }
  });

  it("discarding a draft asks first, and the screen goes back to the published listing", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await press(view.getByText("Bỏ nháp"));
    expect(lastAlert()[0]).toBe("Bỏ bản nháp?");
    svc.discard.mockResolvedValue({ discardedRevisionId: "rev-1" });
    svc.get.mockResolvedValue(listing());
    await pressAlert("Bỏ nháp");
    expect(svc.discard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(view.queryByText("Lưu nháp")).toBeNull());
    expect(view.getByText("Soạn bản sửa mới")).toBeTruthy();
  });
});

describe("packages inside the draft", () => {
  it("'Ngừng bán' marks an existing package and saving sends archive:true with its id", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Gói 10 buổi");
    await press(view.getByText("Ngừng bán"));
    expect(view.getByText("Sẽ ngừng bán khi được duyệt")).toBeTruthy();

    echoSave();
    await press(view.getByText("Lưu nháp"));
    const [pkg] = svc.saveDraft.mock.calls[0][0].payload.packages;
    expect(pkg.id).toBe("pkg-1");
    expect(pkg.archive).toBe(true);
  });

  it("'Hoàn tác' puts it back", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    const view = await renderScreen();
    await view.findByText("Gói 10 buổi");
    await press(view.getByText("Ngừng bán"));
    await press(view.getByText("Hoàn tác"));
    expect(view.getByText("Đã lưu")).toBeTruthy(); // back to what the server holds
  });
});

describe("preview", () => {
  const previewBody = (status: string) => ({
    isPreview: true,
    viewer: "OWNER",
    revisionId: "rev-1",
    revisionStatus: status,
    firstName: "Lan",
    lastName: "Trần",
    specialties: ["Tăng cơ"],
    ptApplication: { ...profile(), fromPricePerSession: 200000, fromPackagePrice: 2000000 },
    servicePackages: [{ id: "pkg-1", name: "Gói 10 buổi", price: 2000000, sessionCount: 10, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: null, isActive: true, isNew: false }],
    fromPricePerSession: 200000,
    fromPackagePrice: 2000000,
    physiquePhotos: [{ id: P(1), url: "https://s3.example/1?sig=1", expiresAt: "2026-10-20T01:00:00.000Z", isCover: true, sortOrder: 0, status: "STAGED" }],
    coverPhotoUrl: "https://s3.example/1?sig=1",
    photoUrlsExpireAt: "2026-10-20T01:00:00.000Z",
  });

  it("a pending revision can be previewed: the server's view, with prices", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({ status: "PENDING" }) }));
    svc.preview.mockResolvedValue(previewBody("PENDING"));
    const view = await renderScreen();
    await view.findByText("Chờ duyệt");
    await press(view.getByText("Xem bản đã gửi"));
    expect(await view.findByText("Lan Trần")).toBeTruthy();
    expect(view.getByText(/Từ 200\.000/)).toBeTruthy();
    expect(svc.preview).toHaveBeenCalledTimes(1);
  });

  it("previewing a draft with unsaved edits saves first, so the preview matches the screen", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision() }));
    svc.preview.mockResolvedValue(previewBody("DRAFT"));
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    await act(async () => {
      fireEvent.changeText(view.getByDisplayValue("Huấn luyện viên 6 năm kinh nghiệm"), "Mới");
    });
    echoSave();
    await press(view.getByText("Xem trước"));
    expect(svc.saveDraft).toHaveBeenCalledTimes(1);
    expect(await view.findByText("Lan Trần")).toBeTruthy();
    expect(svc.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(svc.preview.mock.invocationCallOrder[0]);
  });

  it("a failed preview says so and can be retried", async () => {
    svc.get.mockResolvedValue(listing({ openRevision: revision({ status: "PENDING" }) }));
    svc.preview.mockRejectedValueOnce(err(404, "NO_OPEN_REVISION"));
    const view = await renderScreen();
    await view.findByText("Chờ duyệt");
    await press(view.getByText("Xem bản đã gửi"));
    expect(await view.findByText(LISTING_ERROR_VI.NO_OPEN_REVISION)).toBeTruthy();
  });
});

describe("languages", () => {
  it("fixed chips; a saved value outside the list still shows selected; 'Khác' adds a custom chip that is saved", async () => {
    svc.get.mockResolvedValue(
      listing({ openRevision: revision({ payload: payload([P(1), P(2)], { profile: profile({ languages: ["Tiếng Việt", "Français"] }) }) }) }),
    );
    const view = await renderScreen();
    await view.findByText("Đang soạn");
    for (const l of ["Tiếng Việt", "English", "中文", "한국어", "日本語", "Khác", "Français"]) {
      expect(view.getByText(l)).toBeTruthy();
    }
    expect(view.getByText("2/10")).toBeTruthy(); // Tiếng Việt + Français selected

    await press(view.getByText("English")); // select a fixed chip
    await press(view.getByText("Khác"));
    await act(async () => {
      fireEvent.changeText(view.getByPlaceholderText("Ví dụ: Français"), "Deutsch");
    });
    await press(view.getByText("Thêm ngôn ngữ"));
    expect(view.getByText("Deutsch")).toBeTruthy();

    echoSave();
    await press(view.getByText("Lưu nháp"));
    expect(svc.saveDraft.mock.calls[0][0].payload.profile.languages).toEqual(["Tiếng Việt", "Français", "English", "Deutsch"]);
  });
});
