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

test("Điều 5 states DQ-2(a)/DQ-1 and the text was re-versioned (draft-1 text was changed, so its id must not be reused)", () => {
  assert.notEqual(PT_TERMS_VERSION, "2026-10-pt-draft-1");
  assert.equal(PT_TERMS_VERSION, "2026-10-pt-draft-2");
  assert.equal(PT_TERMS_IS_DRAFT, true);
  const clause = PT_TERMS_SECTIONS.find((s) => s.id === "pt-cancel");
  assert.ok(clause, "clause 5 exists");
  assert.match(clause.title, /^5\./);
  const text = clause.body.join(" ");
  assert.match(text, /«không diễn ra — đã hoàn tiền»/);
  assert.match(text, /vẫn được tính là một buổi đã dùng/);
  assert.match(text, /không tạo buổi bù/);
  assert.match(text, /không nhận tiền của buổi đó/);
  assert.match(text, /chính tiền của hợp đồng đó/);
  assert.match(text, /đối soát/);
  assert.match(text, /không tự động trở thành khoản nợ của bạn/);
  assert.doesNotMatch(text, /không bị trừ/);
  assert.equal(PT_TERMS_SECTIONS.length, 9);
  assert.deepEqual(publicPtTerms().sections.map((s) => s.title.slice(0, 2)), ["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9."]);
});
