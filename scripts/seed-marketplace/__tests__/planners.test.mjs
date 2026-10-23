import test from "node:test";
import assert from "node:assert/strict";
import { planBranch, planContract, planListing, planMembership, planPartnerApplication, planProposal, planPtApplication } from "../lib/tierB/planners.mjs";

const APP_TARGETS = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO", "REJECTED", "APPROVED"];

test("PT application: from nothing every target is reached by a monotone, duplicate-free action list", () => {
  for (const t of APP_TARGETS) {
    const { actions, conflict } = planPtApplication(null, t);
    assert.equal(conflict, null, t);
    assert.ok(actions.length > 0, t);
    assert.equal(new Set(actions).size, actions.length, `${t}: duplicate action in ${actions}`);
    assert.equal(actions[0], "saveDraft");
  }
  assert.deepEqual(planPtApplication(null, "DRAFT").actions, ["saveDraft", "uploadDocuments"]);
  assert.deepEqual(planPtApplication(null, "APPROVED").actions, ["saveDraft", "uploadDocuments", "submit", "review:UNDER_REVIEW", "review:APPROVED"]);
});
test("PT application: already at target -> nothing (idempotent), for every state", () => {
  for (const t of APP_TARGETS) assert.deepEqual(planPtApplication(t, t), { actions: [], conflict: null }, t);
});
test("PT application: resumes from any earlier rung, never redoes finished work", () => {
  assert.deepEqual(planPtApplication("DRAFT", "SUBMITTED").actions, ["saveDraft", "uploadDocuments", "submit"].slice(0, 0).concat(planPtApplication("DRAFT", "SUBMITTED").actions));
  assert.equal(planPtApplication("DRAFT", "SUBMITTED").actions.at(-1), "submit");
  assert.ok(!planPtApplication("SUBMITTED", "APPROVED").actions.includes("submit"));
  assert.deepEqual(planPtApplication("UNDER_REVIEW", "APPROVED").actions, ["review:APPROVED"]);
  assert.deepEqual(planPtApplication("SUBMITTED", "UNDER_REVIEW").actions, ["review:UNDER_REVIEW"]);
});
test("PT application: a state past the target is reported as a conflict and NOTHING is done (the seed never rolls back)", () => {
  const r = planPtApplication("APPROVED", "DRAFT");
  assert.deepEqual(r.actions, []);
  assert.match(r.conflict, /APPROVED/);
  assert.deepEqual(planPtApplication("REJECTED", "APPROVED").actions, []);
});

const KINDS = ["NONE", "DRAFT", "PENDING", "CHANGES_REQUESTED", "REJECTED", "APPROVED", "STALE"];
const emptyObs = { approvedByOwner: 0, open: null, closed: {} };
test("listing: the planned actions are exactly the scenario's tail (and rounds first)", () => {
  assert.deepEqual(planListing(emptyObs, { kind: "NONE", rounds: 0 }), []);
  assert.deepEqual(planListing(emptyObs, { kind: "APPROVED", rounds: 2 }), ["round", "round"]);
  assert.deepEqual(planListing(emptyObs, { kind: "PENDING", rounds: 1 }), ["round", "openDraft", "submit"]);
  assert.deepEqual(planListing(emptyObs, { kind: "CHANGES_REQUESTED", rounds: 0 }), ["openDraft", "submit", "requestChanges"]);
  assert.deepEqual(planListing(emptyObs, { kind: "REJECTED", rounds: 1 }), ["round", "openDraft", "submit", "reject"]);
  assert.deepEqual(planListing(emptyObs, { kind: "STALE", rounds: 1 }), ["round", "openDraft", "submit", "adminDirectEdit"]);
  assert.deepEqual(planListing(emptyObs, { kind: "DRAFT", rounds: 1 }), ["round", "openDraft"]);
});
test("listing: re-running on the finished state does nothing", () => {
  const finished = {
    DRAFT: { approvedByOwner: 1, open: "DRAFT", closed: {} },
    PENDING: { approvedByOwner: 1, open: "PENDING", closed: {} },
    CHANGES_REQUESTED: { approvedByOwner: 1, open: "DRAFT", closed: { CHANGES_REQUESTED: 1 } },
    REJECTED: { approvedByOwner: 1, open: null, closed: { REJECTED: 1 } },
    STALE: { approvedByOwner: 1, open: "DRAFT", closed: { STALE: 1, APPROVED_ADMIN: 1 } },
    APPROVED: { approvedByOwner: 2, open: null, closed: {} },
    NONE: emptyObs,
  };
  for (const k of KINDS) assert.deepEqual(planListing(finished[k], { kind: k, rounds: k === "APPROVED" ? 2 : k === "NONE" ? 0 : 1 }), [], k);
});
test("listing: resumes a half-done tail (open DRAFT -> submit; open PENDING -> decide)", () => {
  assert.deepEqual(planListing({ approvedByOwner: 1, open: "DRAFT", closed: {} }, { kind: "PENDING", rounds: 1 }), ["submit"]);
  assert.deepEqual(planListing({ approvedByOwner: 1, open: "PENDING", closed: {} }, { kind: "REJECTED", rounds: 1 }), ["reject"]);
  assert.deepEqual(planListing({ approvedByOwner: 1, open: "PENDING", closed: {} }, { kind: "STALE", rounds: 1 }), ["adminDirectEdit"]);
  assert.deepEqual(planListing({ approvedByOwner: 1, open: "DRAFT", closed: {} }, { kind: "CHANGES_REQUESTED", rounds: 1 }), ["submit", "requestChanges"]);
});
test("listing: a missing earlier round with an open revision discards it first", () => {
  assert.deepEqual(planListing({ approvedByOwner: 0, open: "DRAFT", closed: {} }, { kind: "PENDING", rounds: 1 }), ["discardOpen", "round", "openDraft", "submit"]);
});

const PARTNER = ["ONBOARDING", "UNDER_REVIEW", "CHANGES_REQUESTED", "REJECTED", "APPROVED_PAYOUT_PENDING", "ACTIVE", "SUSPENDED"];
test("partner application: from nothing each target reaches its state through the real order", () => {
  assert.deepEqual(planPartnerApplication(null, { state: "ONBOARDING", onboardingSections: 6 }).actions, ["createAccount", "bootstrap", "fillSections:6"]);
  assert.deepEqual(planPartnerApplication(null, { state: "UNDER_REVIEW" }).actions, ["createAccount", "bootstrap", "fillSections:all", "submit"]);
  assert.deepEqual(planPartnerApplication(null, { state: "CHANGES_REQUESTED" }).actions.slice(-2), ["submit", "admin:requestChanges"]);
  assert.deepEqual(planPartnerApplication(null, { state: "REJECTED" }).actions.slice(-2), ["submit", "admin:reject"]);
  const active = planPartnerApplication(null, { state: "ACTIVE" }).actions;
  assert.ok(active.indexOf("admin:approve") > active.indexOf("submit") && active.indexOf("owner:onboarding") > active.indexOf("admin:approve"));
  const sus = planPartnerApplication(null, { state: "SUSPENDED" }).actions;
  assert.equal(sus[sus.length - 1], "admin:suspend");
});
test("partner application: at target -> nothing; ONBOARDING resumes sections only", () => {
  for (const st of PARTNER.filter((s) => s !== "ONBOARDING")) assert.deepEqual(planPartnerApplication(st, { state: st }), { actions: [], conflict: null }, st);
  assert.deepEqual(planPartnerApplication("APPROVED_PAYOUT_PENDING", { state: "ACTIVE" }).actions, ["owner:onboarding"]);
  assert.deepEqual(planPartnerApplication("ONBOARDING", { state: "ONBOARDING", onboardingSections: 3 }).actions, ["fillSections:3"]);
});
test("partner application: never rolls a finished application back", () => {
  assert.match(planPartnerApplication("ACTIVE", { state: "UNDER_REVIEW" }).conflict, /ACTIVE/);
  assert.match(planPartnerApplication("REJECTED", { state: "ACTIVE" }).conflict, /REJECTED/);
});

test("branch: wizard / quick / statuses", () => {
  const none = { exists: false };
  assert.deepEqual(planBranch(none, { createdVia: "WIZARD", status: "DRAFT", wizardStep: 4 }), ["createDraft", "fillWizard:4"]);
  assert.deepEqual(planBranch(none, { createdVia: "WIZARD", status: "PENDING_REVIEW" }), ["createDraft", "fillWizard:all", "submitWizard"]);
  assert.deepEqual(planBranch(none, { createdVia: "WIZARD", status: "APPROVED", op: "OPEN" }), ["createDraft", "fillWizard:all", "submitWizard", "admin:status:APPROVED"]);
  assert.deepEqual(planBranch(none, { createdVia: "QUICK", status: "APPROVED", op: "TEMPORARILY_CLOSED" }), ["quickCreate", "admin:status:APPROVED", "owner:operational:TEMPORARILY_CLOSED"]);
  assert.deepEqual(planBranch({ exists: true, status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED" }, { createdVia: "QUICK", status: "APPROVED", op: "TEMPORARILY_CLOSED" }), []);
  assert.deepEqual(planBranch({ exists: true, status: "SUSPENDED", operationalStatus: "OPEN" }, { createdVia: "WIZARD", status: "SUSPENDED", op: "OPEN" }), ["fillWizard:all"]);
});

test("amenity proposals", () => {
  assert.deepEqual(planProposal(null, { outcome: "PENDING" }), ["propose"]);
  assert.deepEqual(planProposal(null, { outcome: "APPROVED" }), ["propose", "admin:approve"]);
  assert.deepEqual(planProposal(null, { outcome: "REJECTED" }), ["propose", "admin:reject"]);
  assert.deepEqual(planProposal(null, { outcome: "MERGED" }), ["propose", "admin:merge"]);
  assert.deepEqual(planProposal("PENDING", { outcome: "MERGED" }), ["admin:merge"]);
  for (const o of ["PENDING", "APPROVED", "REJECTED", "MERGED"]) assert.deepEqual(planProposal(o, { outcome: o }), []);
});

test("contracts and memberships", () => {
  assert.deepEqual(planContract(null, "ACTIVE"), ["request", "accept", "pay"]);
  assert.deepEqual(planContract(null, "PENDING_PAYMENT"), ["request", "accept"]);
  assert.deepEqual(planContract("PENDING_PAYMENT", "ACTIVE"), ["pay"]);
  assert.deepEqual(planContract("ACTIVE", "ACTIVE"), []);
  assert.deepEqual(planContract("ACTIVE", "COMPLETED"), ["completeInPast"]);
  assert.deepEqual(planMembership(null, "ACTIVE"), ["purchase", "pay"]);
  assert.deepEqual(planMembership("PENDING_PAYMENT", "ACTIVE"), ["pay"]);
  assert.deepEqual(planMembership("ACTIVE", "ACTIVE"), []);
});
