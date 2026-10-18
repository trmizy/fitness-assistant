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
