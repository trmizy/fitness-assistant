/**
 * FIX4-WEB (15/11/2026) - N15C-01..11. Pure-logic tests (TEST FIXTURE) + source guards (CODE AUDIT) for the web side; the behaviour in a
 * real browser was NOT run in this round (a mobile test owns the dev stack).
 * Run: npx tsx --test src/app/utils/__tests__/n15c-web.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PARTNER_ROLE_CHIP_LABEL } from "../gymStaffRole";
import { ACTIVE_SESSION_STATUSES, bookableSessionsLeft, formatViDateTime, remainingEntitlements } from "../contractQuota";
import { checkinClosedMessage, isBranchAcceptingCheckin, memberScanClosedMessage } from "../branchCheckinState";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), "src/app", rel), "utf8");

describe("N15C-01 real staff role label", () => {
  it("one label per role, shared by the profile chip and the sidebar user card", () => {
    assert.deepEqual(PARTNER_ROLE_CHIP_LABEL, { OWNER: "Chủ phòng gym", MANAGER: "Quản lý chi nhánh", RECEPTIONIST: "Lễ tân", ACCOUNTANT: "Kế toán" });
    assert.match(read("components/layout/Sidebar.tsx"), /PARTNER_ROLE_CHIP_LABEL\[normalizedPartnerRole\]/);
    assert.doesNotMatch(read("components/layout/Sidebar.tsx"), /\? "Chủ phòng gym"/);
    assert.match(read("pages/gym-owner/GymOwnerProfilePage.tsx"), /ROLE_CHIP_LABEL = PARTNER_ROLE_CHIP_LABEL/);
  });
});

describe("N15C-02 staff menu is a Radix DropdownMenu", () => {
  const src = read("pages/gym-owner/ManageManagersPage.tsx");
  it("no hand-rolled open state / mouse-leave close", () => {
    assert.match(src, /<DropdownMenu modal=\{false\}>/);
    assert.doesNotMatch(src, /menuOpenId/);
    assert.doesNotMatch(src, /onMouseLeave/);
  });
  it("focus goes back to the row's trigger when the revoke dialog closes", () => {
    assert.match(src, /menuTriggers\.current\.get\(id\)\?\.focus\(\)/);
    assert.match(src, /closeRevokeDialog\(\)/);
  });
});

describe("N15C-04 reschedule picker touch targets + Vietnamese names", () => {
  const src = read("components/booking/DateSlotPicker.tsx");
  it("month arrows are 40px with Vietnamese aria-labels; day buttons are >= 40px tall and named", () => {
    assert.match(src, /aria-label="Tháng trước"/);
    assert.match(src, /aria-label="Tháng sau"/);
    assert.equal((src.match(/h-10 w-10/g) ?? []).length, 2);
    assert.match(src, /aspect-square min-h-10/);
    assert.match(src, /aria-label=\{`Ngày \$\{day\} tháng \$\{month \+ 1\}`\}/);
  });
  it("the reschedule dialog has a 40px Vietnamese close button", () => {
    const booking = read("pages/client/BookingPage.tsx");
    assert.match(booking, /<ModalClose className="-mr-2 -mt-1" aria-label="Đóng hộp dời lịch" \/>/);
  });
});

describe("N15C-05 / N15C-11 closed branch QR", () => {
  it("only an APPROVED / SUSPENDED branch that is OPEN accepts check-in (mirrors gym-service); unknown status lets the server decide", () => {
    assert.equal(isBranchAcceptingCheckin({ status: "APPROVED", operationalStatus: "OPEN" }), true);
    assert.equal(isBranchAcceptingCheckin({ status: "SUSPENDED", operationalStatus: "OPEN" }), true);
    assert.equal(isBranchAcceptingCheckin({ status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED" }), false);
    assert.equal(isBranchAcceptingCheckin({ status: "APPROVED", operationalStatus: "PERMANENTLY_CLOSED" }), false);
    assert.equal(isBranchAcceptingCheckin({ status: "PENDING_REVIEW", operationalStatus: "OPEN" }), false);
    assert.equal(isBranchAcceptingCheckin(undefined), true);
  });
  it("the closed text names the reopen date when known, and says so when not", () => {
    const withDate = checkinClosedMessage({ status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED", expectedReopenAt: "2026-11-20T00:00:00.000Z" });
    assert.match(withDate, /tạm đóng cửa, dự kiến mở lại ngày 20 tháng 11, 2026/);
    assert.doesNotMatch(checkinClosedMessage({ status: "APPROVED", operationalStatus: "TEMPORARILY_CLOSED" }), /dự kiến/);
    assert.match(checkinClosedMessage({ status: "APPROVED", operationalStatus: "PERMANENTLY_CLOSED" }), /vĩnh viễn/);
    // a 409 answer carrying the date wins even when the page does not know the branch is closed
    assert.match(checkinClosedMessage(undefined, "2026-11-21T00:00:00.000Z"), /21 tháng 11, 2026/);
  });
  it("member scan refusal mentions the reopen date when the server sent one", () => {
    assert.match(memberScanClosedMessage("2026-11-20T00:00:00.000Z"), /dự kiến mở lại ngày 20 tháng 11, 2026/);
    assert.doesNotMatch(memberScanClosedMessage(null), /dự kiến/);
  });
  it("the QR panel does not fetch while closed and never retries a 409; both owner pages pass the branch", () => {
    const panel = read("components/gym/GymCheckinPanel.tsx");
    assert.match(panel, /enabled: branchOpen/);
    assert.match(panel, /status !== 409/);
    assert.match(read("pages/gym-owner/FrontDeskPage.tsx"), /<GymCheckinPanel gymId=\{gymId\} ptCheckinsMode="today" branch=\{gym as any\} \/>/);
    assert.match(read("pages/gym-owner/GymManagePage.tsx"), /<GymCheckinPanel gymId=\{id!\} branch=\{gym as any\} \/>/);
    assert.match(read("components/gym/CheckinScanModal.tsx"), /memberScanClosedMessage\(err\?\.response\?\.data\?\.error\?\.expectedReopenAt\)/);
  });
  it("the invitation preview is read once (no re-fetch after the invitation is accepted)", () => {
    const src = read("pages/auth/PartnerInviteAcceptPage.tsx");
    for (const needle of ["staleTime: Infinity", "refetchOnWindowFocus: false", "refetchOnMount: false", "refetchOnReconnect: false"]) assert.ok(src.includes(needle), needle);
  });
});

describe("N15C-07 / N15C-08 / N15C-09 copy + data on cards", () => {
  it("a hidden branch's deep link says it is unavailable", () => {
    assert.match(read("components/gym/GymDetailModal.tsx"), /Phòng gym này hiện không khả dụng/);
  });
  it("owner list + branch page label an admin suspension and show the reason", () => {
    const list = read("pages/gym-owner/MyGymsPage.tsx");
    assert.match(list, /Đang bị tạm khoá trên Gymini/);
    assert.match(list, /gym\.adminSuspensionReason/);
    const manage = read("pages/gym-owner/GymManagePage.tsx");
    assert.match(manage, /data-testid="gym-admin-suspended"/);
    assert.match(manage, /gym\.adminSuspensionReason/);
  });
  it("member pass cards show the gym name", () => {
    assert.match(read("pages/client/GymMembershipsPage.tsx"), /data-testid="membership-gym-name"[^>]*>\{m\.gymName \?\? "Phòng gym"\}/);
  });
});

describe("N15C-10 booking quota matches the backend rule", () => {
  const contract = { totalSessions: 10, usedSessions: 4, compensatedSessions: 1 };
  it("entitlement = total - used - compensated", () => assert.equal(remainingEntitlements(contract), 5));
  it("bookable = entitlement - sessions already holding a slot (same statuses as countActiveByContract)", () => {
    assert.deepEqual([...ACTIVE_SESSION_STATUSES], ["REQUESTED", "CONFIRMED", "PENDING_CLIENT_CONFIRMATION", "DISPUTED", "PT_NO_SHOW_REPORTED"]);
    const sessions = [{ status: "CONFIRMED" }, { status: "REQUESTED" }, { status: "COMPLETED" }, { status: "CANCELLED" }, { status: "NO_SHOW" }];
    assert.equal(bookableSessionsLeft(contract, sessions), 3);
  });
  it("the bug case: one left on paper but one active booking -> 0, never negative", () => {
    assert.equal(bookableSessionsLeft({ totalSessions: 3, usedSessions: 2 }, [{ status: "CONFIRMED" }]), 0);
    assert.equal(bookableSessionsLeft({ totalSessions: 3, usedSessions: 2 }, [{ status: "CONFIRMED" }, { status: "REQUESTED" }]), 0);
  });
  it("without sessions it falls back to the entitlement", () => assert.equal(bookableSessionsLeft(contract), 5));
  it("date format is vi-VN, 17 tháng 11, 2026 lúc 10:00", () => {
    assert.equal(formatViDateTime(new Date(2026, 10, 17, 10, 0)), "17 tháng 11, 2026 lúc 10:00");
  });
  it("BookingPage uses the shared rule and the new format", () => {
    const src = read("pages/client/BookingPage.tsx");
    assert.match(src, /bookableSessionsLeft\(selectedContract, contractSessions as Session\[\]\)/);
    assert.match(src, /return formatViDateTime\(iso\)/);
  });
});
