/**
 * Phase 12 cụm D — hồ sơ đối tác tự đăng ký (WB-15/16), giấy tờ (GY-09).
 *
 * Điểm cốt lõi được khẳng định ở đây: **máy chủ quyết định còn thiếu gì**. Mọi câu hỏi "bước nào
 * xong", "mở ra đứng ở đâu", "còn gì chặn nộp" đều suy từ `view.missing`, không từ một bộ kiểm hợp
 * lệ thứ hai ở máy.
 *
 * Chạy: npx tsx --test src/features/__tests__/partnerApplication.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DOC_TYPES,
  MAX_FILES_PER_DOCUMENT,
  PASSWORD_MIN,
  STEPS,
  applyEmailError,
  canAddDocumentFile,
  canResubmit,
  documentsToReplace,
  isChangesRequested,
  docStatus,
  documentFiles,
  extractApplyToken,
  findDocument,
  firstIncompleteStep,
  friendlyError,
  issueStatus,
  missingForStep,
  missingItems,
  newPasswordError,
  openIssues,
  progressPercent,
  stepDone,
  verifyResultText,
  type ApplicationView,
  readableServerMessage,
} from "../partnerApplication/partnerApplication";

const view = (missing: { section: any; message: string }[]): ApplicationView => ({ missing });

describe("máy chủ quyết định còn thiếu gì", () => {
  it("chín bước, đúng thứ tự, và bước mạng xã hội không bắt buộc", () => {
    assert.deepEqual(
      STEPS.map((s) => s.id),
      ["representative", "brand", "social", "scale", "branch", "location", "photos", "legal", "review"],
    );
    const social = STEPS.find((s) => s.id === "social")!;
    assert.equal(social.sections.length, 0);
    // Không có phần nào thì không bao giờ "còn thiếu" — bỏ trống vẫn nộp được.
    assert.equal(stepDone(view([{ section: "BRAND", message: "x" }]), social), true);
  });

  it("một bước xong khi máy chủ không còn kể mục nào thuộc phần của nó", () => {
    const v = view([{ section: "BRAND", message: "Chưa đặt tên thương hiệu" }]);
    assert.equal(stepDone(v, STEPS.find((s) => s.id === "brand")!), false);
    assert.equal(stepDone(v, STEPS.find((s) => s.id === "representative")!), true);
  });

  it("mở ra đứng ở bước đầu tiên còn thiếu; không thiếu gì thì về bước xem lại", () => {
    assert.equal(firstIncompleteStep(view([{ section: "REPRESENTATIVE", message: "x" }])), 0);
    assert.equal(firstIncompleteStep(view([{ section: "PHOTOS", message: "x" }])), 6);
    assert.equal(firstIncompleteStep(view([])), STEPS.length - 1);
    assert.equal(firstIncompleteStep(null), STEPS.length - 1);
    // Thiếu nhiều chỗ thì dừng ở chỗ SỚM nhất, không phải chỗ đầu tiên máy chủ liệt kê.
    assert.equal(
      firstIncompleteStep(view([{ section: "LEGAL", message: "x" }, { section: "BRAND", message: "y" }])),
      1,
    );
  });

  it("tiến độ tính trên tám bước nhập liệu, không tính bước xem lại", () => {
    assert.equal(progressPercent(view([])), 100);
    // Thiếu đúng một phần trong tám phần.
    assert.equal(progressPercent(view([{ section: "BRAND", message: "x" }])), 88);
    // TERMS thuộc bước xem lại, không phải một phần việc nhập liệu.
    assert.equal(progressPercent(view([{ section: "TERMS", message: "x" }])), 100);
  });

  it("mục còn thiếu hiện ngay tại bước sửa được nó", () => {
    const v = view([
      { section: "PHOTOS", message: "Cần thêm ảnh" },
      { section: "BRAND", message: "Chưa đặt tên" },
    ]);
    const photos = missingForStep(v, STEPS.find((s) => s.id === "photos")!);
    assert.deepEqual(photos.map((m) => m.message), ["Cần thêm ảnh"]);
    assert.equal(missingForStep(v, STEPS.find((s) => s.id === "social")!).length, 0);
  });

  it("dữ liệu méo không làm sập màn hình", () => {
    assert.deepEqual(missingItems(null), []);
    assert.deepEqual(missingItems({ missing: "hỏng" } as any), []);
    assert.deepEqual(missingItems({ missing: [{ message: "không có section" } as any] }), []);
  });
});

describe("giấy tờ (GY-09)", () => {
  const v: ApplicationView = {
    documents: [
      { docType: "BUSINESS_LICENSE", required: true, status: "RECEIVED", files: [{ id: "f1" }, { id: "f2" }] },
      { docType: "REPRESENTATIVE_ID", required: true, status: "REJECTED", reviewNote: "Ảnh mờ", files: [] },
      { notADoc: true } as any,
    ],
  };

  it("nhãn nói đúng nghĩa nghiệp vụ, không dịch thẳng tên enum", () => {
    // RECEIVED là "đã nộp, chờ duyệt"; REJECTED là "cần cập nhật" chứ không phải "bị loại".
    assert.equal(docStatus("RECEIVED").label, "Chờ duyệt");
    assert.equal(docStatus("REJECTED").label, "Cần cập nhật");
    assert.equal(docStatus("VERIFIED").label, "Đã xác minh");
    assert.equal(docStatus(null).label, "Chưa nộp");
  });

  it("tìm đúng giấy tờ và đếm đúng số tệp", () => {
    assert.equal(findDocument(v, "BUSINESS_LICENSE")?.status, "RECEIVED");
    assert.equal(findDocument(v, "SITE_PHOTOS"), null);
    assert.equal(documentFiles(findDocument(v, "BUSINESS_LICENSE")).length, 2);
    assert.equal(documentFiles(null).length, 0);
  });

  it("chặn thêm tệp khi đã chạm trần của máy chủ", () => {
    assert.equal(canAddDocumentFile(findDocument(v, "BUSINESS_LICENSE")), true);
    const full = { docType: "BUSINESS_LICENSE" as const, files: Array.from({ length: MAX_FILES_PER_DOCUMENT }, (_, i) => ({ id: `f${i}` })) };
    assert.equal(canAddDocumentFile(full), false);
    assert.equal(canAddDocumentFile(null), true, "chưa có giấy tờ thì đương nhiên thêm được");
  });

  it("ba loại giấy tờ bắt buộc đứng trước trong danh sách", () => {
    assert.deepEqual(
      DOC_TYPES.slice(0, 3).map((d) => d.value),
      ["BUSINESS_LICENSE", "REPRESENTATIVE_ID", "PREMISES_PROOF"],
    );
  });
});

describe("góp ý và gửi lại", () => {
  it("gửi lại chỉ mở khi MỌI góp ý đang mở đã được đánh dấu", () => {
    const open: ApplicationView = { issues: [{ id: "i1", status: "OPEN" }, { id: "i2", status: "RESUBMITTED" }] };
    assert.equal(openIssues(open).length, 1);
    assert.equal(canResubmit(open), false);

    const marked: ApplicationView = { issues: [{ id: "i1", status: "RESUBMITTED" }, { id: "i2", status: "RESOLVED" }] };
    assert.equal(canResubmit(marked), true);

    // Không có góp ý nào thì đây không phải luồng gửi lại.
    assert.equal(canResubmit({ issues: [] }), false);
    assert.equal(canResubmit(null), false);
  });

  it("giấy tờ bị yêu cầu nộp lại cũng chặn gửi lại, tới khi thay tệp (máy chủ: DOCUMENTS_NOT_REPLACED)", () => {
    const marked = [{ id: "i1", status: "RESUBMITTED" }];
    const stale: ApplicationView = {
      issues: marked,
      documents: [{ docType: "PREMISES_PROOF", status: "REJECTED", reviewNote: "Mờ" }, { docType: "BUSINESS_LICENSE", status: "VERIFIED" }],
    };
    assert.deepEqual(documentsToReplace(stale).map((d) => d.docType), ["PREMISES_PROOF"]);
    assert.equal(canResubmit(stale), false);

    // Thay tệp → máy chủ đưa về RECEIVED → mở.
    const replaced: ApplicationView = { issues: marked, documents: [{ docType: "PREMISES_PROOF", status: "RECEIVED" }] };
    assert.equal(canResubmit(replaced), true);

    // Chỉ yêu cầu nộp lại giấy tờ, không có góp ý chung: vẫn là vòng gửi lại.
    assert.equal(canResubmit({ issues: [], documents: [{ docType: "PREMISES_PROOF", status: "REJECTED" }] }), false);
    // ...và sau khi thay tệp xong thì phải gửi lại được, dù không còn dấu vết nào khác của vòng sửa.
    assert.equal(canResubmit({ accessState: "CHANGES_REQUESTED", issues: [], documents: [{ docType: "PREMISES_PROOF", status: "RECEIVED" }] }), true);
    assert.equal(isChangesRequested({ accessState: "CHANGES_REQUESTED" }), true);
    assert.equal(isChangesRequested({ accessState: "ONBOARDING" }), false);
  });

  it("nhãn trạng thái góp ý", () => {
    assert.equal(issueStatus("OPEN").label, "Đang mở");
    assert.equal(issueStatus("RESUBMITTED").label, "Đã gửi lại");
    assert.equal(issueStatus("RESOLVED").label, "Đã đóng");
    assert.equal(issueStatus("LẠ").label, "LẠ");
  });
});

describe("đăng ký công khai (WB-15)", () => {
  it("email và mật khẩu kiểm đúng luật máy chủ", () => {
    assert.equal(applyEmailError("ban@phonggym.vn"), null);
    assert.ok(applyEmailError(""));
    assert.ok(applyEmailError("không-phải-email"));

    // Máy chủ đòi tối thiểu 8 (`changePasswordSchema`); web ghi 6 ở màn tương đương — đó là chỗ web lệch.
    assert.equal(PASSWORD_MIN, 8);
    assert.equal(newPasswordError("matkhau123", "matkhau123"), null);
    assert.ok(newPasswordError("ngan", "ngan"));
    assert.ok(newPasswordError("matkhau123", "khac12345"));
  });

  it("mã xác minh lấy được từ fragment, từ query, và từ chuỗi dán trần", () => {
    const token = "qfaFz_FSXZGWNyXw18dPGWLyD4-Mh2-qSaifkqvKG04";
    // Dạng thật: mã ở FRAGMENT nên không đi lên máy chủ, không vào log.
    assert.equal(extractApplyToken(`https://gymini.vn/partner/apply/verify#token=${token}`), token);
    // Một số ứng dụng thư viết lại liên kết thành query.
    assert.equal(extractApplyToken(`https://gymini.vn/partner/apply/verify?token=${token}`), token);
    assert.equal(extractApplyToken(`fitnessassistant://partner/verify#token=${token}`), token);
    assert.equal(extractApplyToken(`  ${token}  `), token, "dán riêng mã cũng nhận");
    assert.equal(extractApplyToken("https://gymini.vn/partner/apply/verify#token=a%2Fb"), "a/b", "giải mã URL");
  });

  it("không nhận bừa một chuỗi bất kỳ làm mã", () => {
    assert.equal(extractApplyToken(""), null);
    assert.equal(extractApplyToken("chào bạn"), null, "có khoảng trắng thì không phải mã");
    assert.equal(extractApplyToken("ngan"), null, "quá ngắn");
    assert.equal(extractApplyToken("https://gymini.vn/partner/apply"), null, "liên kết không có mã");
  });

  it("mỗi kết quả xác minh có câu giải thích riêng, kể cả giá trị lạ", () => {
    for (const s of ["EXPIRED", "USED", "INVALID"]) {
      assert.ok(verifyResultText(s).title.length > 0, s);
      assert.notEqual(verifyResultText(s).title, s);
    }
    assert.match(verifyResultText("CHUYỆN_LẠ").title, /Không xác minh được/);
  });
});

describe("thông báo lỗi", () => {
  it("gom ba hình dạng lỗi backend về một câu tiếng Việt", () => {
    // gym-service
    assert.equal(friendlyError({ response: { status: 400, data: { error: { message: "Thiếu ảnh" } } } }), "Thiếu ảnh");
    // auth-service trả `error` là chuỗi
    assert.equal(friendlyError({ response: { status: 400, data: { error: "Email đã dùng" } } }), "Email đã dùng");
    // 429 không kèm câu nào
    assert.match(friendlyError({ response: { status: 429, data: {} } }), /quá nhanh/);
    // 5xx không được phơi thông điệp nội bộ ra người dùng
    assert.equal(
      friendlyError({ response: { status: 500, data: { error: { message: "ECONNREFUSED pg:5432" } } } }, "Lỗi hệ thống"),
      "Lỗi hệ thống",
    );
    // mất mạng
    assert.match(friendlyError(new Error("Network Error")), /Không kết nối được máy chủ/);
  });
});

describe("câu của máy chủ không lộ mã enum", () => {
  it("chỉ thay mã loại giấy tờ, giữ nguyên phần còn lại", () => {
    assert.equal(
      readableServerMessage("Còn thiếu giấy tờ bắt buộc: BUSINESS_LICENSE"),
      "Còn thiếu giấy tờ bắt buộc: Giấy phép kinh doanh",
    );
    assert.equal(readableServerMessage("Chưa chọn phường / xã"), "Chưa chọn phường / xã");
    assert.equal(readableServerMessage(null), "");
    const view = { missing: [{ section: "LEGAL", message: "Còn thiếu giấy tờ bắt buộc: PREMISES_PROOF" }] };
    assert.equal(missingItems(view as any)[0].message, "Còn thiếu giấy tờ bắt buộc: Chứng minh mặt bằng");
  });
});
