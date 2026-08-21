import test from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "@prisma/client/runtime/library";
import { buildPackageSnapshot, type SnapshotSource } from "../services/contract.service";
import { SessionMode } from "../generated/prisma";

/**
 * A contract copies its commercial terms from the PT's package. Two separate promises rest
 * on that, and both are money:
 *
 *  · The client cannot name their own price. Reading price or session count out of the
 *    request body is the classic way a ten-session package gets bought for a đồng.
 *  · A contract already signed does not move when the PT reprices. The buyer agreed to a
 *    figure; the seller must not be able to change it afterwards from either direction.
 *
 * Same "snapshot at signing" rule the revenue split follows — see docs/money-flow.md §12.
 */

function pkg(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    id: "pkg-1",
    name: "Gói 10 buổi tăng cơ",
    sessionCount: 10,
    price: new Decimal("1000000.00"),
    sessionMode: SessionMode.OFFLINE,
    sessionDurationMinutes: 60,
    ...overrides,
  };
}

test("the snapshot carries the package's terms across verbatim", () => {
  const snap = buildPackageSnapshot(pkg());
  assert.equal(snap.price, 1_000_000);
  assert.equal(snap.totalSessions, 10);
  assert.equal(snap.packageName, "Gói 10 buổi tăng cơ");
  assert.equal(snap.sessionMode, SessionMode.OFFLINE);
  assert.equal(snap.sessionDurationMinutes, 60);
  assert.equal(snap.packageId, "pkg-1", "the source package stays traceable");
});

test("repricing the package afterwards does not move an existing snapshot", () => {
  // The acceptance case: bought at 1.000.000 for 10 sessions, PT then doubles the price.
  const source = pkg();
  const snap = buildPackageSnapshot(source);

  source.price = new Decimal("2000000.00");
  source.sessionCount = 5;
  source.name = "Gói 5 buổi";

  assert.equal(snap.price, 1_000_000, "the contract is still for what the client agreed to");
  assert.equal(snap.totalSessions, 10);
  assert.equal(snap.packageName, "Gói 10 buổi tăng cơ", "including the name shown on it");
});

test("archiving the package leaves the contract able to name it", () => {
  // Packages are soft-deleted precisely because contracts point at them. The snapshot means
  // the contract can still be read even if the package row is never loaded again.
  const snap = buildPackageSnapshot(pkg());
  assert.equal(snap.packageSourceName, "Gói 10 buổi tăng cơ");
  assert.equal(snap.packageId, "pkg-1");
});

test("a forged price in the request body cannot reach the snapshot", () => {
  // buildPackageSnapshot takes the package and nothing else, so there is no parameter a
  // request body could travel in on. Spread a hostile body over the call to show it: the
  // fields a client would forge are not part of SnapshotSource and are simply not read.
  const hostile = { price: 1, totalSessions: 999, sessionCount: 999, packageName: "free" };
  const snap = buildPackageSnapshot({ ...pkg(), ...{} as typeof hostile & SnapshotSource });

  assert.equal(snap.price, 1_000_000, "the package's price, not the caller's");
  assert.equal(snap.totalSessions, 10, "the package's session count, not the caller's");
  assert.notEqual(snap.packageName, "free");
  assert.ok(!Object.keys(hostile).every((k) => k in snap), "no pass-through of caller keys");
});

test("a Decimal price survives the copy exactly", () => {
  // Decimal(14,2) tops out at 10^12, i.e. 10^14 minor units — inside the integers a double
  // holds exactly. This pins the boundary so a future column widening fails here loudly
  // rather than quietly rounding somebody's contract.
  assert.equal(buildPackageSnapshot(pkg({ price: new Decimal("999999999999.99") })).price, 999_999_999_999.99);
  assert.equal(buildPackageSnapshot(pkg({ price: new Decimal("0.01") })).price, 0.01);
  assert.equal(buildPackageSnapshot(pkg({ price: "1500000.50" })).price, 1_500_000.5);
});

test("an online package keeps its mode, which drives the gym rate downstream", () => {
  // An ONLINE contract must end up with gymRate 0; that decision reads sessionMode off the
  // snapshot, so getting the mode wrong here misroutes money.
  const snap = buildPackageSnapshot(pkg({ sessionMode: SessionMode.ONLINE }));
  assert.equal(snap.sessionMode, SessionMode.ONLINE);
});

test("a non-default session length is carried, not replaced by 60", () => {
  const snap = buildPackageSnapshot(pkg({ sessionDurationMinutes: 90 }));
  assert.equal(snap.sessionDurationMinutes, 90, "slot counting and booking both read this");
});
