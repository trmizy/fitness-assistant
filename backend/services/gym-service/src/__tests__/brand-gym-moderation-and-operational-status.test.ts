import test from 'node:test';
import assert from 'node:assert/strict';
import { brandService } from '../services/brand.service';
import { brandRepository } from '../repositories/brand.repository';
import { gymService } from '../services/gym.service';
import { gymRepository } from '../repositories/gym.repository';
import { membershipRepository } from '../repositories/membership.repository';

/**
 * Vòng 4 / Phase C — C1 (brand name moderation), C2 (gym name/address moderation), C3 (gym
 * operational status, independent from moderation `status`), C4 (moving a gym between brands).
 *
 * Unit style throughout (patch the repository singletons, exercise the real service function)
 * — same convention as gym-status-guards.test.ts / activate-rechecks-gym-status.test.ts.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

// ── C1: brand rename moderation ─────────────────────────────────────────

test('C1 — createBrand đặt pendingName = tên gõ vào, approvedName vẫn chưa có (chưa duyệt)', async () => {
  let createdWith: any = null;
  const restore = patch(brandRepository, 'create', async (data: any) => {
    createdWith = data;
    return { id: 'brand-1', ...data };
  });
  try {
    await brandService.createBrand('owner-1', { name: '  Gym Chain X  ' });
  } finally {
    restore();
  }
  assert.equal(createdWith.name, 'Gym Chain X', 'createBrand already trimmed name before this phase — unchanged');
  assert.equal(createdWith.pendingName, 'Gym Chain X');
  assert.equal(createdWith.approvedName, undefined);
});

test('C1 — updateBrand (đổi tên) chỉ dời pendingName, approvedName giữ nguyên (chưa hiện công khai)', async () => {
  const brand = { id: 'brand-1', ownerId: 'owner-1', name: 'Old Name', approvedName: 'Old Name', pendingName: null };
  let updatedWith: any = null;
  const restores = [
    patch(brandRepository, 'findById', async () => ({ ...brand })),
    patch(brandRepository, 'update', async (_id: string, data: any) => {
      updatedWith = data;
      return { ...brand, ...data };
    }),
  ];
  try {
    await brandService.updateBrand('brand-1', 'owner-1', { name: 'New Name' });
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(updatedWith.name, 'New Name');
  assert.equal(updatedWith.pendingName, 'New Name');
  assert.equal(updatedWith.approvedName, undefined, 'approveRename never sets approvedName as part of a plain rename');
});

test('C1 — approveRename thăng pendingName lên approvedName và xoá pendingName', async () => {
  const brand = { id: 'brand-1', ownerId: 'owner-1', name: 'New Name', approvedName: 'Old Name', pendingName: 'New Name' };
  let updatedWith: any = null;
  const restores = [
    patch(brandRepository, 'findById', async () => ({ ...brand })),
    patch(brandRepository, 'update', async (_id: string, data: any) => {
      updatedWith = data;
      return { ...brand, ...data };
    }),
  ];
  try {
    await brandService.approveRename('brand-1', 'admin-1');
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(updatedWith.approvedName, 'New Name');
  assert.equal(updatedWith.pendingName, null);
});

test('C1 — approveRename khi không có gì đang chờ duyệt thì bị từ chối (409)', async () => {
  const brand = { id: 'brand-1', ownerId: 'owner-1', name: 'X', approvedName: 'X', pendingName: null };
  const restore = patch(brandRepository, 'findById', async () => ({ ...brand }));
  try {
    await assert.rejects(
      () => brandService.approveRename('brand-1', 'admin-1'),
      (e: any) => e.status === 409,
    );
  } finally {
    restore();
  }
});

// ── Gym's own first approval + brand's first-branch approval (gymService.setStatus) ─────

test('gymService.setStatus — lần đầu duyệt gym cũng thăng approvedName/approvedAddress của gym VÀ approvedName của brand (nếu đây là chi nhánh đầu tiên được duyệt)', async () => {
  const gym = {
    id: 'gym-1', ownerId: 'owner-1', brandId: 'brand-1',
    name: 'Gym A', pendingName: 'Gym A', approvedName: null,
    address: '123 St', pendingAddress: '123 St', approvedAddress: null,
  };
  const brand = { id: 'brand-1', ownerId: 'owner-1', name: 'Chain X', pendingName: 'Chain X', approvedName: null };
  const gymUpdates: any[] = [];
  const brandUpdates: any[] = [];
  const restores = [
    patch(gymRepository, 'findById', async () => ({ ...gym })),
    patch(gymRepository, 'update', async (_id: string, data: any) => {
      gymUpdates.push(data);
      return { ...gym, ...data };
    }),
    patch(gymRepository, 'updateStatus', async (_id: string, status: any) => ({ ...gym, status })),
    patch(brandRepository, 'findById', async () => ({ ...brand })),
    patch(brandRepository, 'update', async (_id: string, data: any) => {
      brandUpdates.push(data);
      return { ...brand, ...data };
    }),
  ];
  try {
    await gymService.setStatus('gym-1', 'APPROVED');
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(gymUpdates.length, 1, 'gym approvedName/approvedAddress promoted exactly once');
  assert.equal(gymUpdates[0].approvedName, 'Gym A');
  assert.equal(gymUpdates[0].approvedAddress, '123 St');
  assert.equal(gymUpdates[0].pendingName, null);
  assert.equal(brandUpdates.length, 1, "brand's first-branch approval fired");
  assert.equal(brandUpdates[0].approvedName, 'Chain X');
});

test('gymService.setStatus — duyệt lại lần hai (đã từng APPROVED trước đó) KHÔNG âm thầm thăng một pending rename mới', async () => {
  const gym = {
    id: 'gym-1', ownerId: 'owner-1', brandId: null,
    name: 'Renamed Without Approval', pendingName: 'Renamed Without Approval', approvedName: 'Original Approved Name',
    address: '123 St', pendingAddress: null, approvedAddress: '123 St',
  };
  const gymUpdates: any[] = [];
  const restores = [
    patch(gymRepository, 'findById', async () => ({ ...gym })),
    patch(gymRepository, 'update', async (_id: string, data: any) => {
      gymUpdates.push(data);
      return { ...gym, ...data };
    }),
    patch(gymRepository, 'updateStatus', async (_id: string, status: any) => ({ ...gym, status })),
  ];
  try {
    await gymService.setStatus('gym-1', 'APPROVED'); // e.g. re-approved after a SUSPENDED appeal
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(gymUpdates.length, 0, 'approvedName is already non-null — must not re-promote a pending rename outside approveRename');
});

// ── C2: gym rename/address moderation ───────────────────────────────────

test('C2 — updateOwnedGym đổi tên/địa chỉ sau khi đã duyệt chỉ dời pendingName/pendingAddress, approvedX giữ nguyên', async () => {
  const gym = {
    id: 'gym-1', ownerId: 'owner-1', brandId: null,
    name: 'Old Name', pendingName: null, approvedName: 'Old Name',
    address: 'Old Address', pendingAddress: null, approvedAddress: 'Old Address',
  };
  let updatedWith: any = null;
  const restores = [
    patch(gymRepository, 'findById', async () => ({ ...gym })),
    patch(gymRepository, 'update', async (_id: string, data: any) => {
      updatedWith = data;
      return { ...gym, ...data };
    }),
  ];
  try {
    await gymService.updateOwnedGym('gym-1', 'owner-1', { name: 'New Name', address: 'New Address' });
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(updatedWith.name, 'New Name');
  assert.equal(updatedWith.pendingName, 'New Name');
  assert.equal(updatedWith.address, 'New Address');
  assert.equal(updatedWith.pendingAddress, 'New Address');
  assert.equal(updatedWith.approvedName, undefined, 'public-facing name must not move until approveRename');
  assert.equal(updatedWith.approvedAddress, undefined);
});

test('C2 — updateOwnedGym: các trường khác (description/city/phone/email) vẫn tự do sửa, không qua duyệt', async () => {
  const gym = { id: 'gym-1', ownerId: 'owner-1', brandId: null, name: 'N', pendingName: null, approvedName: 'N', address: 'A', pendingAddress: null, approvedAddress: 'A' };
  let updatedWith: any = null;
  const restores = [
    patch(gymRepository, 'findById', async () => ({ ...gym })),
    patch(gymRepository, 'update', async (_id: string, data: any) => {
      updatedWith = data;
      return { ...gym, ...data };
    }),
  ];
  try {
    await gymService.updateOwnedGym('gym-1', 'owner-1', { description: 'New desc', phone: '0900000000' });
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(updatedWith.description, 'New desc');
  assert.equal(updatedWith.phone, '0900000000');
  assert.equal(updatedWith.pendingName, undefined, 'editing unrelated fields must not touch name moderation at all');
});

test('C2 — gymService.approveRename chỉ thăng đúng cái đang chờ (chỉ tên, địa chỉ giữ nguyên)', async () => {
  const gym = {
    id: 'gym-1', ownerId: 'owner-1',
    name: 'New Name', pendingName: 'New Name', approvedName: 'Old Name',
    address: 'Same Address', pendingAddress: null, approvedAddress: 'Same Address',
  };
  let updatedWith: any = null;
  const restores = [
    patch(gymRepository, 'findById', async () => ({ ...gym })),
    patch(gymRepository, 'update', async (_id: string, data: any) => {
      updatedWith = data;
      return { ...gym, ...data };
    }),
  ];
  try {
    await gymService.approveRename('gym-1');
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(updatedWith.approvedName, 'New Name');
  assert.equal(updatedWith.pendingName, null);
  assert.equal(updatedWith.approvedAddress, undefined, 'address had nothing pending — must stay untouched');
});

test('C2 — approveRename khi không có gì đang chờ (cả tên lẫn địa chỉ) thì bị từ chối', async () => {
  const gym = { id: 'gym-1', name: 'N', pendingName: null, approvedName: 'N', address: 'A', pendingAddress: null, approvedAddress: 'A' };
  const restore = patch(gymRepository, 'findById', async () => ({ ...gym }));
  try {
    await assert.rejects(() => gymService.approveRename('gym-1'), (e: any) => e.status === 409);
  } finally {
    restore();
  }
});

// ── C3: operational status state machine ────────────────────────────────

function baseGym(overrides: Record<string, any> = {}) {
  return { id: 'gym-1', ownerId: 'owner-1', operationalStatus: 'OPEN', closureReason: null, closedAt: null, reopenedAt: null, ...overrides };
}

test('C3 — đóng cửa tạm thời (TEMPORARILY_CLOSED) mà không có lý do thì bị từ chối (400)', async () => {
  const restore = patch(gymRepository, 'findById', async () => baseGym());
  try {
    await assert.rejects(
      () => gymService.setOperationalStatus('gym-1', 'owner-1', 'TEMPORARILY_CLOSED' as any, ''),
      (e: any) => e.status === 400,
    );
  } finally {
    restore();
  }
});

test('C3 — đóng cửa tạm thời có lý do: thành công, ghi closedAt + closureReason', async () => {
  let setWith: any = null;
  const restores = [
    patch(gymRepository, 'findById', async () => baseGym()),
    patch(gymRepository, 'setOperationalStatus', async (_id: string, status: any, extra: any) => {
      setWith = { status, ...extra };
      return { ...baseGym(), operationalStatus: status, ...extra };
    }),
  ];
  try {
    await gymService.setOperationalStatus('gym-1', 'owner-1', 'TEMPORARILY_CLOSED' as any, 'Sửa chữa hệ thống điện');
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(setWith.status, 'TEMPORARILY_CLOSED');
  assert.equal(setWith.closureReason, 'Sửa chữa hệ thống điện');
  assert.ok(setWith.closedAt instanceof Date);
});

test('C3 — mở lại (OPEN) từ TEMPORARILY_CLOSED: thành công, ghi reopenedAt, xoá closureReason', async () => {
  let setWith: any = null;
  const restores = [
    patch(gymRepository, 'findById', async () => baseGym({ operationalStatus: 'TEMPORARILY_CLOSED', closureReason: 'Sửa chữa' })),
    patch(gymRepository, 'setOperationalStatus', async (_id: string, status: any, extra: any) => {
      setWith = { status, ...extra };
      return { ...baseGym(), operationalStatus: status, ...extra };
    }),
  ];
  try {
    await gymService.setOperationalStatus('gym-1', 'owner-1', 'OPEN' as any);
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(setWith.status, 'OPEN');
  assert.equal(setWith.closureReason, null);
  assert.ok(setWith.reopenedAt instanceof Date);
});

test('C3 — không thể "mở lại" một gym đang OPEN sẵn (cùng trạng thái) — 409', async () => {
  const restore = patch(gymRepository, 'findById', async () => baseGym());
  try {
    await assert.rejects(
      () => gymService.setOperationalStatus('gym-1', 'owner-1', 'OPEN' as any),
      (e: any) => e.status === 409,
    );
  } finally {
    restore();
  }
});

test('C3 — PERMANENTLY_CLOSED là trạng thái cuối — không đổi được nữa dù đổi sang gì', async () => {
  const restore = patch(gymRepository, 'findById', async () => baseGym({ operationalStatus: 'PERMANENTLY_CLOSED' }));
  try {
    await assert.rejects(
      () => gymService.setOperationalStatus('gym-1', 'owner-1', 'OPEN' as any),
      (e: any) => e.status === 409,
    );
  } finally {
    restore();
  }
});

test('C3 — listPermanentlyClosedNeedingReview trả kèm số hội viên ACTIVE cần admin xử lý hoàn tiền', async () => {
  const restores = [
    patch(gymRepository, 'findPermanentlyClosed', async () => [baseGym({ operationalStatus: 'PERMANENTLY_CLOSED' }) as any]),
    patch(membershipRepository, 'findByGym', async () => [
      { id: 'm1', status: 'ACTIVE' },
      { id: 'm2', status: 'ACTIVE' },
      { id: 'm3', status: 'CANCELLED' },
    ] as any),
  ];
  let result: any;
  try {
    result = await gymService.listPermanentlyClosedNeedingReview();
  } finally {
    restores.forEach((r) => r());
  }
  assert.equal(result.length, 1);
  assert.equal(result[0].activeMembershipCount, 2, 'chỉ đếm ACTIVE, không đếm CANCELLED');
});

// ── C4: moving a gym between brands ──────────────────────────────────────

test('C4 — updateOwnedGym với brandId hợp lệ (thuộc sở hữu) thì gắn vào brand đó', async () => {
  const gym = { id: 'gym-1', ownerId: 'owner-1', brandId: null, name: 'N', address: 'A' };
  const brand = { id: 'brand-2', ownerId: 'owner-1' };
  let updatedWith: any = null;
  const restores = [
    patch(gymRepository, 'findById', async () => ({ ...gym })),
    patch(gymRepository, 'update', async (_id: string, data: any) => {
      updatedWith = data;
      return { ...gym, ...data };
    }),
    patch(brandRepository, 'findById', async () => ({ ...brand })),
  ];
  try {
    await gymService.updateOwnedGym('gym-1', 'owner-1', { brandId: 'brand-2' });
  } finally {
    restores.forEach((r) => r());
  }
  assert.deepEqual(updatedWith.brand, { connect: { id: 'brand-2' } });
});

test('C4 — updateOwnedGym với brandId: null thì tháo gym khỏi brand hiện tại', async () => {
  const gym = { id: 'gym-1', ownerId: 'owner-1', brandId: 'brand-1', name: 'N', address: 'A' };
  let updatedWith: any = null;
  const restores = [
    patch(gymRepository, 'findById', async () => ({ ...gym })),
    patch(gymRepository, 'update', async (_id: string, data: any) => {
      updatedWith = data;
      return { ...gym, ...data };
    }),
  ];
  try {
    await gymService.updateOwnedGym('gym-1', 'owner-1', { brandId: null });
  } finally {
    restores.forEach((r) => r());
  }
  assert.deepEqual(updatedWith.brand, { disconnect: true });
});

test('C4 — không thể gắn gym vào brand của người khác (403)', async () => {
  const gym = { id: 'gym-1', ownerId: 'owner-1', brandId: null, name: 'N', address: 'A' };
  const restores = [
    patch(gymRepository, 'findById', async () => ({ ...gym })),
    patch(brandRepository, 'findById', async () => ({ id: 'brand-99', ownerId: 'someone-else' })),
  ];
  try {
    await assert.rejects(
      () => gymService.updateOwnedGym('gym-1', 'owner-1', { brandId: 'brand-99' }),
      (e: any) => e.status === 403,
    );
  } finally {
    restores.forEach((r) => r());
  }
});
