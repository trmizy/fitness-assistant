/**
 * CODE/UNIT (no DB, no network) — item 6: bell notice to the owner + scoped managers when a front-desk check-in exception is requested.
 * The recipient lookup and the transport are injected; the notice must never throw and never reach the requester.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKIN_EXCEPTION_REQUESTED_EVENT, checkinExceptionNoticeText, exceptionApprovers, sendCheckinExceptionRequestedNotices, type ExceptionNoticeDeps,
} from '../services/gym-checkin-exception-notify';

const gym = { id: 'gym-1', ownerId: 'owner-1', brandId: 'brand-1', name: 'Gym Q1', approvedName: null as string | null };

function deps(recipients: string[], sent: any[], opts: { notifyThrows?: boolean; recipientsThrow?: boolean } = {}): ExceptionNoticeDeps {
  return {
    recipients: async () => {
      if (opts.recipientsThrow) throw new Error('db down');
      return recipients;
    },
    notify: async (p) => {
      if (opts.notifyThrows) throw new Error('user-service down');
      sent.push(p);
    },
  };
}

test('exceptionApprovers drops the requester (four-eyes) and keeps everyone else once', () => {
  assert.deepEqual(exceptionApprovers(['owner-1', 'mgr-1', 'mgr-2'], 'mgr-1'), ['owner-1', 'mgr-2']);
  assert.deepEqual(exceptionApprovers(['owner-1'], 'owner-1'), []);
});

test('one bell per owner/manager, entity GYM_BRANCH, link to the front desk of THAT branch, generic text', async () => {
  const sent: any[] = [];
  await sendCheckinExceptionRequestedNotices({ gym, requesterUserId: 'rcp-1' }, deps(['owner-1', 'mgr-1'], sent));
  assert.deepEqual(sent.map((n) => n.userId), ['owner-1', 'mgr-1']);
  for (const n of sent) {
    assert.equal(n.eventType, CHECKIN_EXCEPTION_REQUESTED_EVENT);
    assert.equal(n.entityType, 'GYM_BRANCH');
    assert.equal(n.entityId, 'gym-1');
    assert.equal(n.link, '/gym-owner/front-desk?gymId=gym-1');
    assert.equal(n.text, checkinExceptionNoticeText('Gym Q1'));
  }
});

test('the approved name is used when the branch has one', async () => {
  const sent: any[] = [];
  await sendCheckinExceptionRequestedNotices({ gym: { ...gym, approvedName: 'Gym Quận 1' }, requesterUserId: 'rcp-1' }, deps(['owner-1'], sent));
  assert.match(sent[0].text, /Gym Quận 1/);
});

test('the requester is never notified; nobody left -> nothing sent', async () => {
  const sent: any[] = [];
  await sendCheckinExceptionRequestedNotices({ gym, requesterUserId: 'mgr-1' }, deps(['owner-1', 'mgr-1'], sent));
  assert.deepEqual(sent.map((n) => n.userId), ['owner-1']);
  sent.length = 0;
  await sendCheckinExceptionRequestedNotices({ gym, requesterUserId: 'owner-1' }, deps(['owner-1'], sent));
  assert.equal(sent.length, 0);
});

test('best-effort: a failing transport or recipient lookup never throws to the caller', async () => {
  await assert.doesNotReject(sendCheckinExceptionRequestedNotices({ gym, requesterUserId: 'rcp-1' }, deps(['owner-1'], [], { notifyThrows: true })));
  await assert.doesNotReject(sendCheckinExceptionRequestedNotices({ gym, requesterUserId: 'rcp-1' }, deps(['owner-1'], [], { recipientsThrow: true })));
});

test('the text carries no member name / reason placeholder and fits a bell line', () => {
  const t = checkinExceptionNoticeText('Gym Q1');
  assert.ok(t.length < 200);
  assert.ok(!/lý do:/i.test(t));
});
