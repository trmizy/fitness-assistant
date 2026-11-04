// REAL HTTP/API smoke of the Dispute V2.1 flow through the gateway of the isolated e2e stack (needs `seed.sh` first). Prints one line per step.
// Two different admins (four-eyes): admin1 investigates/proposes, admin2 approves. TEST FIXTURE note: the D-NEW-12 policy review is done through the
// four-eyes API here, but it is a fixture-level judgement ("this contract is under the current policy"), not real eligibility proof.
import { USERS, http, login, loadState, data, sleep } from "./lib.mjs";

const S = loadState();
if (!S.disputeSessionId) {
  console.error("not seeded: run scripts/e2e-dispute/seed.sh first");
  process.exit(2);
}
const results = [];
const step = async (name, fn) => {
  try {
    const out = await fn();
    results.push({ name, ok: true, out });
    console.log(`PASS  ${name}${out ? "  -> " + out : ""}`);
    return out;
  } catch (e) {
    results.push({ name, ok: false, out: e.message });
    console.log(`FAIL  ${name}  -> ${e.message}`);
    throw e;
  }
};
const expect = (r, ok, what) => {
  const list = Array.isArray(ok) ? ok : [ok];
  if (!list.includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  return data(r);
};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

const T = {};
for (const k of ["admin1", "admin2", "client"]) T[k] = await login(USERS[k]);
const A = "/admin/dispute-cases";
let caseId;
let detail;
const short = (o) => JSON.stringify(o).slice(0, 160);

try {
  await step("capabilities: execution/evidence/D65-B ON, T0 + late-open OFF", async () => {
    const c = expect(await http("GET", `${A}/capabilities`, T.admin1), 200, "capabilities");
    if (!(c.execution && c.evidenceStorage && c.d65bResolution)) throw new Error("expected ON: " + short(c));
    if (c.t0 || c.lateOpenReconciliation) throw new Error("T0/late-open must be OFF: " + short(c));
    return short({ execution: c.execution, evidenceStorage: c.evidenceStorage, d65b: c.d65bResolution, t0: c.t0, lateOpen: c.lateOpenReconciliation, runtime: c.runtime });
  });

  await step("open case on the DISPUTED session", async () => {
    const r = expect(await http("POST", A, T.admin1, { sessionId: process.env.SMOKE_SESSION_ID || S.disputeSessionId }), [200, 201], "open");
    caseId = r.result?.case?.id ?? r.case?.id ?? r.id;
    if (!caseId) throw new Error("no case id in " + short(r));
    return caseId;
  });
  await step("assign to admin1", async () => short(expect(await http("POST", `${A}/${caseId}/assign`, T.admin1, {}), 200, "assign")?.result ?? "ok"));
  await step("transition COLLECTING", async () => {
    expect(await http("POST", `${A}/${caseId}/transition`, T.admin1, { to: "COLLECTING" }), 200, "COLLECTING");
    return "ok";
  });
  await step("client uploads an evidence FILE (server-side storage + sha256)", async () => {
    const fd = new FormData();
    fd.append("file", new Blob([PNG], { type: "image/png" }), "e2e-dispute.png");
    fd.append("description", "E2E_DISPUTE: ảnh minh chứng của khách hàng");
    const r = expect(await http("POST", `/dispute-cases/${caseId}/evidence-files`, T.client, fd), [200, 201], "evidence file");
    return short(r);
  });
  const claim = await step("add claim (CLIENT)", async () => {
    const r = expect(await http("POST", `${A}/${caseId}/claims`, T.admin1, { claimantRole: "CLIENT", text: "PT không có mặt đủ giờ", moves: ["MONEY", "QUOTA"] }), [200, 201], "claim");
    return r.result?.id ?? r.id;
  });
  await step("transition ASSESSING", async () => {
    expect(await http("POST", `${A}/${caseId}/transition`, T.admin1, { to: "ASSESSING" }), 200, "ASSESSING");
    return "ok";
  });
  await step("case detail (evidence listed)", async () => {
    detail = expect(await http("GET", `${A}/${caseId}`, T.admin1), 200, "detail");
    const ev = detail.evidence ?? detail.case?.evidence ?? [];
    return `evidence rows: ${ev.length} [${[...new Set(ev.map((e) => e.subject ?? e.source))].join(",")}]`;
  });
  const evidence = detail.evidence ?? detail.case?.evidence ?? [];
  const direct = evidence.filter((e) => e.subject === "SESSION_ROW").map((e) => e.id);
  await step("assessment ESTABLISHED", async () => {
    expect(
      await http("POST", `${A}/${caseId}/assessments`, T.admin1, {
        claimId: claim, directEvidenceIds: direct.length ? direct : [evidence[0].id], indirectEvidenceIds: [], rebuttalEvidenceIds: [],
        relevanceNote: "Đúng buổi, đúng khung giờ", verifiabilityNote: "Dữ liệu máy chủ", consistencyNote: "Khớp các nguồn còn lại", result: "ESTABLISHED", reasoning: "Dữ liệu phòng và lời khai khớp nhau",
      }), [200, 201], "assessment");
    return "ok";
  });
  await step("record finding VERIFIED_PT_ABSENT", async () => {
    expect(await http("POST", `${A}/${caseId}/findings`, T.admin1, { finding: "VERIFIED_PT_ABSENT", reasoning: "Đã xác minh bằng dữ liệu hệ thống" }), [200, 201], "finding");
    return "ok";
  });
  const review = await step("D-NEW-12 policy review PROPOSE (admin1) [TEST FIXTURE judgement]", async () => {
    const r = expect(await http("POST", `${A}/${caseId}/policy-eligibility`, T.admin1, { result: "ELIGIBLE_CURRENT_POLICY", evidenceIds: [evidence[0].id], reasoning: "TEST FIXTURE: hợp đồng E2E thuộc chính sách hiện hành" }), [200, 201], "policy propose");
    const id = r.result?.reviewId ?? r.reviewId ?? r.result?.id ?? r.review?.reviewId ?? r.review?.id ?? r.id;
    if (!id) throw new Error("no review id in " + short(r));
    return id;
  });
  await step("D-NEW-12 policy review APPROVE (admin2, four-eyes)", async () => {
    expect(await http("POST", `${A}/${caseId}/policy-eligibility/${review}/approve`, T.admin2, { reason: "TEST FIXTURE: đồng ý", conflictOfInterestDeclaredNone: true }), [200, 201], "policy approve");
    return "ok";
  });
  const proposal = await step("proposal (admin1)", async () => {
    const r = expect(await http("POST", `${A}/${caseId}/proposals`, T.admin1, {}), [200, 201], "proposal");
    return short(r.result ?? r);
  });
  await step("second-admin APPROVE (admin2)", async () => {
    const r = expect(await http("POST", `${A}/${caseId}/approvals`, T.admin2, { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true, evidenceChangeAcknowledged: false }), [200, 201], "approve");
    return short(r.result ?? r);
  });
  await step("EXECUTE (admin1) -> real ledger via payment-service", async () => {
    const r = expect(await http("POST", `${A}/${caseId}/execute`, T.admin1, {}), [200, 201, 202], "execute");
    return short(r.result ?? r);
  });
  await step("read execStatus", async () => {
    let d;
    for (let i = 0; i < 15; i++) {
      d = expect(await http("GET", `${A}/${caseId}`, T.admin1), 200, "detail");
      const st = d.execution?.status ?? d.executions?.[0]?.status ?? d.execStatus ?? d.case?.execStatus;
      if (st && /EXECUTED|DONE|SUCCEEDED|COMPLETED|FAILED|NEEDS_HUMAN/.test(String(st))) return `execStatus=${st} caseStatus=${d.case?.status ?? d.status}`;
      await sleep(1500);
    }
    return `no terminal execStatus after 22s; keys=${Object.keys(d).join(",")} caseStatus=${d.case?.status ?? d.status}`;
  });
  await step("D65-B list (admin)", async () => {
    const r = expect(await http("GET", "/admin/unconfirmed-session-resolutions", T.admin1), 200, "d65b list");
    return `items=${(r.items ?? []).length}`;
  });
  await step("gym complaint case: list (admin)", async () => {
    const r = expect(await http("GET", "/admin/complaint-cases", T.admin1), 200, "gym case list");
    return `items=${(r.items ?? r.cases ?? (Array.isArray(r) ? r : [])).length}`;
  });
  await step("gym complaint case: open on the seeded complaint", async () => {
    const r = expect(await http("POST", `/admin/complaints/${S.gymComplaintId}/case`, T.admin1, { caseClass: "GYM_GENERAL" }), [200, 201, 409], "gym open");
    return short(r.id ? { id: r.id, status: r.status } : r);
  });
} catch {
  // the failing step is already printed
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\nSMOKE ${failed ? "FAILED" : "PASSED"}: ${results.filter((r) => r.ok).length} passed, ${failed} failed, ${results.length} steps  [REAL HTTP/API via ${S.gateway}]`);
process.exit(failed ? 1 : 0);
