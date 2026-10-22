/**
 * D74 - draft PT terms can never turn into official acceptance by flipping a flag, and cannot be released to production.
 * Evidence label: unit (pure functions + the pre-deploy script). No database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PT_TERMS_IS_DRAFT,
  PT_TERMS_VERSION,
  isDraftTermsVersionId,
  ptTermsReleaseProblem,
  publicPtTerms,
  PT_TERMS_SECTIONS,
} from "../services/pt-terms";
import { checkPtTermsRelease } from "../scripts/check-pt-terms-release";

test("the CURRENT build is internally consistent: draft flag <=> draft version id (this pins the rule for every future edit)", () => {
  assert.equal(isDraftTermsVersionId(PT_TERMS_VERSION), PT_TERMS_IS_DRAFT, `version "${PT_TERMS_VERSION}" vs isDraft=${PT_TERMS_IS_DRAFT}`);
  assert.equal(ptTermsReleaseProblem({ NODE_ENV: "development" }), null);
  assert.equal(publicPtTerms().isDraft, PT_TERMS_IS_DRAFT);
});

test("flipping the flag alone is rejected: official text must carry a NEW non-draft id, a draft text must carry a draft id", () => {
  assert.match(ptTermsReleaseProblem({}, { version: "2026-10-pt-draft-1", isDraft: false }) ?? "", /OFFICIAL but still carry the draft id/);
  assert.match(ptTermsReleaseProblem({}, { version: "2026-10-pt-v1", isDraft: true }) ?? "", /DRAFT but version/);
  assert.equal(ptTermsReleaseProblem({ NODE_ENV: "production" }, { version: "2026-11-pt-v1", isDraft: false }), null, "an official id with the flag off is releasable");
});

test("draft id detection", () => {
  for (const v of ["2026-10-pt-draft-1", "draft-2", "pt_draft_3", "2026-10-pt-DRAFT"]) assert.equal(isDraftTermsVersionId(v), true, v);
  for (const v of ["2026-10-pt-v1", "2026-11-pt-v2", "undrafted-1", "redraft1"]) assert.equal(isDraftTermsVersionId(v), false, v);
});

test("draft terms are refused for production and allowed elsewhere", () => {
  assert.match(ptTermsReleaseProblem({ NODE_ENV: "production" }, { version: "2026-10-pt-draft-1", isDraft: true }) ?? "", /must not be released to production/);
  for (const env of ["development", "test", undefined]) assert.equal(ptTermsReleaseProblem({ NODE_ENV: env }, { version: "2026-10-pt-draft-1", isDraft: true }), null);
});

test("the pre-deploy script check: FAILS (ok=false -> exit 1) in production while the terms are draft; ok elsewhere", () => {
  if (PT_TERMS_IS_DRAFT) {
    const r = checkPtTermsRelease({ NODE_ENV: "production" });
    assert.equal(r.ok, false);
    assert.match(r.message, /FAILED/);
  }
  assert.equal(checkPtTermsRelease({ NODE_ENV: "development" }).ok, true);
});

test("a confirmation of the draft id does not match any other id (draft rows cannot validate an official version)", () => {
  assert.notEqual(PT_TERMS_VERSION, "2026-10-pt-v1");
  assert.equal(isDraftTermsVersionId("2026-10-pt-v1"), false);
});

test("Điều 3 says an online session is recorded by the system when the room closes (room-close-resolution runs it without the PT reporting) - draft-4 text, still in draft-5", () => {
  const clause = PT_TERMS_SECTIONS.find((s) => s.id === "sessions");
  assert.ok(clause, "clause 3 exists");
  assert.match(clause.title, /^3\./);
  const first = clause.body[0];
  assert.match(first, /Sau khi buổi tập kết thúc, bạn báo hoàn thành buổi đó\. Với buổi học trực tuyến, hệ thống tự ghi nhận khi phòng học đóng\./);
  // the rest of the clause is unchanged
  assert.match(clause.body.join(" "), /Nếu khách không phản hồi trong 3 ngày, hệ thống tự xác nhận/);
  assert.equal(PT_TERMS_IS_DRAFT, true);
});

test("Điều 5 states DQ-2(a)/DQ-1/D77 and the text was re-versioned (draft-5 added the privacy notice, clause 10; draft-6 added the holdback clause and the gym fixed-duration rule) (earlier drafts had other text, so their ids must not be reused)", () => {
  assert.notEqual(PT_TERMS_VERSION, "2026-10-pt-draft-1");
  assert.notEqual(PT_TERMS_VERSION, "2026-10-pt-draft-2");
  assert.notEqual(PT_TERMS_VERSION, "2026-10-pt-draft-3");
  assert.notEqual(PT_TERMS_VERSION, "2026-10-pt-draft-4");
  assert.notEqual(PT_TERMS_VERSION, "2026-10-pt-draft-5");
  assert.equal(PT_TERMS_VERSION, "2026-10-pt-draft-6");
  assert.equal(PT_TERMS_IS_DRAFT, true);
  const clause = PT_TERMS_SECTIONS.find((s) => s.id === "pt-cancel");
  assert.ok(clause, "clause 5 exists");
  assert.match(clause.title, /^5\./);
  const text = clause.body.join(" ");
  // DQ-2(a): two different notions, kept apart
  assert.match(text, /«buổi được tính vào số buổi đã xử lý của gói» và «buổi bạn đã cung cấp dịch vụ»/);
  assert.match(text, /không bao giờ được hiển thị là đã hoàn thành/);
  assert.match(text, /không tạo thu nhập cho bạn/);
  assert.match(text, /không tạo buổi bù/);
  assert.match(text, /không nhận tiền của buổi đó/);
  assert.match(text, /đóng là «không diễn ra»/);
  // the refund wording promises neither "đã hoàn tiền" for every NO_SHOW nor immediacy: full / partial / pending, remainder reconciling
  assert.doesNotMatch(text, /«không diễn ra — đã hoàn tiền»/);
  assert.match(text, /chính tiền của hợp đồng đó, không lấy từ tiền của hợp đồng khác/);
  assert.match(text, /không cam kết mọi khoản còn thiếu đều được hoàn ngay/);
  assert.match(text, /\(a\) tiền của hợp đồng đủ[^;]*«đã hoàn tiền»/);
  assert.match(text, /\(b\) chỉ đủ một phần[^;]*«đã hoàn một phần, còn … đang chờ xử lý»/);
  assert.match(text, /\(c\) chưa hoàn được[^.]*«chưa hoàn, đang chờ xử lý»/);
  assert.match(text, /chỉ được coi là đã hoàn khi đã được xử lý xong/);
  assert.match(text, /đối soát/);
  assert.match(text, /không tự động trở thành khoản nợ của bạn/);
  assert.doesNotMatch(text, /không bị trừ/);
  // D77: the rule exactly as the code runs it
  assert.match(text, /muộn hơn 15 phút so với giờ bắt đầu đã hẹn, trong khi khách cũng có mặt/);
  assert.match(text, /bồi thường một nửa giá trị của buổi đó \(một nửa của giá hợp đồng chia cho tổng số buổi\)/);
  assert.match(text, /trừ vào chính tiền của buổi đó: bạn, phòng gym \(nếu có\) và nền tảng mỗi bên chịu phần của mình theo đúng tỷ lệ chia của hợp đồng/);
  assert.match(text, /Sau khi buổi được xác nhận, bạn nhận phần còn lại của buổi đó/);
  assert.match(text, /các buổi khác không bị ảnh hưởng/);
  assert.match(clause.title, /vào phòng học muộn/);
  assert.equal(PT_TERMS_SECTIONS.length, 10);
  assert.deepEqual(publicPtTerms().sections.map((s) => s.title.slice(0, 2)), ["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.", "10"]);
});

test("draft-6 (privacy notice from draft-5): clause 10 is the PT privacy notice (purpose, data, who sees it, 12-month retention with the dispute exception, rights) and every client renders it as an ordinary section", () => {
  assert.equal(PT_TERMS_VERSION, "2026-10-pt-draft-6");
  assert.equal(PT_TERMS_IS_DRAFT, true, "still a draft: the notice does not make the terms official");
  const clause = PT_TERMS_SECTIONS.find((s) => s.id === "privacy-notice");
  assert.ok(clause, "clause 10 exists");
  assert.equal(PT_TERMS_SECTIONS[PT_TERMS_SECTIONS.length - 1], clause, "it is the LAST section, so no earlier clause number moves");
  assert.match(clause.title, /^10\. Thông báo về dữ liệu cá nhân/);
  const text = clause.body.join(" ");
  assert.match(text, /địa chỉ IP và loại trình duyệt/); // the data
  assert.match(text, /chứng minh bạn đã đồng ý điều khoản và phòng chống gian lận/); // the purpose
  assert.match(text, /không dùng hai thông tin này cho mục đích khác/);
  assert.match(text, /chỉ quản trị viên Gymini/); // who sees it
  assert.match(text, /12 tháng/); // retention
  assert.match(text, /xóa địa chỉ IP và loại trình duyệt khỏi bản ghi/);
  assert.match(text, /bản ghi cho biết bạn đã đồng ý phiên bản nào, vào lúc nào vẫn được giữ lại/); // the row is not deleted
  assert.match(text, /tranh chấp hoặc yêu cầu pháp lý/); // the legal-hold exception
  assert.match(text, /Quyền của bạn/); // rights
  assert.doesNotMatch(text, /tuân thủ|đúng luật|hợp pháp/, "no compliance claim in the text");
  // the shape the web and mobile screens render generically (title + paragraphs): no new field is needed
  const served = publicPtTerms().sections.find((x) => x.id === "privacy-notice");
  assert.deepEqual(Object.keys(served!).sort(), ["body", "id", "title"]);
  assert.ok(served!.body.length >= 4 && served!.body.every((p) => typeof p === "string" && p.length > 0));
  assert.equal(JSON.stringify(publicPtTerms()).includes("PtTermsAcceptance"), false, "the server-side source note is never served");
});

test("draft-6: Điều 1 states the gym-linked contract rule (fixed duration + a membership that covers it, checked at request / accept / pay)", () => {
  const text = PT_TERMS_SECTIONS.find((s) => s.id === "contract-flow")!.body.join(" ");
  assert.match(text, /Hợp đồng gắn với một phòng gym phải có thời hạn cố định/);
  assert.match(text, /gói hội viên đang có của khách tại gym đó phải còn hiệu lực đủ dài để bao phủ toàn bộ thời hạn của hợp đồng/);
  assert.match(text, /khi khách gửi yêu cầu, khi bạn chấp nhận và khi khách thanh toán/);
  assert.match(text, /trước khi có bất kỳ khoản tiền nào được chuyển/);
});

test("draft-6: Điều 2 states the holdback exactly as the ledger runs it - amount on the PT's EXPECTED income, collection, nature, release after end + reconciliation (no fixed date), use only for a VERIFIED PT-responsible obligation of the SAME contract (PT share, PENDING first, not automatic), reserve + review deadline, decision outcomes, non-retroactive", () => {
  const clause = PT_TERMS_SECTIONS.find((s) => s.id === "revenue-split")!;
  assert.match(clause.title, /^2\. Chia tiền của hợp đồng và khoản tạm giữ một phần thu nhập$/);
  const text = clause.body.join(" ");
  assert.match(text, /chỉ áp dụng cho hợp đồng được tạo sau khi quy định này có hiệu lực/);
  assert.match(text, /10% thu nhập dự kiến của bạn trên chính hợp đồng đó/);
  assert.match(text, /không phải 10% số tiền khách trả/);
  assert.match(text, /hợp đồng 1\.000\.000đ, bạn nhận 90%, thu nhập dự kiến 900\.000đ, mức giữ 90\.000đ/);
  assert.match(text, /không bao giờ lấy từ phần của phòng gym hay của nền tảng/);
  assert.match(text, /khách xác nhận, hoặc hệ thống tự xác nhận hợp lệ; không phải lúc bạn bấm hoàn thành/);
  assert.match(text, /Buổi bạn vắng mặt không tạo thu nhập nên không có gì bị giữ/);
  assert.match(text, /không phải phí, không phải doanh thu của nền tảng/);
  assert.match(text, /sau khi hợp đồng kết thúc và việc đối soát của chính hợp đồng đó hoàn tất, đúng một lần/);
  assert.match(text, /không có ngày cố định/);
  assert.match(text, /không bao giờ tự tịch thu/);
  assert.match(text, /CHÍNH hợp đồng đó mà quản trị viên đã xem xét và xác minh là thuộc trách nhiệm của bạn/);
  assert.match(text, /chỉ phần thuộc phần của bạn/);
  assert.match(text, /Trước hết dùng phần tiền chờ của hợp đồng đó đã được tách riêng/);
  assert.match(text, /không bao giờ trả một khoản hai lần/);
  assert.match(text, /không tự động xảy ra chỉ vì bạn bị hạn chế hoặc khóa tài khoản, bạn đơn phương chấm dứt hợp đồng, hay khách khiếu nại/);
  assert.match(text, /chỉ giữ lại phần tối đa bạn có thể phải chịu/);
  assert.match(text, /hạn xem xét \(14 ngày\)/);
  assert.match(text, /nếu không được xác minh là lỗi của bạn, toàn bộ phần dự phòng được trả lại cho bạn/);
  assert.match(text, /không ứng tiền, không lấy từ hợp đồng khác/);
  assert.doesNotMatch(text, /tự động (bồi thường|trừ|tịch thu)/, "nothing is described as automatic");
  assert.match(PT_TERMS_SECTIONS.find((s) => s.id === "pt-cancel")!.body.join(" "), /không tự động khiến bạn bị bồi thường thêm từ khoản tạm giữ ở mục 2/);
  assert.match(PT_TERMS_SECTIONS.find((s) => s.id === "restriction")!.body.join(" "), /không tự động bị coi là lỗi của bạn đối với từng khách/);
  assert.match(PT_TERMS_SECTIONS.find((s) => s.id === "neutral-exit")!.body.join(" "), /không dùng khoản tạm giữ ở mục 2 để bồi thường/);
  assert.equal(PT_TERMS_SECTIONS.length, 10, "numbering is unchanged: the holdback lives in clause 2, the privacy notice stays clause 10");
  assert.ok(PT_TERMS_SECTIONS.some((s) => s.id === "privacy-notice"));
});
