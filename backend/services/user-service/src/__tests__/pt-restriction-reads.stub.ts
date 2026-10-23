/**
 * Honest stand-in for the pt-restriction READS (TEST FIXTURE, no database).
 *
 * Several unit tests drive booking / termination / sweep code with every repository replaced, but those code paths ask
 * pt-restriction.service "is this PT (or this contract) paused?" (getActiveRestriction / getActiveContractRestriction /
 * activeRestricted*), and that service reads `prisma.ptRestriction` and the profile's `ptSuspended` flag directly. Without a
 * database those reads threw (PrismaClientInitializationError), so the tests only passed on a machine that happened to
 * have a reachable database - and then silently depended on its content.
 *
 * `stubPtRestrictionReads()` answers those reads exactly as an EMPTY database would: no account restriction, no contract
 * restriction, nobody flagged `ptSuspended`. A test that wants a restricted PT says so with `.set(...)`. Nothing else is
 * faked: WRITES are not stubbed (a test that writes still needs a real `_test` database and the test-db guard), and any
 * other profile read still goes to the real client. The stub restores itself when the test file finishes.
 */
import { after } from "node:test";
import { prisma } from "../repositories/profile.repository";

export interface PtRestrictionReadState {
  /** Rows answering reads with `where.scope === "ACCOUNT"` (findFirst returns the first). Default: none. */
  account?: any[];
  /** Rows answering reads with `where.scope === "CONTRACT"`. Default: none. */
  contract?: any[];
  /** The legacy `user_profiles.pt_suspended` flag, as read by getActiveRestriction (select: { ptSuspended }). Default: false. */
  ptSuspended?: boolean;
}

export interface PtRestrictionReadStub {
  /** Replace the answers (e.g. a restricted PT for one test). `set({})` goes back to "no restriction". */
  set(state: PtRestrictionReadState): void;
  restore(): void;
}

export function stubPtRestrictionReads(initial: PtRestrictionReadState = {}): PtRestrictionReadStub {
  let state: PtRestrictionReadState = initial;
  const db: any = prisma;
  const original = {
    findFirst: db.ptRestriction.findFirst,
    findMany: db.ptRestriction.findMany,
    profileFindUnique: db.userProfile.findUnique,
    profileFindMany: db.userProfile.findMany,
  };
  const rowsFor = (where: any): any[] => {
    const scope = where?.scope;
    if (scope === "ACCOUNT") return state.account ?? [];
    if (scope === "CONTRACT") return state.contract ?? [];
    return [...(state.account ?? []), ...(state.contract ?? [])];
  };
  db.ptRestriction.findFirst = async (args: any) => rowsFor(args?.where)[0] ?? null;
  db.ptRestriction.findMany = async (args: any) => rowsFor(args?.where);
  // Only the flag read (select: { ptSuspended }) is answered here; any other profile read goes to the real client.
  db.userProfile.findUnique = (args: any) =>
    args?.select?.ptSuspended
      ? Promise.resolve({ ptSuspended: state.ptSuspended ?? false, updatedAt: new Date(0) })
      : original.profileFindUnique.call(db.userProfile, args);
  // The "who is flagged" listing (where: { ptSuspended: true }) is an empty database's answer: nobody.
  db.userProfile.findMany = (args: any) =>
    args?.where?.ptSuspended === true ? Promise.resolve([]) : original.profileFindMany.call(db.userProfile, args);

  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    db.ptRestriction.findFirst = original.findFirst;
    db.ptRestriction.findMany = original.findMany;
    db.userProfile.findUnique = original.profileFindUnique;
    db.userProfile.findMany = original.profileFindMany;
  };
  after(restore);
  return {
    set(next) {
      state = next;
    },
    restore,
  };
}
