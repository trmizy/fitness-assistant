/**
 * M7-P5A.3d — structure of the event-scoped bare-verb classifier (`llm/induced_vomiting_events.ts`).
 * BACKEND INTEGRATION / TEST FIXTURE: in-process, no network, no model. Oracles are hand-written from the owner contract (event = first-person vomit verb
 * + meal anchor in one clause; purposes / benign causes owned structurally; ambiguous ownership never refuses). The behavioural rows live in
 * safety_guard_induced_vomiting_event.test.ts; this file pins the INTERNAL decisions (actor, anchor, negation, ownership) so a regression is located precisely.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeInducedVomiting, detectBareVomitingDisclosure } from "../induced_vomiting_events";

const events = (q: string) => analyzeInducedVomiting(q).events;
const owned = (list: { owner: string }[]) => list.filter((p) => p.owner === "EVENT").length;

test("IV-S.01 a first-person event with a meal anchor and one purpose is a DISCLOSURE", () => {
  const [ev, ...rest] = events("Ăn xong mình ói để giữ dáng.");
  assert.equal(rest.length, 0);
  assert.equal(ev.actor, "FIRST");
  assert.equal(ev.anchor, true);
  assert.equal(ev.negated, false);
  assert.equal(owned(ev.purposes), 1);
  assert.equal(owned(ev.causes), 0);
  assert.equal(ev.outcome, "DISCLOSURE");
});

test("IV-S.02 relation heads decide the actor from the ORIGINAL token: accented text uses accented heads, unaccented text spares co / chi / chu", () => {
  assert.equal(events("Cô tôi hay ói sau khi ăn để giảm cân")[0].actor, "THIRD");
  assert.equal(events("Chị mình hay ói sau khi ăn để giảm cân")[0].actor, "THIRD");
  assert.equal(events("Chỉ có mình hay ói sau khi ăn để giảm cân")[0].actor, "FIRST"); // "chỉ / có" are not heads
  assert.equal(events("Còn mình hay ói sau khi ăn để giảm cân")[0].actor, "FIRST");
  assert.equal(events("an xong co toi non de giam can")[0].actor, "FIRST"); // unaccented: ambiguous head => favour detection
  assert.equal(events("an xong con toi non de giam can")[0].actor, "THIRD"); // unambiguous plain head
  assert.equal(events("an xong co tôi non de giam can")[0].actor, "FIRST"); // mixed text is accented: ASCII "co" is not a head
  assert.equal(events("an xong cô tôi non de giam can")[0].actor, "THIRD");
});

test("IV-S.03 a verb without a meal anchor, a negated verb, and a request / symptom gap are NO_EVENT", () => {
  assert.equal(events("Ói để giảm cân có hại không?")[0].outcome, "NO_EVENT");
  assert.equal(events("Mình ói để giảm cân")[0].anchor, false);
  const neg = events("Ăn xong mình không ói để giảm cân")[0];
  assert.equal(neg.negated, true);
  assert.equal(neg.outcome, "NO_EVENT");
  assert.equal(events("Ăn xong mình không bao giờ ói để giảm cân")[0].negated, true);
  assert.equal(events("Ăn xong mình không nghỉ mà ói để giảm cân")[0].negated, false); // the negation belongs to ANOTHER verb
  assert.equal(events("Mình muốn biết cách ói sau khi ăn để giảm cân")[0].outcome, "NO_EVENT");
  assert.equal(events("Ăn xong mình buồn nôn để giảm cân")[0].outcome, "NO_EVENT");
  assert.equal(analyzeInducedVomiting("Ăn xong mình nôn nóng giảm cân").events.length, 0); // "nôn nóng" is impatience, not a verb
  assert.equal(events("Tôi ăn xong là ói để giữ dáng")[0].outcome, "NO_EVENT"); // subject BEFORE the anchor: out of scope, pinned by IV-C.8c.01
});

test("IV-S.04 ownership: own clause, fronted purpose with own subject, trailing 'nên + subject', adjacent clause markers", () => {
  const o = (q: string) => events(q)[0];
  assert.equal(o("Ăn xong mình ói để giữ dáng tôi đi bộ").outcome, "DISCLOSURE"); // no connector: the purpose stays with the verb of its own clause
  assert.equal(o("Ăn xong mình ói vì muốn giảm cân nên tôi đi bộ").outcome, "SYMPTOM"); // "nên + subject" hands it to the other action
  assert.equal(o("Ăn xong mình ói vì muốn giảm cân nên tôi đi bộ").purposes[0].owner, "OTHER_ACTION");
  assert.equal(o("Ăn xong mình ói, để giữ dáng tôi đi bộ").outcome, "SYMPTOM"); // adjacent purpose with its own subject is not adopted
  assert.equal(o("Ăn xong mình ói, để giữ dáng tôi đi bộ").purposes[0].owner, "NOT_ADOPTED");
  assert.equal(o("Ăn xong mình ói, vì muốn giảm cân").outcome, "DISCLOSURE");
  assert.equal(o("Ăn xong mình ói, rồi nghỉ một lát, để giảm cân").outcome, "SYMPTOM"); // non-adjacent clause
  assert.equal(o("Ăn xong mình ói. Để giảm cân.").outcome, "SYMPTOM"); // another sentence
  assert.equal(o("Ăn xong mình ói vì say xe, để giảm cân").outcome, "SYMPTOM"); // same-event cause wins
  assert.equal(o("Vì say xe tôi nằm nghỉ, ăn xong mình ói để giảm cân").outcome, "DISCLOSURE"); // the cause belongs to 'tôi nằm nghỉ'
  assert.equal(o("Để giảm cân ăn xong mình ói").outcome, "DISCLOSURE"); // fronted purpose whose verb lies in its tail
});

test("IV-S.05 several events: a benign one never cancels another; third-person events never count", () => {
  assert.equal(events("Ăn xong mình ói vì say xe. Ăn xong mình ói để giảm cân.").map((e) => e.outcome).join(), "SYMPTOM,DISCLOSURE");
  assert.equal(events("Ăn xong mình ói để giảm cân. Con tôi ói vì say xe.").map((e) => `${e.actor}:${e.outcome}`).join(), "FIRST:DISCLOSURE,THIRD:NO_EVENT");
  assert.equal(detectBareVomitingDisclosure("Ăn xong con tôi ói để giảm cân. Ăn xong mình ói vì say xe."), false);
});

test("IV-S.06 parentheses: modifier asides are transparent, purpose asides are inline, independent asides are their own clause, unbalanced never throws", () => {
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói (hằng ngày) để giảm cân."), true);
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói (để giữ dáng) tôi đi bộ."), true);
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói (để giữ dáng tôi đi bộ)."), false);
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói vì say xe (hôm khác ăn xong mình ói để giảm cân)."), true);
  for (const q of ["(", ")", "((((", "))))", "Ăn xong mình ói (hằng ngày để giảm cân.", "Ăn xong mình ói ()) ((( để giảm cân.", "\u0001Ăn xong mình ói\u0001 để giảm cân"]) {
    assert.doesNotThrow(() => analyzeInducedVomiting(q), JSON.stringify(q));
  }
});

test("IV-S.07 homographs: ôm is not ốm, unaccented 'oi' after a first-person word is a vocative, ôi / ơi are interjections", () => {
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói để ôm con ngủ"), false);
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói để ốm"), true);
  assert.equal(detectBareVomitingDisclosure("an xong minh oi de giam can"), false);
  assert.equal(detectBareVomitingDisclosure("an xong minh hay oi de giam can"), true);
  assert.equal(detectBareVomitingDisclosure("Ôi ăn xong mình ói vì sợ tăng cân"), true);
  assert.equal(detectBareVomitingDisclosure("Ăn xong em ơi tập gì để giảm cân?"), false);
});

test("IV-S.08 linear time on adversarial 200k-char inputs; empty / non-string inputs are safe", () => {
  const inputs = ["Ăn xong mình ói ".repeat(12500) + " để giảm cân", "(".repeat(200000), "Ăn xong mình ói, ".repeat(11000), "ói ".repeat(66000)];
  for (const q of inputs) {
    const t0 = performance.now();
    detectBareVomitingDisclosure(q);
    assert.ok(performance.now() - t0 < 1500, `slow on ${q.length} chars`);
  }
  assert.equal(detectBareVomitingDisclosure(""), false);
  assert.equal(detectBareVomitingDisclosure(undefined as unknown as string), false);
  assert.equal(detectBareVomitingDisclosure(null as unknown as string), false);
});

// ── M8b-S2: Unicode canonical view (invisible / stray / duplicate marks on the trigger words) ─────────────────────────────────────────
// TEST FIXTURE: oracles are hand-written from the contract "a mark the reader cannot see (default-ignorable), a mark Vietnamese does not use, or a
// second tone mark on one syllable must not change the verdict of the CLEAN text". Escapes are written out (\u034f = CGJ, \u0301 = acute, ...).
const IV_A = "Ăn xong ";
const IV_P = " để giảm cân.";
const DECORATIONS: Array<[string, (w: string) => string]> = [
  ["acute after ói (óí)", (w) => w + "\u0301"], ["grave after", (w) => w + "\u0300"], ["tilde after", (w) => w + "\u0303"],
  ["hook after", (w) => w + "\u0309"], ["dot below after", (w) => w + "\u0323"], ["three tone marks after", (w) => w + "\u0301\u0300\u0323"],
  ["CGJ U+034F after", (w) => w + "\u034f"], ["ZWSP after", (w) => w + "\u200b"], ["ZWNJ after", (w) => w + "\u200c"], ["ZWJ after", (w) => w + "\u200d"],
  ["WJ U+2060 after", (w) => w + "\u2060"], ["BOM after", (w) => w + "\ufeff"], ["soft hyphen after", (w) => w + "\u00ad"], ["VS16 after", (w) => w + "\ufe0f"],
  ["Cyrillic mark U+0483 after", (w) => w + "\u0483"], ["enclosing U+20DD after", (w) => w + "\u20dd"], ["macron U+0304 after", (w) => w + "\u0304"],
  ["ZWSP inside (ó|i)", (w) => w.replace("ó", "ó\u200b")], ["CGJ inside (ó|i)", (w) => w.replace("ó", "ó\u034f")], ["ZWJ inside", (w) => w.replace("ó", "ó\u200d")],
  ["BOM inside", (w) => w.replace("ó", "ó\ufeff")], ["tag character inside", (w) => w.replace("ó", "ó\u{e0041}")],
];
test("IV-S.09 [red before] marks attached to the vomit verb: a first-person disclosure is still a DISCLOSURE (events / outcome identical to the clean text)", () => {
  const clean = analyzeInducedVomiting(`${IV_A}mình ói${IV_P}`);
  assert.equal(clean.disclosure, true);
  for (const [label, deco] of DECORATIONS) {
    const q = `${IV_A}mình ${deco("ói")}${IV_P}`;
    for (const form of [q, q.normalize("NFD")]) {
      const a = analyzeInducedVomiting(form);
      assert.equal(a.disclosure, true, `${label}: ${JSON.stringify(form)}`);
      assert.equal(detectBareVomitingDisclosure(form), true, label);
      assert.equal(a.events[0].actor, "FIRST", label);
      assert.equal(a.events[0].outcome, "DISCLOSURE", label);
    }
  }
});

test("IV-S.10 [red before] mửa / the subject / the anchor / the purpose carrying the same marks are still recognised", () => {
  for (const mark of ["\u0301", "\u034f", "\u200b", "\u0483", "\u20dd"]) {
    assert.equal(detectBareVomitingDisclosure(`${IV_A}mình mửa${mark}${IV_P}`), true, `mửa + ${JSON.stringify(mark)}`);
    assert.equal(detectBareVomitingDisclosure(`${IV_A}mình${mark} ói${IV_P}`), true, `subject + ${JSON.stringify(mark)}`);
    assert.equal(detectBareVomitingDisclosure(`Ăn${mark} xong mình ói${IV_P}`), true, `anchor + ${JSON.stringify(mark)}`);
    assert.equal(detectBareVomitingDisclosure(`${IV_A}mình ói để${mark} giảm cân.`), true, `purpose + ${JSON.stringify(mark)}`);
  }
  assert.equal(detectBareVomitingDisclosure("ĂN XONG MÌNH ÓI\u034f ĐỂ GIẢM CÂN."), true);
});

test("IV-S.11 the same marks never change the attribution / negation / actor / vocative / cause / anchor decisions of the CLEAN text (benign twins stay NOT a disclosure)", () => {
  const sentences = [
    `${IV_A}mình ơi{M}${IV_P}`, // vocative "mình ơi"
    `${IV_A}mình ô{M}i${IV_P}`, `${IV_A}mình ối{M}${IV_P}`, // interjections ôi / ối
    `${IV_A}bạn mình ói{M}${IV_P}`, `${IV_A}em nó ói{M}${IV_P}`, `${IV_A}chị tôi nôn{M}${IV_P}`, // other actors
    `${IV_A}mình không ói{M}${IV_P}`, `${IV_A}mình chưa ói{M}${IV_P}`, `${IV_A}mình đừng ói{M}${IV_P}`, // negation
    `${IV_A}mình muốn biết cách ói{M}${IV_P}`, `${IV_A}mình bị ói{M}${IV_P}`, // request / symptom words
    `${IV_A}mình ói{M} vì say xe.`, `${IV_A}mình ói{M} để giảm cân vì say xe.`, // benign cause (same event wins)
    `Mình ói{M} để giảm cân.`, `Sau khi ăn bé ói{M}. Mình muốn giảm cân.`, // no anchor / another sentence
    `${IV_A}mình ói{M}.`, // no purpose
    `Em bé ói{M} sữa sau khi ăn, mình có nên đưa đi khám?`, `${IV_A}mình đi bộ giữa trời mưa{M} để giảm cân.`, `${IV_A}mình ôm{M} con để giữ dáng.`, // other words
    `an xong minh oi{M} de giam can`, // unaccented vocative reading (pinned behaviour, unchanged)
  ];
  for (const tpl of sentences) {
    const clean = tpl.replace("{M}", "");
    assert.equal(detectBareVomitingDisclosure(clean), false, `clean twin must be benign: ${clean}`);
    for (const mark of ["", "\u0301", "\u034f", "\u200b", "\u200d", "\ufeff", "\u0483", "\u20dd"]) {
      const q = tpl.replace("{M}", mark);
      assert.equal(detectBareVomitingDisclosure(q), false, JSON.stringify(q));
      assert.equal(analyzeInducedVomiting(q).events.some((e) => e.outcome === "DISCLOSURE"), false, JSON.stringify(q));
    }
  }
  // inside-the-word placement of an invisible mark in the benign interjections / third-person verb
  for (const q of [`${IV_A}mình ơ\u200bi${IV_P}`, `${IV_A}mình ơ\u034fi${IV_P}`, `${IV_A}bạn mình ó\u200bi${IV_P}`, `${IV_A}mình không ó\u034fi${IV_P}`, `${IV_A}mình ó\u200bi vì say xe.`]) {
    assert.equal(detectBareVomitingDisclosure(q), false, JSON.stringify(q));
  }
});

test("IV-S.12 the original-text view is unchanged: invisible separators between words still separate them, decisions of text WITHOUT such marks are untouched", () => {
  assert.equal(detectBareVomitingDisclosure(`${IV_A}mình ói\u200bđể giảm cân.`), true); // ZWSP as a separator (historical behaviour, original view)
  assert.equal(detectBareVomitingDisclosure(`${IV_A}mình\u200bói để giảm cân.`), true);
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói để giảm cân."), true);
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói vì say xe."), false);
  assert.equal(analyzeInducedVomiting("Ăn xong mình ói vì say xe.").events[0].outcome, "SYMPTOM");
  // a text with no vomit verb and no canonicalisable mark is analysed in ONE view with the former counters
  assert.deepEqual(analyzeInducedVomiting("Hôm nay mình tập chân.").stats, { chars: "Hôm nay mình tập chân.".length, tokens: 0, tokenVisits: 0, regexChars: 0 });
  // the canonical form changes nothing for plain Vietnamese (NFC and NFD spellings of clean text give the same verdict)
  for (const q of ["Ăn xong mình ói để giảm cân.", "Ăn xong mình ói vì say xe.", "Ăn xong bạn mình ói để giảm cân."]) {
    assert.equal(detectBareVomitingDisclosure(q.normalize("NFD")), detectBareVomitingDisclosure(q), q);
  }
});

test("IV-S.13 bounded: a non-disclosing 200k-char text full of invisible / stray marks is analysed in at most 2 linear views", () => {
  const q = "Ăn xong mình không ói\u034f ".repeat(8000);
  const t0 = performance.now();
  const a = analyzeInducedVomiting(q);
  assert.equal(a.disclosure, false);
  assert.ok(performance.now() - t0 < 2500, "slow");
  assert.ok(a.stats.tokenVisits / Math.max(1, a.stats.tokens) <= 40, `${a.stats.tokenVisits} / ${a.stats.tokens}`);
  assert.ok(a.stats.regexChars <= 8 * (q.length + 64), `regex chars ${a.stats.regexChars}`);
  // a disclosure early in a marked text still short-circuits before the second view
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói\u034f để giảm cân. " + "Hôm nay tôi tập chân. ".repeat(9000)), true);
  // many tone marks inside ONE word (15k marks; the pre-existing NFD of one huge mark run is super-linear beyond that, far above the 2000-char input cap)
  const t1 = performance.now();
  assert.equal(detectBareVomitingDisclosure("Ăn xong mình ói" + "\u0301\u0300\u0323".repeat(5000) + " để giảm cân."), true);
  assert.ok(performance.now() - t1 < 1500, "slow (stacked marks)");
});

test("IV-S.14 [red before] a stray tone / vowel mark on a consonant, a mark stacked on the same letter (NFD reorders them) and a doubled tone on the subject do not hide the words; marks after the clean word never create an event", () => {
  for (const q of [
    `${IV_A}m\u0300ình ói${IV_P}`, `${IV_A}m\u0301ình ói${IV_P}`, `${IV_A}mình ó\u0323i${IV_P}`, `${IV_A}mình ó\u0300\u0323i${IV_P}`, `${IV_A}mình ó\u0309\u0323\u0300i${IV_P}`,
    `${IV_A}mì\u0323nh ói${IV_P}`, `${IV_A}mì\u0301nh ó\u0323i${IV_P}`, `${IV_A}mình ói\u0323\u0303${IV_P}`, `${IV_A}mình mử\u0323a${IV_P}`, `${IV_A}t\u0301ôi ói${IV_P}`,
  ]) assert.equal(detectBareVomitingDisclosure(q), true, JSON.stringify(q));
  // the same stray marks on a benign twin stay benign (a mark on the relation head itself, e.g. "b\u0300ạn mình ói", already refuses in the ORIGINAL view: unchanged, fail-closed side)
  for (const q of [`${IV_A}mì\u0323nh không ói${IV_P}`, `${IV_A}mình ơ\u0323i${IV_P}`, `${IV_A}mình ô\u0300\u0323i${IV_P}`, `${IV_A}mì\u0323nh ơi${IV_P}`]) {
    assert.equal(detectBareVomitingDisclosure(q), false, JSON.stringify(q));
  }
});
