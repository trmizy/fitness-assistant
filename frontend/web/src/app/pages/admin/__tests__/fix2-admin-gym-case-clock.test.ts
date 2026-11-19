/**
 * FIX2-ADMIN Q7 (15/11/2026): the gym case "Yêu cầu bổ sung" form asks the member, the gym or both and shows each party's response clock.
 * TEST FIXTURE: pure functions + CODE AUDIT of the form source. Run: npx tsx --test src/app/pages/admin/__tests__/fix2-admin-gym-case-clock.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ASK_CHOICES, FIRST_RESPONSE_HOURS, SUPPLEMENT_ROUND_HOURS, clockSentence, partiesOf, previewResponseClocks } from "../complaints/gymResponseClock";

const NOW = new Date("2026-11-15T03:00:00.000Z");
const fmt = (d: Date | string) => new Date(d).toISOString().slice(0, 16);

describe("Q7: who is asked", () => {
  it("offers Khách / Phòng gym / Cả hai and maps them to the API's parties", () => {
    assert.deepEqual(ASK_CHOICES.map((c) => c.label), ["Khách", "Phòng gym", "Cả hai"]);
    assert.deepEqual(partiesOf("MEMBER"), ["MEMBER"]);
    assert.deepEqual(partiesOf("GYM"), ["GYM"]);
    assert.deepEqual(partiesOf("BOTH"), ["MEMBER", "GYM"]);
  });
});

describe("Q7: the clock each party would get (server rule: 72h first, 48h later, a running clock is kept)", () => {
  it("nobody asked before: 72 hours for each, ending 72h after now", () => {
    const [m, g] = previewResponseClocks([], ["MEMBER", "GYM"], NOW);
    assert.equal(m.kind, "FIRST_RESPONSE");
    assert.equal(m.hours, FIRST_RESPONSE_HOURS);
    assert.equal(fmt(m.endsIfSentAt as Date), "2026-11-18T03:00");
    assert.equal(g.hours, 72);
  });

  it("a party that already had a clock gets the 48h supplement round; the other party still gets the first 72h", () => {
    const rows = [{ kind: "FIRST_RESPONSE", partyRole: "MEMBER", status: "MET", dueAt: "2026-11-10T00:00:00.000Z" }];
    const [m, g] = previewResponseClocks(rows, ["MEMBER", "GYM"], NOW);
    assert.equal(m.kind, "SUPPLEMENT_ROUND");
    assert.equal(m.hours, SUPPLEMENT_ROUND_HOURS);
    assert.equal(fmt(m.endsIfSentAt as Date), "2026-11-17T03:00");
    assert.equal(g.kind, "FIRST_RESPONSE");
  });

  it("a still-open clock is kept, not restarted (shown with its own due time, paused time included)", () => {
    const rows = [{ kind: "FIRST_RESPONSE", partyRole: "GYM", status: "OPEN", dueAt: "2026-11-16T00:00:00.000Z", effectiveDueAt: "2026-11-16T06:00:00.000Z" }];
    const [g] = previewResponseClocks(rows, ["GYM"], NOW);
    assert.equal(g.running?.dueAt, "2026-11-16T06:00:00.000Z");
    assert.equal(g.endsIfSentAt, null);
    assert.match(clockSentence(g, fmt), /giữ nguyên, không tính lại/);
  });

  it("the sentence names the party, the hours, the round and the end time", () => {
    const [m] = previewResponseClocks([], ["MEMBER"], NOW);
    assert.equal(clockSentence(m, fmt), "Khách: 72 giờ (lần phản hồi đầu), hết hạn khoảng 2026-11-18T03:00 nếu gửi bây giờ.");
    const [g] = previewResponseClocks([{ partyRole: "GYM", status: "EXPIRED" }], ["GYM"], NOW);
    assert.match(clockSentence(g, fmt), /^Phòng gym: 48 giờ \(vòng bổ sung\)/);
  });

  it("deadlines may name the party under `party` or `partyRole`", () => {
    const [m] = previewResponseClocks([{ party: "MEMBER", status: "MET" }], ["MEMBER"], NOW);
    assert.equal(m.kind, "SUPPLEMENT_ROUND");
  });
});

describe("Q7 / N14A-08: wiring (CODE AUDIT)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src/app/pages/admin", rel), "utf8");
  it("the form sends `parties`, shows the clocks, and the api client forwards it", () => {
    const form = read("complaints/forms/InvestigationForms.tsx");
    assert.match(form, /parties/);
    assert.match(form, /d6-more-clocks/);
    assert.match(read("complaints/gymCaseApi.ts"), /parties: input\.parties/);
  });
  it("after a write the case page re-reads the detail query by key", () => {
    const page = read("complaints/AdminComplaintCasePage.tsx");
    assert.match(page, /invalidateQueries\(\{ queryKey: keys\.detail\(caseId\), exact: true, refetchType: "all" \}\)/);
  });
});
