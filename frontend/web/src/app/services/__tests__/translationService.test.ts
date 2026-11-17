/**
 * N14T-10: the translate call must go to "/translate" - the axios baseURL already carries the "/api" prefix,
 * so "/api/translate" produced "/api/api/translate".
 * Evidence label: TEST FIXTURE (api.post is stubbed; no request leaves the process).
 * Run: npx tsx --test src/app/services/__tests__/translationService.test.ts (from frontend/web)
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import api, { translationService } from "../api";

const realPost = api.post;

afterEach(() => {
  (api as any).post = realPost;
});

describe("translationService.translate", () => {
  it("posts to /translate (no second /api prefix) and returns translatedText", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    (api as any).post = async (url: string, body?: any) => {
      calls.push({ url, body });
      return { data: { translatedText: "xin chào" } };
    };
    const out = await translationService.translate({ text: "hello", targetLang: "vi" });
    assert.equal(out, "xin chào");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/translate");
    assert.deepEqual(calls[0].body, { text: "hello", targetLang: "vi", sourceLang: "en" });
  });

  it("falls back to the source text when the response has no translatedText", async () => {
    (api as any).post = async () => ({ data: {} });
    assert.equal(await translationService.translate({ text: "hello", targetLang: "vi" }), "hello");
  });
});
