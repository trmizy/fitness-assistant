import type { Prisma } from '../generated/prisma';

type Tx = Prisma.TransactionClient;

/**
 * Duyệt MỘT chi nhánh (→ APPROVED) bằng client của một transaction đang mở.
 *
 * ⚠️ Đây là bản THEO TRANSACTION của `gymService.setStatus(gymId, 'APPROVED')`, viết riêng vì
 * `setStatus` gọi ba lần ghi độc lập trên client toàn cục (cập nhật tên/địa chỉ duyệt lần đầu, tên
 * thương hiệu duyệt lần đầu, đổi status) — không nhét được vào một transaction của người khác. Duyệt
 * hồ sơ đối tác đòi partner + chi nhánh + audit cùng một commit, nên logic được nhân bản ở đây với
 * ĐÚNG các quy tắc của setStatus:
 *
 *   • Lần duyệt đầu (approvedName === null): approvedName/approvedAddress lấy từ pending* nếu có,
 *     không thì từ name/address; xoá pending* và mọi ghi chú "Request Changes" đang treo.
 *   • Nếu chi nhánh thuộc một thương hiệu chưa từng có chi nhánh nào được duyệt: duyệt tên thương
 *     hiệu luôn (approvedName ← pendingName ?? name).
 *   • Cuối cùng đặt status = APPROVED.
 *
 * Test tích hợp `partner-application.integration.test.ts` chạy cả hai đường trên cùng một dữ liệu và
 * khẳng định kết quả giống hệt, để hai bản không lệch nhau âm thầm.
 */
export async function applyGymApprovalTx(tx: Tx, gymId: string) {
  const gym = await tx.gym.findUnique({ where: { id: gymId } });
  if (!gym) throw Object.assign(new Error('Gym not found'), { status: 404 });

  if (gym.approvedName === null) {
    await tx.gym.update({
      where: { id: gymId },
      data: {
        approvedName: gym.pendingName ?? gym.name,
        approvedAddress: gym.pendingAddress ?? gym.address,
        pendingName: null,
        pendingAddress: null,
        pendingNameNote: null,
        pendingAddressNote: null,
        changesRequestedAt: null,
        changesRequestedBy: null,
      },
    });

    if (gym.brandId) {
      const brand = await tx.gymBrand.findUnique({ where: { id: gym.brandId } });
      if (brand && brand.approvedName === null) {
        await tx.gymBrand.update({
          where: { id: gym.brandId },
          data: { approvedName: brand.pendingName ?? brand.name, pendingName: null },
        });
      }
    }
  }

  return tx.gym.update({ where: { id: gymId }, data: { status: 'APPROVED' } });
}
