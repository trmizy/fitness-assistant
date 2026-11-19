/**
 * Bỏ đặt EXPIRED thủ công trong `contractService.updateStatus` (quyết định của Ngài 11/11).
 *
 * Chứng minh (`BACKEND INTEGRATION` trên `gymcoach_user_test` + `TEST FIXTURE` cho `paymentClient`/`notificationService`):
 *  1. PT, ADMIN (và client) gọi `contractService.updateStatus(..., "EXPIRED" | "expired")` trên
 *     hợp đồng `REAL` ở trạng thái `ACTIVE` (đã thanh toán), `COMPLETED`, hoặc `CANCELLED`:
 *     - đều bị từ chối với HTTP 400 + thông báo tiếng Việt hướng dẫn dùng luồng chấm dứt hợp đồng / job hết hạn tự động;
 *     - 0 thay đổi trạng thái hợp đồng, 0 dòng mới trong `session_settlements` / `notifications` / `audit_logs`,
 *       0 lần gọi sang `payment-service`.
 *  2. Các nhánh hợp lệ còn lại của `updateStatus` (`ADMIN` force `PENDING_SIGNATURE -> PENDING_PAYMENT`,
 *     hủy pre-money `PENDING_REVIEW -> CANCELLED`) giữ nguyên hoạt động; `runContractExpirySweep` /
 *     `contractService.expireContracts()` vẫn là đường tự động duy nhất chuyển `ACTIVE` quá hạn sang `EXPIRED`
 *     qua `terminateContractMoney(..., "EXPIRED")`.
 */
import { guardedTest as test, skip } from "./test-db-guard";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { contractRepository } from "../repositories/contract.repository";
import { contractService } from "../services/contract.service";
import { runContractExpirySweep } from "../services/contract-expiry-sweep.service";
import {
  DAY,
  acceptCurrentPtTerms,
  cleanup,
  makeContract,
  makePt,
  patch,
  stubs,
} from "./pt-restriction.test-helpers";

test.after(async () => {
  await prisma.$disconnect();
});

test(
  "updateStatus('EXPIRED') bị từ chối 400 với cả PT, ADMIN và client trên ACTIVE (đã trả tiền) / COMPLETED / CANCELLED — 0 ghi DB, 0 gọi tiền",
  { skip },
  async () => {
    const pt = await makePt();
    const admin = randomUUID();
    const stranger = randomUUID();
    const contractIds: string[] = [];
    const st = stubs(undefined, { realNotifications: true });

    try {
      const activePaid = await makeContract(pt, { status: "ACTIVE" }, { eligibility: "none" });
      const completed = await makeContract(
        pt,
        { status: "COMPLETED", completedAt: new Date(Date.now() - DAY) },
        { eligibility: "none" },
      );
      const cancelled = await makeContract(
        pt,
        { status: "CANCELLED", paymentTransactionId: null, cancelledBy: pt, cancellationReason: "Huỷ thử" },
        { eligibility: "none" },
      );
      contractIds.push(activePaid.id, completed.id, cancelled.id);

      const snapshotBefore = async () =>
        prisma.contract.findMany({
          where: { id: { in: contractIds } },
          orderBy: { id: "asc" },
          select: { id: true, status: true, terminationReason: true, updatedAt: true },
        });
      const beforeContracts = await snapshotBefore();

      for (const c of [activePaid, completed, cancelled]) {
        for (const [actor, role] of [
          [pt, "PT"],
          [admin, "ADMIN"],
          [c.clientUserId, "CUSTOMER"],
        ] as const) {
          for (const requestedStatus of ["EXPIRED", "expired"]) {
            await assert.rejects(
              () => contractService.updateStatus(c.id, actor, requestedStatus, role),
              (e: any) =>
                e?.status === 400 &&
                typeof e?.message === "string" &&
                /hết hạn/.test(e.message) &&
                /tự xử lý/.test(e.message) &&
                /chấm dứt hợp đồng/.test(e.message),
              `Expected 400 refusing manual ${requestedStatus} by ${role} on ${c.status}`,
            );
          }
        }
        // Bên thứ ba vẫn bị từ chối 403 trước mọi kiểm tra trạng thái
        await assert.rejects(
          () => contractService.updateStatus(c.id, stranger, "EXPIRED", "CUSTOMER"),
          (e: any) => e?.status === 403,
        );
      }

      assert.deepEqual(await snapshotBefore(), beforeContracts, "không đổi bất kỳ trạng thái/cột nào trên contracts");
      assert.equal(
        await prisma.sessionSettlement.count({ where: { contractId: { in: contractIds } } }),
        0,
        "0 dòng settlement phát sinh",
      );
      assert.equal(
        await prisma.notification.count({ where: { entityId: { in: contractIds } } }),
        0,
        "0 notification phát sinh",
      );
      assert.equal(
        await prisma.auditLog.count({ where: { entityId: { in: contractIds } } }),
        0,
        "0 audit log phát sinh",
      );
      assert.equal(st.payments.length, 0, "0 lần gọi sang payment-service");
    } finally {
      st.restore();
      await cleanup([pt], contractIds);
    }
  },
);

test(
  "các nhánh updateStatus hợp lệ (ADMIN force PENDING_PAYMENT, CANCELLED pre-money) giữ nguyên và contract-expiry-sweep vẫn quyết toán EXPIRED tự động",
  { skip },
  async () => {
    const pt = await makePt();
    const admin = randomUUID();
    const contractIds: string[] = [];
    const st = stubs({ refund: "0.00" });

    try {
      await acceptCurrentPtTerms(pt);

      const pendingSig = await makeContract(
        pt,
        { status: "PENDING_SIGNATURE", paymentTransactionId: null, startDate: null, endDate: null },
        { eligibility: "none" },
      );
      const pendingReview = await makeContract(
        pt,
        { status: "PENDING_REVIEW", paymentTransactionId: null, startDate: null, endDate: null },
        { eligibility: "none" },
      );
      const overdueActive = await makeContract(
        pt,
        {
          status: "ACTIVE",
          startDate: new Date(Date.now() - 40 * DAY),
          endDate: new Date(Date.now() - DAY),
        },
        { eligibility: "none" },
      );
      contractIds.push(pendingSig.id, pendingReview.id, overdueActive.id);

      // 1. Admin force past broken e-sign still works -> PENDING_PAYMENT
      const forced = await contractService.updateStatus(pendingSig.id, admin, "ACTIVE", "ADMIN");
      assert.equal((forced as any).status, "PENDING_PAYMENT");

      // 2. Client pre-money cancel via updateStatus still works -> CANCELLED
      const cancelled = await contractService.updateStatus(
        pendingReview.id,
        pendingReview.clientUserId,
        "CANCELLED",
        "CUSTOMER",
      );
      assert.equal((cancelled as any).status, "CANCELLED");

      // 3. Automated sweep still discovers overdueActive via real findExpiredContracts query and settles as EXPIRED
      const dueList = await contractRepository.findExpiredContracts();
      assert.ok(
        dueList.some((c) => c.id === overdueActive.id),
        "findExpiredContracts phải tìm thấy hợp đồng ACTIVE quá endDate",
      );

      const restoreFindExpired = patch(contractRepository, "findExpiredContracts", async () => [overdueActive] as any);
      try {
        const sweepOut = await runContractExpirySweep();
        assert.equal(sweepOut.expired, 1);
      } finally {
        restoreFindExpired();
      }

      const afterOverdue = await prisma.contract.findUniqueOrThrow({ where: { id: overdueActive.id } });
      assert.equal(afterOverdue.status, "EXPIRED");
      assert.equal(afterOverdue.terminationReason, "EXPIRED");
      const termCall = st.payments.find(
        (p) => p.method === "terminate" && p.body?.transactionId === overdueActive.paymentTransactionId,
      );
      assert.ok(termCall, "job hết hạn tự động phải đi qua paymentClient.terminate");
      assert.equal(termCall.body.reason, "EXPIRED");
    } finally {
      st.restore();
      await cleanup([pt], contractIds);
    }
  },
);

