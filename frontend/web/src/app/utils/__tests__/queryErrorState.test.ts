/**
 * FE2-FIX group B: a failed API request is an error state with a retry, never "empty" / 0.
 * Evidence label: TEST FIXTURE (pure helpers) + CODE AUDIT (source guards on the wiring).
 * Run: npx tsx --test src/app/utils/__tests__/queryErrorState.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { activeCycleFailed, hasBlockingError, httpStatusOf, listFailed, QUERY_ERROR_TEXT } from "../queryErrorState";

const http = (status: number) => ({ response: { status } });

describe("activeCycleFailed", () => {
  it("404 is the valid 'no active cycle yet' answer, not an error", () => {
    assert.equal(activeCycleFailed({ isError: true, data: undefined, error: http(404) }), false);
  });
  it("500 / 503 / 403 / network failure are errors", () => {
    for (const error of [http(500), http(503), http(403), new Error("Network Error")]) {
      assert.equal(activeCycleFailed({ isError: true, data: undefined, error }), true);
    }
  });
  it("no failure, or data already loaded, is not an error", () => {
    assert.equal(activeCycleFailed({ isError: false, data: undefined }), false);
    assert.equal(activeCycleFailed({ isError: true, data: { cycle: {} }, error: http(500) }), false);
  });
});

describe("hasBlockingError / listFailed / httpStatusOf", () => {
  it("previously loaded data wins over a failed refetch", () => {
    assert.equal(hasBlockingError({ isError: true, data: { a: 1 } }), false);
    assert.equal(hasBlockingError({ isError: true, data: undefined }), true);
    assert.equal(hasBlockingError({ isError: true, data: null }), true);
  });
  it("a failed list whose default would be [] is an error, a real empty list is not", () => {
    assert.equal(listFailed({ isPending: false, isError: true, data: undefined }), true);
    assert.equal(listFailed({ isPending: false, isError: false, data: [] }), false);
    assert.equal(listFailed({ isPending: true, isError: false, data: undefined }), false);
    assert.equal(listFailed({ isPending: false, isError: true, data: [{ id: 1 }] }), false);
  });
  it("httpStatusOf reads the axios status only", () => {
    assert.equal(httpStatusOf(http(404)), 404);
    assert.equal(httpStatusOf(new Error("x")), undefined);
    assert.equal(httpStatusOf(null), undefined);
  });
  it("copy never invites a destructive retry (no upload / start-again wording)", () => {
    for (const t of Object.values(QUERY_ERROR_TEXT)) assert.doesNotMatch(t, /tải phiếu|tải lên|bắt đầu/i);
  });
});

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

describe("wiring (source guard): each previously masked request now has an error state with a retry", () => {
  it("InBody: active-cycle widget distinguishes 404 from a failure", () => {
    const s = read("pages/client/InBodyModule.tsx");
    assert.match(s, /activeCycleFailed\(activeQuery\)/);
    assert.match(s, /inbody-cycle-error/);
    assert.match(s, /activeQuery\.refetch\(\)/);
  });
  it("Training cycle page: history list, progress and active card", () => {
    const s = read("pages/client/TrainingCyclePage.tsx");
    assert.match(s, /listFailed\(historyQuery\)/);
    assert.match(s, /hasBlockingError\(progressQuery\)/);
    assert.match(s, /activeCycleFailed\(activeQuery\)/);
    for (const id of ["cycle-history-error", "cycle-progress-error", "cycle-active-error"]) assert.match(s, new RegExp(id));
  });
  it("Nutrition: the day's plan request", () => {
    const s = read("pages/client/NutritionPage.tsx");
    assert.match(s, /nutrition-daily-task-error/);
    assert.match(s, /refetchDailyTask\(\)/);
  });
  it("PT terms banner (dashboard + contracts)", () => {
    const s = read("components/pt-terms/PtTerms.tsx");
    assert.match(s, /hasBlockingError\(termsQuery\)/);
    assert.match(s, /pt-terms-error/);
  });
  it("PT contracts page: no zero KPIs / empty state on failure", () => {
    const s = read("pages/pt/PTContractsPage.tsx");
    assert.match(s, /contractsFailed = listFailed\(contractsQuery\)/);
    assert.match(s, /!contractsFailed && \(/);
    assert.match(s, /pt-contracts-error/);
  });
  it("PT dashboard: alerts panel (contracts + pending reviews)", () => {
    const s = read("pages/pt/PTDashboard.tsx");
    assert.match(s, /listFailed\(contractsQuery\) \|\| listFailed\(pendingPlansQuery\)/);
    assert.match(s, /pt-alerts-error/);
    assert.match(s, /!alertsFailed \?/);
  });
  it("PT schedule: sessions awaiting completion", () => {
    const s = read("pages/pt/PTSchedulePage.tsx");
    assert.match(s, /awaitingFailed = listFailed\(awaitingQuery\)/);
    assert.match(s, /pt-sessions-to-close-error/);
  });
  it("AIPlansPage is NOT touched by this group (owner hold V4)", () => {
    const s = read("pages/client/AIPlansPage.tsx");
    assert.doesNotMatch(s, /QueryErrorNotice|queryErrorState/);
  });
});
