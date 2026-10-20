/** Listing Management B3 - the pure rules (no database): approve blockers and the AMENITIES missing section. Evidence label: CODE AUDIT / unit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeApproveBlockers, computeMissing, type ApproveInput, type CompletenessInput } from '../services/partner-application.state';
import { amenitiesRequired, isLegacyCompatEnabled, listingCompatOf } from '../services/legacy-compat.service';

const ready: ApproveInput = {
  partnerStatus: 'PROSPECT',
  verificationStatus: 'IN_REVIEW',
  unresolvedIssueCount: 0,
  docStatuses: {
    BUSINESS_LICENSE: { status: 'VERIFIED', hasFile: true },
    REPRESENTATIVE_ID: { status: 'VERIFIED', hasFile: true },
    PREMISES_PROOF: { status: 'VERIFIED', hasFile: true },
  },
  draftBranchCount: 1,
  nonDraftBranchCount: 0,
};
const codes = (i: Partial<ApproveInput>) => computeApproveBlockers({ ...ready, ...i }).map((b) => b.code);

test('approve blockers: AMENITIES_REQUIRED only for flow 2 with 0 amenities; CUSTOM_AMENITY_PENDING while any proposal is PENDING; an old-client application (flow not 2) is approvable with none', () => {
  assert.deepEqual(codes({}), [], 'inputs without the new fields behave as before');
  assert.deepEqual(codes({ applicationFlowVersion: 2, amenityCount: 0 }), ['AMENITIES_REQUIRED']);
  assert.deepEqual(codes({ applicationFlowVersion: 2, amenityCount: 1 }), []);
  assert.deepEqual(codes({ applicationFlowVersion: 3, amenityCount: 0 }), ['AMENITIES_REQUIRED'], 'flow 3 is flow 2 or later');
  assert.deepEqual(codes({ applicationFlowVersion: null, amenityCount: 0 }), []);
  assert.deepEqual(codes({ applicationFlowVersion: 2, amenityCount: 2, pendingAmenityProposalCount: 1 }), ['CUSTOM_AMENITY_PENDING']);
  assert.deepEqual(codes({ applicationFlowVersion: 2, amenityCount: 0, pendingAmenityProposalCount: 2 }).sort(), ['AMENITIES_REQUIRED', 'CUSTOM_AMENITY_PENDING']);
  assert.deepEqual(codes({ applicationFlowVersion: null, amenityCount: 0, pendingAmenityProposalCount: 1 }), ['CUSTOM_AMENITY_PENDING'], 'a pending proposal blocks every application');
});

test('missing: the section key AMENITIES appears only when amenities are required of the caller and the branch has none, between LOCATION and PHOTOS', () => {
  const full: CompletenessInput = {
    representative: { name: 'A', phone: '1', role: 'OWNER' },
    brandName: 'B',
    businessScale: 'ONE_BRANCH',
    branch: { name: 'N', phone: '1', address: 'a', provinceCode: 1, wardCode: 1, latitude: 1, longitude: 1 },
    photoCount: 0,
    legalName: 'L',
    docStatuses: { BUSINESS_LICENSE: 'RECEIVED', REPRESENTATIVE_ID: 'RECEIVED', PREMISES_PROOF: 'RECEIVED' },
    termsAcceptedAt: new Date(),
  };
  const s = (over: Partial<CompletenessInput>) => computeMissing({ ...full, ...over }).map((m) => m.section);
  assert.deepEqual(s({}), ['PHOTOS'], 'default: not required');
  assert.deepEqual(s({ requireAmenities: true, amenityCount: 0 }), ['AMENITIES', 'PHOTOS']);
  assert.deepEqual(s({ requireAmenities: true, amenityCount: 1 }), ['PHOTOS']);
  assert.deepEqual(s({ requireAmenities: true, amenityCount: 0, branch: null }).includes('AMENITIES'), false, 'no branch yet: BRANCH is the thing to fix');
});

test('client recognition: an integer >= 2 is a new client (its number is the flow version); missing, "1" and non-integers are old; the flag defaults to ON and only "false" / "0" turn it off', () => {
  assert.equal(listingCompatOf({ headers: { 'x-gymini-listing-flow': '2' } } as any).newClient, true);
  for (const [v, n] of [['2', 2], ['3', 3], ['10', 10], [' 3 ', 3]] as const) {
    const c = listingCompatOf({ headers: { 'x-gymini-listing-flow': v } } as any);
    assert.deepEqual([c.newClient, c.flowVersion], [true, n], v);
  }
  assert.equal(listingCompatOf({ headers: { 'x-gymini-listing-flow': '3' } } as any).flowHeader, '3', 'raw value kept');
  for (const v of [undefined, '', '1', '0', 'abc', '2.5', '-3', '2x', '99999', 'true', ' ']) {
    const c = listingCompatOf({ headers: v === undefined ? {} : { 'x-gymini-listing-flow': v } } as any);
    assert.equal(c.newClient, false, String(v));
  }
  assert.equal(listingCompatOf({ headers: { 'x-gymini-client': ' web/abc ' } } as any).clientHeader, 'web/abc');
  const saved = process.env.LISTING_LEGACY_CLIENT_COMPAT;
  try {
    delete process.env.LISTING_LEGACY_CLIENT_COMPAT;
    assert.equal(isLegacyCompatEnabled(), true);
    for (const v of ['true', '1', 'yes', '']) { process.env.LISTING_LEGACY_CLIENT_COMPAT = v; assert.equal(isLegacyCompatEnabled(), true, v); }
    for (const v of ['false', 'FALSE', '0']) { process.env.LISTING_LEGACY_CLIENT_COMPAT = v; assert.equal(isLegacyCompatEnabled(), false, v); }
    delete process.env.LISTING_LEGACY_CLIENT_COMPAT;
    const old = listingCompatOf({ headers: {} } as any);
    assert.equal(amenitiesRequired(old, null), false);
    assert.equal(amenitiesRequired(old, 2), true);
    assert.equal(amenitiesRequired(listingCompatOf({ headers: { 'x-gymini-listing-flow': '2' } } as any), null), true);
    process.env.LISTING_LEGACY_CLIENT_COMPAT = 'false';
    assert.equal(amenitiesRequired(old, null), true);
  } finally {
    if (saved === undefined) delete process.env.LISTING_LEGACY_CLIENT_COMPAT;
    else process.env.LISTING_LEGACY_CLIENT_COMPAT = saved;
  }
});
