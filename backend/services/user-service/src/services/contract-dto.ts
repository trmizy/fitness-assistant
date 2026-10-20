/**
 * Who may see a contract's money split.
 *
 * A contract row stores the revenue split frozen at signing (platformRate / ptRate / gymRate), the PT holdback snapshot, what has
 * been released to each party and the PT-gym agreement the rates came from. That is the PT's (and the platform's) business: the
 * client pays a price for a package and never needs - or gets - to see how it is divided. The PT of THAT contract (and an admin)
 * see the whole row; every other viewer gets it without these fields.
 *
 * Pure helpers: the controllers call them on the way out, so the rule lives in one place and is unit-tested without a database.
 */

export const SPLIT_FIELDS_HIDDEN_FROM_CLIENT = [
  "platformRate",
  "ptRate",
  "gymRate",
  "ptHoldbackRate",
  "holdbackReleasedAt",
  "releasedToPt",
  "releasedToGym",
  "releasedToPlatform",
  "gymAgreementId",
  "gymAgreementScope",
] as const;

export interface ContractViewer {
  userId?: string | null;
  role?: string | null;
}

type Obj = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Obj =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** A contract row, recognised by its shape (the split snapshot columns are always present on a stored row). */
function isContractRow(v: Obj): boolean {
  return typeof v.ptUserId === "string" && typeof v.clientUserId === "string" && "ptRate" in v && "platformRate" in v;
}

/** Whether this viewer is entitled to the split of a contract owned by `ptUserId`. */
export function mayViewContractSplit(viewer: ContractViewer, ptUserId: string): boolean {
  return viewer.role === "ADMIN" || (!!viewer.userId && viewer.userId === ptUserId);
}

function stripSplit(row: Obj): Obj {
  const copy: Obj = { ...row };
  for (const field of SPLIT_FIELDS_HIDDEN_FROM_CLIENT) delete copy[field];
  return copy;
}

/**
 * Returns `value` with the split fields removed from every contract row in it (a row, an array of rows, or sessions that
 * embed their `contract`) the viewer is not entitled to. Rows the viewer may see - and anything that is not a contract -
 * pass through untouched. Never mutates its input.
 */
export function redactContractSplit<T>(value: T, viewer: ContractViewer): T {
  if (Array.isArray(value)) return value.map((item) => redactContractSplit(item, viewer)) as unknown as T;
  if (!isPlainObject(value)) return value;
  if (isContractRow(value)) {
    return (mayViewContractSplit(viewer, value.ptUserId as string) ? value : stripSplit(value)) as unknown as T;
  }
  if ("contract" in value && isPlainObject(value.contract)) {
    return { ...value, contract: redactContractSplit(value.contract, viewer) } as unknown as T;
  }
  return value;
}

/** The only money-breakdown fields a client viewer receives: aggregates about their own money, nothing about how it is divided. */
const CLIENT_BREAKDOWN_FIELDS = [
  "contractId",
  "paid",
  "price",
  "totalSessions",
  "usedSessions",
  "compensatedSessions",
  "unit",
  "remaining",
  "refundIfCancelledNow",
  "reasonUsed",
  "canExitWithoutPenalty",
  "exitReasonIfCancelledNow",
  "unresolvedSessions",
  "unresolvedAmountHeld",
] as const;

/**
 * `GET /contracts/:id/money-breakdown`. The contract's PT and admins get the whole object. Everyone else (the client) gets
 * only client-relevant aggregates - what they paid (`paidTotal`), what is still worth something to them (`remaining`,
 * `refundIfCancelledNow`), the value of the missed sessions they were refunded for (`refundedSessionsValue`) - and never the
 * frozen `rates`, nor `released` / `stillPending` / `actuallyReleased` per pt / gym / platform. Whitelist, so a field added
 * to the payload later is hidden by default.
 */
export function redactBreakdownForViewer<T>(breakdown: T, viewer: ContractViewer, ptUserId: string): T {
  if (!isPlainObject(breakdown) || mayViewContractSplit(viewer, ptUserId)) return breakdown;
  const out: Obj = {};
  for (const field of CLIENT_BREAKDOWN_FIELDS) if (field in breakdown) out[field] = breakdown[field];
  const price = Number(breakdown.price);
  const total = Number(breakdown.totalSessions);
  const compensated = Number(breakdown.compensatedSessions ?? 0);
  if (Number.isFinite(price)) out.paidTotal = (breakdown.paid === true ? price : 0).toFixed(2);
  if (Number.isFinite(price) && total > 0 && Number.isFinite(compensated)) {
    out.refundedSessionsValue = (Math.floor((price * compensated) / total)).toFixed(2);
  }
  return out as unknown as T;
}

/**
 * `GET /contracts/:id/checkout-context`. The contract's PT and admins get the whole object; the client gets it WITHOUT the frozen
 * revenue split (`rates`) and without the PT-gym agreement ids/scope the split came from. Everything the client needs to understand
 * what they are about to pay (amount, package, deadline, the re-check) stays.
 */
export function redactCheckoutContextForViewer<T>(context: T, viewer: ContractViewer, ptUserId: string): T {
  if (!isPlainObject(context) || mayViewContractSplit(viewer, ptUserId)) return context;
  const out: Obj = { ...context };
  delete out.rates;
  if (isPlainObject(out.gym)) out.gym = { ...out.gym, agreementId: null, agreementScope: null };
  return out as unknown as T;
}

/**
 * The money result of ending a contract (`settlement` in the terminate response). payment-service's answer carries what each
 * party is finally entitled to; the client's screens only read `refund` (and `remaining` / `reason`). Same whitelist rule.
 */
export function redactSettlementForViewer<T>(settlement: T, viewer: ContractViewer, ptUserId: string): T {
  if (!isPlainObject(settlement) || mayViewContractSplit(viewer, ptUserId)) return settlement;
  const out: Obj = {};
  for (const field of ["reason", "remaining", "refund"]) if (field in settlement) out[field] = settlement[field];
  return out as unknown as T;
}
