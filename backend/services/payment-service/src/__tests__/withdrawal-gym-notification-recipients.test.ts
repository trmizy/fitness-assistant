/**
 * Gym Owner handoff item 3 (22/11/2026): who is told in the bell about a GYM withdrawal decision, and what the text says.
 * evidence label: TEST FIXTURE (the gym-service lookup is a stub function; no database, no HTTP).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gymWithdrawalLink,
  mergeGymRecipients,
  resolveGymWithdrawalRecipients,
  withdrawalOwnerNoticeText,
} from '../services/withdrawal-notification.service';

test('mergeGymRecipients: owners + requester, once each, junk dropped', () => {
  assert.deepEqual(mergeGymRecipients(['o1', 'o2', 'o1', '', '  ', null, 7], 'r1').sort(), ['o1', 'o2', 'r1']);
  assert.deepEqual(mergeGymRecipients(['o1'], 'o1'), ['o1']);
  assert.deepEqual(mergeGymRecipients(['o1'], null), ['o1']);
  assert.deepEqual(mergeGymRecipients([], undefined), []);
});

test('resolveGymWithdrawalRecipients: owners from gym-service plus the requester', async () => {
  let asked = '';
  const out = await resolveGymWithdrawalRecipients(
    { id: 'w1', ownerId: 'gym-1', requestedByUserId: 'user-r' },
    async (gymId) => {
      asked = gymId;
      return { userIds: ['owner-a', 'owner-b'], gymName: 'Gym Quận 1' };
    },
  );
  assert.equal(asked, 'gym-1', 'the branch id (the wallet owner id) is what is looked up');
  assert.deepEqual(out.userIds.sort(), ['owner-a', 'owner-b', 'user-r']);
  assert.equal(out.gymName, 'Gym Quận 1');
});

test('resolveGymWithdrawalRecipients: gym-service down -> the requester alone is told, nothing throws', async () => {
  const out = await resolveGymWithdrawalRecipients({ id: 'w1', ownerId: 'gym-1', requestedByUserId: 'user-r' }, async () => {
    throw new Error('connect ECONNREFUSED');
  });
  assert.deepEqual(out.userIds, ['user-r']);
  assert.equal(out.gymName, null);
});

test('resolveGymWithdrawalRecipients: gym-service down and requester unknown (old row) -> nobody, nothing throws', async () => {
  const out = await resolveGymWithdrawalRecipients({ id: 'w1', ownerId: 'gym-1', requestedByUserId: null }, async () => {
    throw new Error('boom');
  });
  assert.deepEqual(out.userIds, []);
});

test('GYM notice text: rejection carries the reason, names the branch, and money stays in the branch wallet', () => {
  const text = withdrawalOwnerNoticeText('REJECTED', '1500000', { ownerType: 'GYM', gymName: 'Gym Quận 1', reason: 'Sai thông tin tài khoản' });
  assert.match(text, /của chi nhánh Gym Quận 1/);
  assert.match(text, /đã bị từ chối\. Lý do: Sai thông tin tài khoản\./);
  assert.match(text, /ví chi nhánh/);
  assert.doesNotMatch(text, /của bạn/);
});

test('GYM notice text: approved names the registered account, paid carries the bank reference', () => {
  assert.match(withdrawalOwnerNoticeText('APPROVED', '1500000', { ownerType: 'GYM', gymName: 'G' }), /tài khoản nhận đã đăng ký của đối tác/);
  assert.match(withdrawalOwnerNoticeText('PAID', '1500000', { ownerType: 'GYM', gymName: 'G', bankReference: 'VCB-123' }), /mã tham chiếu VCB-123/);
});

test('PT / CLIENT notice text is unchanged by the GYM wording', () => {
  assert.equal(
    withdrawalOwnerNoticeText('APPROVED', '500000'),
    withdrawalOwnerNoticeText('APPROVED', '500000', { ownerType: 'PT' }),
  );
  assert.match(withdrawalOwnerNoticeText('REJECTED', '500000', { reason: 'x' }), /Số tiền vẫn nằm trong ví của bạn\.$/);
  assert.match(withdrawalOwnerNoticeText('PAID', '500000'), /^Yêu cầu rút .* của bạn đã được chuyển khoản\.$/);
});

test('the GYM notice links to the branch page', () => {
  assert.equal(gymWithdrawalLink('gym-1'), '/gym-owner/gyms/gym-1');
});
