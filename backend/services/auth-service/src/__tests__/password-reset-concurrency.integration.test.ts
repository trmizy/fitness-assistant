import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { authRepository, prisma } from '../repositories/auth.repository';
import { authService } from '../services/auth.service';

const safe = (() => { try { return /_test$/.test(new URL(process.env.DATABASE_URL ?? '').pathname); } catch { return false; } })();
const options = { skip: safe ? false : 'Requires an isolated *_test database' };
test.after(async () => { await prisma.$disconnect(); });

async function fixture() {
  const raw = randomUUID();
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@reset.test`, password: 'old-password-hash', role: 'CUSTOMER', mustChangePassword: true } });
  const token = await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 60000) } });
  await prisma.refreshToken.create({ data: { userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
  return { raw, user, token };
}

test('concurrent reset requests: exactly one password wins and refresh tokens are revoked', options, async () => {
  const f = await fixture();
  const original = authRepository.findPasswordResetByHash;
  let reads = 0;
  let release!: () => void;
  const barrier = new Promise<void>(r => { release = r; });
  authRepository.findPasswordResetByHash = (async (hash: string) => {
    const result = await original(hash);
    if (++reads === 2) release();
    await barrier;
    return result;
  }) as typeof original;
  try {
    const passwords = ['new-password-one', 'new-password-two'];
    const results = await Promise.allSettled(passwords.map(p => authService.resetPasswordWithToken(f.raw, p)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const loser = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.equal(loser.reason.status, 409);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
    assert.equal(await bcrypt.compare(passwords[results.findIndex(r => r.status === 'fulfilled')], stored.password), true);
    assert.equal(stored.mustChangePassword, false);
    assert.equal(await prisma.refreshToken.count({ where: { userId: f.user.id } }), 0);
    assert.ok((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: f.token.id } })).usedAt);
  } finally {
    authRepository.findPasswordResetByHash = original;
    await prisma.user.delete({ where: { id: f.user.id } });
  }
});

test('password write failure rolls back the token claim and preserves existing sessions', options, async () => {
  const f = await fixture();
  try {
    await assert.rejects(authRepository.consumePasswordReset(f.token.id, f.user.id, null as any));
    assert.equal((await prisma.passwordResetToken.findUniqueOrThrow({ where: { id: f.token.id } })).usedAt, null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).password, f.user.password);
    assert.equal(await prisma.refreshToken.count({ where: { userId: f.user.id } }), 1);
    assert.ok(await authRepository.consumePasswordReset(f.token.id, f.user.id, 'valid-hash'));
  } finally { await prisma.user.delete({ where: { id: f.user.id } }); }
});

test('expired token cannot be claimed even if a preflight read previously accepted it', options, async () => {
  const f = await fixture();
  try {
    await prisma.passwordResetToken.update({ where: { id: f.token.id }, data: { expiresAt: new Date(0) } });
    assert.equal(await authRepository.consumePasswordReset(f.token.id, f.user.id, 'new-hash'), null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } })).password, f.user.password);
    assert.equal(await prisma.refreshToken.count({ where: { userId: f.user.id } }), 1);
  } finally { await prisma.user.delete({ where: { id: f.user.id } }); }
});
