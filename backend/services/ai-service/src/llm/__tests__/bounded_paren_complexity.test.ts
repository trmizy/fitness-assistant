/**
 * Bounded computation of the induced-vomiting event classifier (`llm/induced_vomiting_events.ts`): the parenthesis stage is linear.
 * BACKEND INTEGRATION / TEST FIXTURE: in-process, no network, no model, NO wall-clock assertion. The complexity gate is the deterministic operation
 * counter `analysis.stats` (tokens produced, token visits, characters analysed): `tokenVisits / tokens` must stay a small constant and must not grow when
 * the input doubles. The fixed table pins the verdict / structure of nested, unbalanced, independent, inline-by-phrase and transparent parenthetical
 * asides; its expected values were produced by the implementation that was replaced (the quadratic one), so they pin "no behaviour change".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeInducedVomiting, detectBareVomitingDisclosure } from "../induced_vomiting_events";

interface Row { q: string; disclosure: boolean; sentences: number; clauses: number; events: string[] }
// events: actor / anchor(A) / negated(N) / outcome / owned purposes / owned causes
const TABLE: Row[] = [
  { q: "Ăn xong mình ói để giảm cân.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (để giảm cân).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (hằng ngày) để giảm cân.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (3 lần/tuần).", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói (vì say xe) để giảm cân.", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/A-/SYMPTOM/p1/c1"] },
  { q: "Ăn xong mình ói (để giảm cân (nhằm giữ dáng)).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p2/c0"] },
  { q: "Ăn xong mình ói (giảm cân).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (giữ cân).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (giữ cân bằng).", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói (giữ cân) bằng cách nhịn.", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói ((giữ cân) bằng sức).", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói (a (giữ cân) bằng).", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói (a (giam can) b (c (khong len can))).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p2/c0"] },
  { q: "Ăn xong mình ói (con tôi bị say xe) để giảm cân.", disclosure: false, sentences: 1, clauses: 3, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói (mình ốm) để giảm cân.", disclosure: false, sentences: 1, clauses: 3, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói (vì sợ béo (để giữ dáng)).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p2/c0"] },
  { q: "Ăn xong mình ói (không phải để giảm cân).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói ((((để giảm cân)))).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói ((((hằng ngày)))) để giữ dáng.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (để giảm cân.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói để giảm cân).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói ((để giảm cân).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (hằng ngày(để giảm cân).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ó(i để giảm cân).", disclosure: false, sentences: 0, clauses: 0, events: [] },
  { q: "Ăn xong mình ói(để)giảm cân.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói() để giảm cân.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói )( để giảm cân.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (ói) để giảm cân.", disclosure: false, sentences: 1, clauses: 3, events: ["FIRST/A-/SYMPTOM/p0/c0","NONE/--/NO_EVENT/p0/c0"] },
  { q: "Ăn xong mình ói (xong (ói (ói))) để giảm cân.", disclosure: false, sentences: 1, clauses: 5, events: ["FIRST/A-/SYMPTOM/p0/c0","NONE/--/NO_EVENT/p0/c0","NONE/--/NO_EVENT/p0/c0"] },
  { q: "Ăn xong mình ói (anh ấy) để giảm cân.", disclosure: false, sentences: 1, clauses: 3, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói – (để giảm cân) – nên mệt.", disclosure: true, sentences: 1, clauses: 3, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong (mình ói) để giảm cân.", disclosure: false, sentences: 1, clauses: 3, events: ["FIRST/--/NO_EVENT/p0/c0"] },
  { q: "(Ăn xong) mình ói (để giảm cân)", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/--/NO_EVENT/p0/c0"] },
  { q: "Ăn xong mình ói (vi say xe) de giam can", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/A-/SYMPTOM/p1/c1"] },
  { q: "an xong minh oi (de giu can bang) a", disclosure: false, sentences: 1, clauses: 1, events: [] },
  { q: "an xong minh oi (de giu can) bang cach nhin", disclosure: false, sentences: 1, clauses: 1, events: [] },
  { q: "an xong minh oi (giu can (bang (nhin)))", disclosure: false, sentences: 1, clauses: 1, events: [] },
  { q: "an xong minh oi (kiem soat can) bang sat", disclosure: false, sentences: 1, clauses: 1, events: [] },
  { q: "Hôm nay mình hơi buồn nôn (sau khi ăn) vì say xe.", disclosure: false, sentences: 1, clauses: 1, events: ["FIRST/--/NO_EVENT/p0/c0"] },
  { q: "Sau mỗi bữa ăn mình nôn (để kiểm soát cân nặng, hằng ngày).", disclosure: true, sentences: 1, clauses: 2, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Mình nôn ăn xong (3 lần/tuần) (để giữ dáng)", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói, (để giảm cân) rồi mình đi ngủ.", disclosure: true, sentences: 1, clauses: 2, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (hằng ngày\n) để giảm cân.", disclosure: false, sentences: 2, clauses: 2, events: ["FIRST/A-/SYMPTOM/p0/c0"] },
  { q: "Ăn xong mình ói ( ) ( ) ( ) để giảm cân.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (a) (b) (c (d)) (e (f (g))) để giữ dáng.", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "Ăn xong mình ói (để\u0001giảm cân).", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "ÓI (ĂN XONG MÌNH ÓI ĐỂ GIẢM CÂN)", disclosure: true, sentences: 1, clauses: 2, events: ["NONE/--/NO_EVENT/p0/c0","FIRST/A-/DISCLOSURE/p1/c0"] },
  { q: "bé nhà mình ăn xong ói (để giảm cân)", disclosure: false, sentences: 1, clauses: 1, events: ["THIRD/--/NO_EVENT/p0/c0"] },
  { q: "Ăn xong mình ói (giam can) (khong) (len can)", disclosure: true, sentences: 1, clauses: 1, events: ["FIRST/A-/DISCLOSURE/p1/c0"] },
];
const summary = (q: string): string[] =>
  analyzeInducedVomiting(q).events.map((e) => `${e.actor}/${e.anchor ? "A" : "-"}${e.negated ? "N" : "-"}/${e.outcome}/p${e.purposes.filter((p) => p.owner === "EVENT").length}/c${e.causes.filter((p) => p.owner === "EVENT").length}`);

test("BPC.1 fixed table: verdict, sentence / clause counts and event structure of parenthetical shapes are unchanged", () => {
  for (const row of TABLE) {
    const a = analyzeInducedVomiting(row.q);
    const j = JSON.stringify(row.q);
    assert.equal(a.disclosure, row.disclosure, `disclosure ${j}`);
    assert.equal(detectBareVomitingDisclosure(row.q), row.disclosure, `detectBare ${j}`);
    assert.equal(a.sentenceCount, row.sentences, `sentences ${j}`);
    assert.equal(a.clauseCount, row.clauses, `clauses ${j}`);
    assert.deepEqual(summary(row.q), row.events, `events ${j}`);
  }
  assert.ok(TABLE.some((r) => r.disclosure) && TABLE.some((r) => !r.disclosure), "the table holds both outcomes");
});

// ── shapes (each builder returns a text of about `n` characters) ─────────────────────────────────────────────────────────────────
const SHAPES: Record<string, (m: number) => string> = {
  nestedMarker: (m) => "ói " + "(".repeat(m) + "để " + "a ".repeat(m) + ")".repeat(m), // INLINE by marker word at every level
  nestedPhrase: (m) => "ói " + "(".repeat(m) + "a ".repeat(m) + "giảm cân" + ")".repeat(m), // INLINE only through a purpose PHRASE at every level
  nestedPhraseEveryLevel: (m) => "ói " + "(giu can ".repeat(m) + ")".repeat(m),
  nestedLookahead: (m) => "ói " + "(giu can bang ".repeat(m) + ")".repeat(m), // "giữ cân" followed by "bằng": the phrase is dropped at every junction
  nestedTransparent: (m) => "ói " + "(".repeat(m) + "a ".repeat(m) + ")".repeat(m),
  nestedOneToken: (m) => "ói " + "(a ".repeat(m) + ")".repeat(m),
  nestedIndependent: (m) => "ói " + "(ói ".repeat(m) + ")".repeat(m),
  nestedMarkerPerLevel: (m) => "ói " + "(để ".repeat(m) + ")".repeat(m),
  flatSiblings: (m) => "ói " + "(a)".repeat(m),
  unclosed: (m) => "ói " + "(".repeat(m),
  stray: (m) => "ói " + ")".repeat(m),
  mixed: (m) => "ói " + "(a (ói) b (de) c (giam can) ".repeat(m) + ")".repeat(m),
  wideToken: (m) => "ói " + "(".repeat(m) + "để " + "ệ".repeat(m) + ")".repeat(m), // one huge token inside m levels
  accented: (m) => "ói " + "(".repeat(m) + "để " + "ế ".repeat(m) + ")".repeat(m),
};
const SIZES = [250, 500, 1000, 2000, 4000, 8000];
const build = (shape: string, chars: number): string => {
  const f = SHAPES[shape];
  let lo = 1;
  while (f(lo * 2).length <= chars) lo *= 2;
  let hi = lo * 2;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (f(mid).length <= chars) lo = mid; else hi = mid; }
  return f(lo);
};

test("BPC.2 operation counter: tokenVisits / tokens <= 40 and doubling the input at most doubles tokenVisits (parenthesis shapes)", () => {
  for (const shape of Object.keys(SHAPES)) {
    let prev = 0;
    for (const n of SIZES) {
      const q = build(shape, n);
      const { stats } = analyzeInducedVomiting(q);
      const where = `${shape} n=${q.length}`;
      assert.ok(stats.tokens >= 0 && stats.tokenVisits >= 0);
      if (stats.tokens > 0) assert.ok(stats.tokenVisits / stats.tokens <= 40, `${where}: ${stats.tokenVisits} visits / ${stats.tokens} tokens`);
      assert.ok(stats.tokenVisits <= 40 * (stats.tokens + 1) + 40, `${where}: visits ${stats.tokenVisits}`);
      assert.ok(stats.regexChars <= 8 * (q.length + 64), `${where}: regex chars ${stats.regexChars}`);
      assert.equal(stats.chars, q.normalize("NFC").toLowerCase().length, where);
      if (prev > 0) assert.ok(stats.tokenVisits <= 2.2 * prev + 64, `${where}: visits ${stats.tokenVisits} vs previous size ${prev}`);
      prev = stats.tokenVisits;
    }
  }
});

test("BPC.3 many events, clauses, sentences and phrases stay linear (stats.tokenVisits / tokens <= 40)", () => {
  const many: Record<string, string> = {
    events: "ăn xong mình ói ".repeat(400),
    clauses: "ói " + "a, ".repeat(2000),
    sentences: "ói " + "a. ".repeat(2000),
    purposes: "ói " + "để giảm cân ".repeat(400),
    adjacentPurposes: "vì say xe, " + "ăn xong mình ói ".repeat(250) + ", " + "để giảm cân ".repeat(250), // V events x P adjacent purposes (events without own phrases share the clause's adjacent array: O(V + P), not O(V x P))
  };
  for (const [name, q] of Object.entries(many)) {
    const { stats } = analyzeInducedVomiting(q);
    assert.ok(stats.tokens > 0, name);
    assert.ok(stats.tokenVisits / stats.tokens <= 40, `${name}: ${stats.tokenVisits} / ${stats.tokens}`);
  }
  assert.equal(detectBareVomitingDisclosure(many.adjacentPurposes), false); // the benign cause wins for every event
});

test("BPC.4 no silent truncation: a disclosure in the MIDDLE of a text longer than the old 200,000-character clip is found", () => {
  const pad = "Hôm nay tập ngực và vai, ăn đủ đạm. ".repeat(4000); // ~ 144,000 chars each side -> total > 288,000
  const q = `${pad} Ăn xong mình ói để giảm cân. ${pad}`;
  assert.ok(q.length > 250_000);
  assert.equal(detectBareVomitingDisclosure(q), true);
  const benign = `${pad} Ăn xong mình ói vì say xe. ${pad}`;
  assert.equal(detectBareVomitingDisclosure(benign), false);
  assert.equal(analyzeInducedVomiting(q).stats.chars, q.length);
});

test("BPC.5 the stats field is additional: the structured fields keep their shape, and a text without a vomit word analyses nothing", () => {
  const a = analyzeInducedVomiting("Hôm nay tập chân.");
  assert.deepEqual(Object.keys(a).sort(), ["clauseCount", "disclosure", "events", "hasDiacritics", "relationHeads", "sentenceCount", "stats"]);
  assert.deepEqual(a.stats, { chars: "Hôm nay tập chân.".length, tokens: 0, tokenVisits: 0, regexChars: 0 });
});

// ── BPC.6 standalone combining marks / empty tokens (Codex P1 on 298da52a, reproduced by the lead) ─────────────────────────────────────────
// A token made only of combining marks (U+0300–U+036F) folds to the EMPTY string. The pre-298da52a code joined those empty tokens with single spaces, so a
// run of them was a long whitespace gap that "giu\s+can" / "can(?!\s+bang)" still matched across. The single-pass summary assumed "every match is <= 22
// characters" and lost "giu" on a gap wider than its 48-char window => purpose lost => disclosure became a symptom (and `safe`). The fix drops empty folded
// tokens before joining, so the summary text is exactly the old joined text up to whitespace (which no phrase regex counts). The ground truth of every
// expectation below is the behaviour of 687eb583 (the pre-298da52a detector), checked by a differential harness; the INVARIANCE assertion (a gap of
// any size / kind decides like a single space) is the property the regression broke.
// (every gap holds a separator: a mark glued between two letters with no whitespace is part of the LETTER token, which is the same under both detectors)
const MARK_GAPS = ["\u0301 ", " \u0301", " \u0301 ", "\u0301\u0301 ", "\u0300 \u0323 ", "\t", "\u00a0", "\u0301\u00a0", "  "];
const GAP_SIZES = [0, 1, 7, 15, 16, 30, 60, 120, 400];
const joinWith = (words: string[], g: string, k: number): string => words.reduce((acc, w, i) => (i === 0 ? w : acc + (k === 0 ? " " : g.repeat(k)) + w), "");
const outcomes = (q: string): string[] => analyzeInducedVomiting(q).events.map((e) => e.outcome);
const GAP_PHRASES: Array<{ words: string[]; disclosure: boolean }> = [
  { words: ["giữ", "cân"], disclosure: true },
  { words: ["giữ", "cân", "bằng"], disclosure: false }, // "cân" followed by "bằng" is not a purpose phrase
  { words: ["giảm", "cân"], disclosure: true },
  { words: ["nhẹ", "cân"], disclosure: false }, // "nhẹ cân" is a purpose only after "cho" / "để"
  { words: ["tránh", "tăng", "cân"], disclosure: true },
  { words: ["kiểm", "soát", "cân"], disclosure: true },
  { words: ["giữ", "dáng"], disclosure: true },
];

test("BPC.6.1 the exact lead repro: a purpose phrase split by 60 standalone combining marks inside a parenthetical stays a DISCLOSURE", () => {
  const q = "Ăn xong mình ói (giữ " + "\u0301 ".repeat(60) + "cân).";
  assert.equal(q.length, 146);
  assert.equal(detectBareVomitingDisclosure(q), true);
  assert.equal(analyzeInducedVomiting(q).disclosure, true);
  assert.deepEqual(outcomes(q), ["DISCLOSURE"]);
});

test("BPC.6.2 invariance: gaps of standalone combining marks / whitespace of any kind and width decide exactly like a single space (nested 0..3 levels)", () => {
  for (const { words, disclosure } of GAP_PHRASES) {
    for (let depth = 0; depth <= 3; depth++) {
      const wrap = (inner: string): string => `Ăn xong mình ói ${"(".repeat(depth || 1)}${inner}${")".repeat(depth || 1)}.`;
      const ref = wrap(words.join(" "));
      assert.equal(detectBareVomitingDisclosure(ref), disclosure, `reference ${JSON.stringify(ref)}`);
      for (const g of MARK_GAPS) {
        for (const k of GAP_SIZES) {
          const q = wrap(joinWith(words, g, k));
          const where = JSON.stringify(q.length > 120 ? q.slice(0, 120) + "…" : q);
          assert.equal(detectBareVomitingDisclosure(q), disclosure, `detect ${where}`);
          assert.deepEqual(outcomes(q), outcomes(ref), `outcomes ${where}`);
        }
      }
    }
  }
});

test("BPC.6.3 invariance for a benign cause phrase and for the unaccented / NFD spellings with a long mark gap", () => {
  const gap = "\u0301 ".repeat(60);
  const cause = `Ăn xong mình ói (vì${gap}say${gap}xe) để giảm cân.`;
  assert.equal(detectBareVomitingDisclosure(cause), false); // same-event benign cause wins
  assert.equal(detectBareVomitingDisclosure(cause), detectBareVomitingDisclosure("Ăn xong mình ói (vì say xe) để giảm cân."));
  const unaccented = `an xong minh non (giu${gap}can).`;
  assert.equal(detectBareVomitingDisclosure(unaccented), detectBareVomitingDisclosure("an xong minh non (giu can)."));
  assert.equal(detectBareVomitingDisclosure(unaccented), true);
  const nfdQ = `Ăn xong mình ói (giữ${gap}cân).`.normalize("NFD");
  assert.equal(detectBareVomitingDisclosure(nfdQ), true);
  const noPurpose = `Ăn xong mình ói (hằng${gap}ngày).`;
  assert.equal(detectBareVomitingDisclosure(noPurpose), false);
});

test("BPC.6.4 bounded: a long run of standalone combining marks still costs a bounded number of operations per token", () => {
  const q = "Ăn xong mình ói (giữ " + "\u0301 ".repeat(900) + "cân).";
  assert.ok(q.length <= 2000);
  const { stats, disclosure } = analyzeInducedVomiting(q);
  assert.equal(disclosure, true);
  assert.ok(stats.tokens > 0 && stats.tokenVisits / stats.tokens <= 40, `${stats.tokenVisits} / ${stats.tokens}`);
  assert.ok(stats.regexChars <= 8 * (q.length + 64), `regex chars ${stats.regexChars}`);
});
