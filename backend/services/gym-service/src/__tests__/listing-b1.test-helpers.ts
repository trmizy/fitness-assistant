/**
 * Shared fixtures for the Listing Management B1 integration tests. Not a test file (no `.test.ts` suffix).
 *
 * Every fixture write runs inside a transaction that declares `gymini.compat_writer = 'seed'`, so building a fixture
 * leaves NON_CLIENT events (never WRITER_ABSENT) and a later "no WRITER_ABSENT for these ids" assertion is meaningful.
 * Fixtures keep `gyms.facilities` consistent with `gym_amenities` (the mirror invariant) because other test files
 * re-run the migration's verification block against the whole test database.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { syncFacilitiesMirrorTx } from '../services/gym-amenity.service';

export type Tx = Prisma.TransactionClient;

export const PHOTO_DIR = path.resolve(process.cwd(), 'uploads/gym-photos');

export async function seed<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL gymini.compat_writer = 'seed'`);
    return fn(tx);
  });
}

export interface Registry {
  gyms: string[];
  brands: string[];
  partners: string[];
  files: string[];
  amenities: string[];
}

export function newRegistry(): Registry {
  return { gyms: [], brands: [], partners: [], files: [], amenities: [] };
}

export async function cleanupRegistry(reg: Registry): Promise<void> {
  for (const f of reg.files) fs.rmSync(f, { force: true });
  if (reg.gyms.length) {
    // B2: an admin edit / approval in a test leaves CLOSED revisions, which the immutability trigger refuses to delete
    // (also through the gym's ON DELETE CASCADE). session_replication_role = replica switches triggers off for THIS
    // transaction only, so no other test (or session) loses the protection.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(`DELETE FROM gym_listing_revisions WHERE gym_id = ANY($1::text[])`, reg.gyms);
    });
    await prisma.legacyCompatEvent.deleteMany({ where: { entityId: { in: reg.gyms } } });
    await prisma.amenityProposal.deleteMany({ where: { gymId: { in: reg.gyms } } });
    await prisma.gymTrainerAffiliation.deleteMany({ where: { gymId: { in: reg.gyms } } });
    await prisma.gymReview.deleteMany({ where: { gymId: { in: reg.gyms } } });
    await prisma.gymPtCollaboration.deleteMany({ where: { gymId: { in: reg.gyms } } });
  }
  if (reg.brands.length) await prisma.gymMembershipPlan.deleteMany({ where: { brandId: { in: reg.brands } } });
  if (reg.gyms.length) await prisma.gym.deleteMany({ where: { id: { in: reg.gyms } } });
  if (reg.partners.length) {
    await prisma.legacyCompatEvent.deleteMany({ where: { entityId: { in: reg.partners } } });
    await prisma.gymPartner.deleteMany({ where: { id: { in: reg.partners } } });
  }
  if (reg.brands.length) await prisma.gymBrand.deleteMany({ where: { id: { in: reg.brands } } });
  if (reg.amenities.length) await prisma.amenity.deleteMany({ where: { id: { in: reg.amenities } } });
}

/** A partner that passes the operational gate (ACTIVE + VERIFIED, OWNER account ACTIVE, onboarding done) and owns a brand. */
export async function makeOwner(
  reg: Registry,
  opts: { partnerStatus?: 'ACTIVE' | 'SUSPENDED' | 'TERMINATED'; brandDescription?: string } = {},
) {
  const ownerId = randomUUID();
  return seed(async (tx) => {
    const partner = await tx.gymPartner.create({
      data: {
        legalName: `B1 Partner ${randomUUID().slice(0, 8)}`,
        status: opts.partnerStatus ?? 'ACTIVE',
        verificationStatus: 'VERIFIED',
      },
    });
    reg.partners.push(partner.id);
    await tx.gymPartnerAccount.create({
      data: { partnerId: partner.id, userId: ownerId, role: 'OWNER', scopedGymIds: [], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
    });
    const brand = await tx.gymBrand.create({
      data: {
        ownerId,
        name: 'B1 Brand',
        approvedName: 'B1 Brand',
        pendingName: 'Pending Brand Rename',
        description: opts.brandDescription ?? 'Brand about',
        facebookUrl: 'https://facebook.com/b1',
        logoKey: null,
      },
    });
    reg.brands.push(brand.id);
    await tx.gymPartner.update({ where: { id: partner.id }, data: { brandId: brand.id } });
    return { ownerId, partnerId: partner.id, brandId: brand.id };
  });
}

export interface GymSeed {
  ownerId: string;
  brandId: string;
  status?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  operationalStatus?: 'OPEN' | 'TEMPORARILY_CLOSED' | 'PERMANENTLY_CLOSED';
  name?: string;
  description?: string | null;
  /** SYSTEM amenity slugs to attach; `facilities` (the mirror) is synced from them. */
  amenities?: string[];
  withPendingOverlay?: boolean;
}

export async function makeGym(reg: Registry, g: GymSeed) {
  const id = randomUUID();
  const status = g.status ?? 'APPROVED';
  await seed(async (tx) => {
    await tx.gym.create({
      data: {
        id,
        ownerId: g.ownerId,
        brandId: g.brandId,
        name: g.name ?? `Gym ${id.slice(0, 6)}`,
        approvedName: status === 'APPROVED' || status === 'SUSPENDED' ? g.name ?? `Gym ${id.slice(0, 6)}` : null,
        address: 'Addr 1',
        approvedAddress: status === 'APPROVED' || status === 'SUSPENDED' ? 'Addr 1' : null,
        description: g.description === undefined ? 'About this gym' : g.description,
        status,
        operationalStatus: g.operationalStatus ?? 'OPEN',
        listingVersion: status === 'APPROVED' || status === 'SUSPENDED' ? 1 : 0,
        ...(g.withPendingOverlay
          ? {
              pendingName: 'SECRET pending name',
              pendingAddress: 'SECRET pending address',
              pendingNameNote: 'SECRET name note',
              pendingAddressNote: 'SECRET address note',
              changesRequestedAt: new Date(),
              changesRequestedBy: 'admin-secret',
            }
          : {}),
      },
    });
    reg.gyms.push(id);
    if (g.amenities?.length) {
      const rows = await tx.amenity.findMany({ where: { slug: { in: g.amenities } } });
      await tx.gymAmenity.createMany({ data: rows.map((a) => ({ gymId: id, amenityId: a.id })) });
      await syncFacilitiesMirrorTx(tx, id);
    }
  });
  return id;
}

export interface PhotoSeed {
  gymId: string;
  status?: 'STAGED' | 'PUBLISHED' | 'RETIRED' | 'DISCARDED';
  isCover?: boolean;
  sortOrder?: number;
  /** 's3' -> an s3Key; 'disk' (default) -> a real file under uploads/gym-photos. */
  storage?: 's3' | 'disk';
  bytes?: Buffer;
  createdAt?: Date;
}

export async function makePhoto(reg: Registry, p: PhotoSeed) {
  const id = randomUUID();
  const storage = p.storage ?? 'disk';
  const fileName = `b1-${id}.jpg`;
  const bytes = p.bytes ?? Buffer.from(`fake-jpeg-${id}`);
  if (storage === 'disk') {
    fs.mkdirSync(PHOTO_DIR, { recursive: true });
    const abs = path.join(PHOTO_DIR, fileName);
    fs.writeFileSync(abs, bytes);
    reg.files.push(abs);
  }
  await seed((tx) =>
    tx.gymPhoto.create({
      data: {
        id,
        gymId: p.gymId,
        fileName,
        s3Key: storage === 's3' ? `listing-photos/${id}.webp` : null,
        status: p.status ?? 'PUBLISHED',
        isCover: p.isCover ?? false,
        sortOrder: p.sortOrder ?? 0,
        visibility: 'PRIVATE',
        ...(p.createdAt ? { createdAt: p.createdAt } : {}),
      },
    }),
  );
  return { id, fileName, bytes };
}

/** Everything a public sub-route has to show for a gym: an ACTIVE plan for its brand, a public trainer, a review. */
export async function makePublicContent(_reg: Registry, gymId: string, brandId: string) {
  await seed(async (tx) => {
    await tx.gymMembershipPlan.create({ data: { brandId, name: 'B1 plan', price: 100000, durationDays: 30, status: 'ACTIVE' } });
    await tx.gymTrainerAffiliation.create({ data: { gymId, ptId: `pt-${gymId}`, status: 'ACTIVE', visibility: 'PUBLIC' } });
    await tx.gymReview.create({ data: { gymId, clientId: `client-${gymId}`, rating: 5, comment: 'good' } });
  });
}

export async function makeAcceptedCollaboration(gymId: string, ptUserId: string) {
  await seed((tx) =>
    tx.gymPtCollaboration.create({
      data: {
        gymId,
        ptUserId,
        proposedPtRate: '0.6000',
        proposedGymRate: '0.3000',
        platformRate: '0.1000',
        status: 'ACCEPTED',
        proposedBy: 'PT',
        expiresAt: new Date(Date.now() + 7 * 86400_000),
        acceptedAt: new Date(),
      },
    }),
  );
}

/** Every key at every depth of a JSON value. */
export function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, into));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}
