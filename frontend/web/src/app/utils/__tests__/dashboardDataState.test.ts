/**
 * Frontend 2.0 R1: dashboard data blocks never turn a failed request into "no data".
 * Run: npx tsx --test src/app/utils/__tests__/dashboardDataState.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { listDataState, DASHBOARD_ERROR_TEXT } from "../dashboardDataState";

describe("listDataState", () => {
  it("loading: request in flight, nothing cached", () => {
    assert.equal(listDataState({ isPending: true, isError: false, data: undefined }), "loading");
  });
  it("empty: request succeeded with an empty list", () => {
    assert.equal(listDataState({ isPending: false, isError: false, data: [] }), "empty");
  });
  it("error: request failed and nothing is cached — never 'empty'", () => {
    assert.equal(listDataState({ isPending: false, isError: true, data: undefined }), "error");
    // a failed request whose default value is [] must still be an error, not "no data"
    assert.equal(listDataState({ isPending: false, isError: true, data: [] }), "error");
  });
  it("error: a non-list response is not treated as empty", () => {
    assert.equal(listDataState({ isPending: false, isError: false, data: { message: "oops" } }), "error");
  });
  it("success: data present", () => {
    assert.equal(listDataState({ isPending: false, isError: false, data: [{ id: 1 }] }), "ready");
  });
  it("retry: after a failure, a successful refetch becomes ready; a refetch that fails again keeps cached data", () => {
    assert.equal(listDataState({ isPending: false, isError: true, data: undefined }), "error");
    assert.equal(listDataState({ isPending: false, isError: false, data: [{ id: 1 }] }), "ready");
    assert.equal(listDataState({ isPending: false, isError: true, data: [{ id: 1 }] }), "ready");
  });
  it("error copy does not ask the user to upload again", () => {
    assert.doesNotMatch(DASHBOARD_ERROR_TEXT.body, /tải phiếu|tải lên|upload/i);
  });
});

describe("ClientDashboard wiring (source guard)", () => {
  const src = readFileSync(new URL("../../pages/client/ClientDashboard.tsx", import.meta.url), "utf8");
  it("derives InBody and workout block states from listDataState", () => {
    assert.match(src, /bodyState = listDataState\(inbodyQuery\)/);
    assert.match(src, /recentState = listDataState\(workoutQuery\)/);
  });
  it("the 'no InBody yet' prompt is only shown for the empty state", () => {
    assert.match(src, /bodyState === "empty" && \(/);
    assert.doesNotMatch(src, /!hasInBody && \(/);
  });
  it("error states are announced and offer a retry", () => {
    assert.match(src, /role="alert"/);
    assert.match(src, /inbodyQuery\.refetch\(\)/);
    assert.match(src, /workoutQuery\.refetch\(\)/);
  });
});
