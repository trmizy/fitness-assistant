/** HISTORICAL pre-fix reproductions from 2026-10-23. Assertions expect the OLD bugs.
 * For current regression checks use scripts/testing/*session-races.test.ts and the
 * auth/payment concurrency integration tests listed in SYSTEM_FIXES_2026-10-24.md.
 * Read-only review fixtures: real source, in-memory dependencies; no database or HTTP. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { authService } from '../backend/services/auth-service/src/services/auth.service';
import { authRepository } from '../backend/services/auth-service/src/repositories/auth.repository';
import { withdrawalService } from '../backend/services/payment-service/src/services/withdrawal.service';
import { withdrawalRepository } from '../backend/services/payment-service/src/repositories/withdrawal.repository';
import { walletService } from '../backend/services/payment-service/src/services/wallet.service';
import { prisma } from '../backend/services/payment-service/src/repositories/prisma';
import { Prisma } from '../backend/services/payment-service/src/generated/prisma';

async function passwordResetRace() {
  const saved = { ...authRepository };
  let writes = 0;
  const row = { id: 'reset', userId: 'user', usedAt: null, expiresAt: new Date(Date.now() + 60000) };
  try {
    authRepository.findPasswordResetByHash = async () => ({ ...row }) as any;
    authRepository.updateUserPasswordById = async () => { writes++; return { id: 'user' } as any; };
    authRepository.markPasswordResetUsed = async () => ({}) as any;
    authRepository.deleteRefreshTokensByUserId = async () => ({ count: 0 });
    const results = await Promise.allSettled([
      authService.resetPasswordWithToken('same-token', 'password-one'),
      authService.resetPasswordWithToken('same-token', 'password-two'),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 2);
    assert.equal(writes, 2);
    console.log('REPRODUCED reset token: two concurrent uses both write a password');
  } finally { Object.assign(authRepository, saved); }
}

function loadClientFunctions(file: string, deps: Record<string, unknown>) {
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = ['refreshAccessToken', 'clearStoredSession'];
  const selected = ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.includes(s.name?.text ?? ''));
  assert.equal(selected.length, 2);
  const js = ts.transpileModule(selected.map(s => s.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ ...deps, exports: {}, RefreshUnavailableError: class extends Error {} });
  vm.runInContext(js, context, { filename: file });
  return context.exports as { refreshAccessToken(): Promise<string | null>; clearStoredSession(): Promise<void> };
}

async function clientRace(file: string) {
  const storage = new Map<string, string>([['accessToken', 'A-access'], ['refreshToken', 'A-refresh']]);
  let memoryToken: string | null = 'A-access';
  let resolveResponse!: (value: unknown) => void;
  let requestStarted!: () => void;
  const started = new Promise<void>(r => { requestStarted = r; });
  const response = new Promise(r => { resolveResponse = r; });
  const api = loadClientFunctions(file, {
    Preferences: { set: async ({ key, value }: any) => storage.set(key, value), remove: async ({ key }: any) => storage.delete(key) },
    tokenStore: { set: (value: string | null) => { memoryToken = value; } },
    readRefreshToken: async () => storage.get('refreshToken'),
    writeRefreshToken: async (value: string) => storage.set('refreshToken', value),
    clearRefreshToken: async () => storage.delete('refreshToken'),
    hasUsableToken: (v: unknown) => typeof v === 'string' && v.length > 0,
    refreshClient: { post: () => { requestStarted(); return response; } },
  });
  const pending = api.refreshAccessToken();
  await started;
  await api.clearStoredSession();
  storage.set('accessToken', 'B-access'); storage.set('refreshToken', 'B-refresh');
  memoryToken = 'B-access';
  resolveResponse({ data: { accessToken: 'A-new-access', refreshToken: 'A-new-refresh' } });
  await pending;
  assert.equal(memoryToken, 'A-new-access');
  assert.equal(storage.get('refreshToken'), 'A-new-refresh');
  console.log(`REPRODUCED stale refresh overwrites account B: ${file}`);
  const throttled = loadClientFunctions(file, {
    readRefreshToken: async () => 'valid-refresh', hasUsableToken: () => true,
    refreshClient: { post: async () => { throw { response: { status: 429 } }; } },
  });
  assert.equal(await throttled.refreshAccessToken(), null);
  console.log(`REPRODUCED HTTP 429 interpreted as revoked session: ${file}`);
}

async function withdrawalRace() {
  const originalFind = withdrawalRepository.findById;
  const originalUpdate = withdrawalRepository.updateStatus;
  const originalCreate = prisma.paymentTransaction.create;
  const originalWithWallets = walletService.withWallets;
  const row: any = { id: 'withdrawal', walletId: 'wallet', ownerId: 'owner', status: 'PENDING', amount: new Prisma.Decimal(100) };
  let runLocked!: () => void;
  let atLock!: () => void;
  const entered = new Promise<void>(r => { atLock = r; });
  const gate = new Promise<void>(r => { runLocked = r; });
  let available = 100, locked = 0;
  try {
    withdrawalRepository.findById = async () => ({ ...row });
    withdrawalRepository.updateStatus = async (_id, status, extra) => Object.assign(row, { status }, extra);
    prisma.paymentTransaction.create = (async () => ({ id: 'payout' })) as any;
    walletService.withWallets = (async (_ids: any, _txn: any, fn: any) => {
      atLock(); await gate;
      return fn({
        debit: async (_id: any, amount: any) => { available -= Number(amount); },
        credit: async (_id: any, amount: any) => { locked += Number(amount); },
        tx: {
          ledgerOperation: { findUnique: async () => null, create: async () => ({}) },
          withdrawalRequest: { update: async ({ data }: any) => Object.assign(row, data) },
        },
      });
    }) as any;
    const approval = withdrawalService.approve(row.id, 'admin-a');
    await entered;
    await withdrawalService.reject(row.id, 'admin-b', 'Reject while approval waits');
    assert.equal(row.status, 'REJECTED');
    runLocked(); await approval;
    assert.equal(row.status, 'APPROVED');
    assert.equal(available, 0); assert.equal(locked, 100);
    console.log('REPRODUCED withdrawal: stale approval overwrites REJECTED and locks funds');
  } finally {
    withdrawalRepository.findById = originalFind; withdrawalRepository.updateStatus = originalUpdate;
    prisma.paymentTransaction.create = originalCreate; walletService.withWallets = originalWithWallets;
  }
}

async function main() {
  await passwordResetRace();
  await clientRace('frontend/web/src/app/services/api.ts');
  await clientRace('frontend/mobile/src/services/api.ts');
  await withdrawalRace();
  console.log('6 reproductions observed; these assertions document defects, not fixes or E2E certification.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
