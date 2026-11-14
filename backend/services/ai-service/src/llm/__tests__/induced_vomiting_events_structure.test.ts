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
