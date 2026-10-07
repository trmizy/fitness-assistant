import test from "node:test";
import assert from "node:assert/strict";
import { ptApplicationReviewNotice } from "../utils/ptApplicationNotice.util";

test("each review result the applicant can act on produces a Vietnamese notice that opens their application", () => {
  for (const action of ["APPROVED", "REJECTED", "NEEDS_MORE_INFO"]) {
    const notice = ptApplicationReviewNotice(action);
    assert.ok(notice, action);
    assert.match(notice!.text, /^Đơn ứng tuyển huấn luyện viên của bạn /);
    assert.equal(notice!.link, "/client/pt-application");
  }
  assert.match(ptApplicationReviewNotice("APPROVED")!.text, /đã được duyệt/);
  assert.match(ptApplicationReviewNotice("REJECTED")!.text, /chưa được chấp nhận/);
  assert.match(ptApplicationReviewNotice("NEEDS_MORE_INFO")!.text, /cần bổ sung/);
});

test("moving an application into the review queue is not a result — no notice", () => {
  assert.equal(ptApplicationReviewNotice("UNDER_REVIEW"), null);
  assert.equal(ptApplicationReviewNotice("SOMETHING_ELSE"), null);
});
