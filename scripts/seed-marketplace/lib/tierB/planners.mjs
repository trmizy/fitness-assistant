// Tier B "ensure" decisions as PURE functions: (what the API reports now, what the scenario wants) -> the actions still to do.
// Because they only look at the observed state, running the seed again after a partial or complete run yields [] (or only the
// missing tail) - that is the idempotency contract, unit-tested in __tests__/planners.test.mjs without any network.

/** PT application (user-service /pt-applications). `observed` = status string or null when no application row exists. */
export function planPtApplication(observed, target) {
  const rank = { NONE: 0, DRAFT: 1, SUBMITTED: 2, UNDER_REVIEW: 3 };
  const terminal = new Set(["NEEDS_MORE_INFO", "REJECTED", "APPROVED"]);
  const obs = observed ?? "NONE";
  if (obs === target) return { actions: [], conflict: null };
  if (terminal.has(obs)) {
    // NEEDS_MORE_INFO may legitimately move on (the applicant re-submits), the rest are final for the seed's purposes.
    if (!(obs === "NEEDS_MORE_INFO" && target !== "NEEDS_MORE_INFO")) return { actions: [], conflict: `application is ${obs}, scenario wants ${target}` };
  }
  const have = terminal.has(obs) ? 3 : rank[obs];
  const actions = [];
  if (have < 1) actions.push("saveDraft", "uploadDocuments");
  if (target === "DRAFT") return { actions, conflict: have > 1 ? `application is ${obs}, scenario wants DRAFT` : null };
  if (have < 2) {
    if (!actions.includes("saveDraft")) actions.push("saveDraft", "uploadDocuments");
    actions.push("submit");
  }
  if (obs === "NEEDS_MORE_INFO") actions.push("submit");
  if (target === "SUBMITTED") return { actions, conflict: have > 2 ? `application is ${obs}, scenario wants SUBMITTED` : null };
  if (have < 3 || obs === "NEEDS_MORE_INFO") actions.push("review:UNDER_REVIEW");
  if (target === "UNDER_REVIEW") return { actions, conflict: null };
  actions.push({ NEEDS_MORE_INFO: "review:NEEDS_MORE_INFO", REJECTED: "review:REJECTED", APPROVED: "review:APPROVED" }[target]);
  return { actions, conflict: null };
}

/**
 * Listing workflow of ONE listing (a PT or a branch). `obs`:
 *   { approvedByOwner: number of OWNER revisions already APPROVED, open: 'DRAFT'|'PENDING'|null,
 *     closed: { CHANGES_REQUESTED: n, REJECTED: n, STALE: n, APPROVED_ADMIN: n, WITHDRAWN: n } }
 * `want`: { kind, rounds, adminDirectEdit }
 */
export function planListing(obs, want) {
  const actions = [];
  const done = obs.approvedByOwner ?? 0;
  const closed = obs.closed ?? {};
  // 1. rounds that end in APPROVED (the listing's history)
  for (let i = done; i < (want.rounds ?? 0); i++) actions.push("round");
  const hasOpen = obs.open != null;
  // a half-finished "round" leaves an open revision; rounds are atomic in the executor, so an open one here is the tail's
  const roundsPending = actions.length > 0;
  const k = want.kind;
  if (k === "NONE" || k === "APPROVED" || k == null) return actions;
  if (roundsPending && hasOpen) actions.unshift("discardOpen");
  const need = (name) => actions.push(name);
  switch (k) {
    case "DRAFT":
      if (!hasOpen || roundsPending) need("openDraft");
      break;
    case "PENDING":
      if (obs.open === "PENDING" && !roundsPending) break;
      if (obs.open === "DRAFT" && !roundsPending) need("submit");
      else need("openDraft"), need("submit");
      break;
    case "CHANGES_REQUESTED":
      if ((closed.CHANGES_REQUESTED ?? 0) > 0 && !roundsPending) break; // the executor made the child draft with it
      if (obs.open === "PENDING" && !roundsPending) need("requestChanges");
      else if (obs.open === "DRAFT" && !roundsPending) need("submit"), need("requestChanges");
      else need("openDraft"), need("submit"), need("requestChanges");
      break;
    case "REJECTED":
      if ((closed.REJECTED ?? 0) > 0 && !roundsPending) break;
      if (obs.open === "PENDING" && !roundsPending) need("reject");
      else if (obs.open === "DRAFT" && !roundsPending) need("submit"), need("reject");
      else need("openDraft"), need("submit"), need("reject");
      break;
    case "STALE":
      if ((closed.STALE ?? 0) > 0 && !roundsPending) break;
      if (obs.open === "PENDING" && !roundsPending) need("adminDirectEdit");
      else if (obs.open === "DRAFT" && !roundsPending) need("submit"), need("adminDirectEdit");
      else need("openDraft"), need("submit"), need("adminDirectEdit");
      break;
    default:
      throw new Error(`unknown listing kind ${k}`);
  }
  return actions;
}

/** Gym partner application (gym-service /owner/application, /admin/partners/:id/application). `observed` = AccessState or null (no account yet). */
export const APPLICATION_SECTIONS = ["representative", "businessScale", "brand", "branch", "location", "amenities", "photos", "legal", "documents", "social"];

export function planPartnerApplication(observed, want) {
  const actions = [];
  const obs = observed ?? "NONE";
  const target = want.state;
  const order = ["NONE", "ONBOARDING", "UNDER_REVIEW", "CHANGES_REQUESTED", "REJECTED", "APPROVED_PAYOUT_PENDING", "ACTIVE", "SUSPENDED"];
  const lvl = (s) => order.indexOf(s);
  if (obs === target && target !== "ONBOARDING") return { actions: [], conflict: null };
  if (lvl(obs) > 2 && obs !== target && !["APPROVED_PAYOUT_PENDING"].includes(obs)) {
    if (!(obs === "CHANGES_REQUESTED" && target !== "CHANGES_REQUESTED")) return { actions: [], conflict: `application is ${obs}, scenario wants ${target}` };
  }
  if (obs === "NONE") actions.push("createAccount", "bootstrap");
  if (target === "ONBOARDING") {
    actions.push(`fillSections:${want.onboardingSections ?? 1}`);
    return { actions, conflict: lvl(obs) > 1 ? `application is ${obs}, scenario wants ONBOARDING` : null };
  }
  if (lvl(obs) <= 1) actions.push("fillSections:all", "submit");
  if (obs === "CHANGES_REQUESTED" && target !== "CHANGES_REQUESTED") actions.push("fillSections:all", "resubmit");
  switch (target) {
    case "UNDER_REVIEW":
      break;
    case "CHANGES_REQUESTED":
      actions.push("admin:requestChanges");
      break;
    case "REJECTED":
      actions.push("admin:reject");
      break;
    case "APPROVED_PAYOUT_PENDING":
      if (lvl(obs) < 5) actions.push("admin:acceptDocuments", "admin:resolveIssues", "admin:resolveProposals", "admin:approve");
      break;
    case "ACTIVE":
    case "SUSPENDED":
      if (lvl(obs) < 5) actions.push("admin:acceptDocuments", "admin:resolveIssues", "admin:resolveProposals", "admin:approve");
      if (lvl(obs) < 6) actions.push("owner:onboarding");
      if (target === "SUSPENDED") actions.push("admin:suspend");
      break;
    default:
      throw new Error(`unknown partner target ${target}`);
  }
  return { actions, conflict: null };
}

/** A branch created outside the application (wizard / quick create). `obs` = { exists, status, operationalStatus, amenitiesDone, hoursDone, photosCount }. */
export function planBranch(obs, want) {
  const a = [];
  if (!obs.exists) a.push(want.createdVia === "WIZARD" ? "createDraft" : "quickCreate");
  if ((!obs.exists || obs.status === "DRAFT") && (!obs.exists || (obs.wizardStep ?? 0) < (want.status === "DRAFT" ? want.wizardStep ?? 2 : 7)) && (want.createdVia === "WIZARD" || (want.status === "DRAFT" && want.createdVia !== "QUICK"))) {
    a.push(`fillWizard:${want.status === "DRAFT" ? want.wizardStep ?? 2 : "all"}`);
  }
  if (want.status === "DRAFT") return a;
  const rank = { DRAFT: 0, PENDING_REVIEW: 1, APPROVED: 2, REJECTED: 2, SUSPENDED: 3 };
  const have = obs.exists ? rank[obs.status] ?? 0 : 0;
  if (want.createdVia === "WIZARD" && have < 1) a.push("submitWizard");
  if (want.status === "PENDING_REVIEW") return a;
  if (want.status === "REJECTED" && obs.status !== "REJECTED") a.push("admin:status:REJECTED");
  if (want.status === "APPROVED" || want.status === "SUSPENDED") {
    if (obs.status !== "APPROVED" && obs.status !== "SUSPENDED") a.push("admin:status:APPROVED");
    if (want.status === "SUSPENDED" && obs.status !== "SUSPENDED") a.push("admin:status:SUSPENDED");
  }
  if (want.op && want.op !== "OPEN" && obs.operationalStatus !== want.op) a.push(`owner:operational:${want.op}`);
  return a;
}

/** Amenity proposal scenarios. `obs` = proposal status or null. */
export function planProposal(obs, want) {
  if (obs == null) {
    const base = ["propose"];
    if (want.outcome === "PENDING") return base;
    if (want.outcome === "APPROVED") return [...base, "admin:approve"];
    if (want.outcome === "REJECTED") return [...base, "admin:reject"];
    if (want.outcome === "MERGED") return [...base, "admin:merge"];
    return base;
  }
  if (obs === want.outcome) return [];
  if (obs === "PENDING") return want.outcome === "APPROVED" ? ["admin:approve"] : want.outcome === "REJECTED" ? ["admin:reject"] : want.outcome === "MERGED" ? ["admin:merge"] : [];
  return [];
}

/** Money flows. */
export function planContract(obs, want) {
  // obs: null | status ; want: 'PENDING_PAYMENT' | 'ACTIVE' | 'COMPLETED'
  const a = [];
  if (obs == null) a.push("request");
  const rank = { PENDING_REVIEW: 1, PENDING_PAYMENT: 2, ACTIVE: 3, COMPLETED: 4 };
  const have = obs == null ? 0 : rank[obs] ?? 9;
  if (have < 2) a.push("accept");
  if (want === "PENDING_PAYMENT") return a;
  if (have < 3) a.push("pay");
  if (want === "ACTIVE") return a;
  if (have < 4) a.push("completeInPast"); // not available through any API: reported, never faked (see SEED.md)
  return a;
}

export function planMembership(obs, want) {
  // obs: null | 'PENDING_PAYMENT' | 'ACTIVE' ; want same
  const a = [];
  if (obs == null) a.push("purchase");
  if (want === "PENDING_PAYMENT") return a;
  if (obs !== "ACTIVE") a.push("pay");
  return a;
}
