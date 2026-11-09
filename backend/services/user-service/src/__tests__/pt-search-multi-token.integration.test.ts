/**
 * PT discovery search - multi-word `q` (full name across firstName + lastName).
 *
 * Evidence label: BACKEND INTEGRATION. Real user-service Express app on a random port against an isolated `*_test`
 * database; auth-service not running (token -> identity = TEST FIXTURE).
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_lm_test?schema=public" \
 *     npx tsx --test src/__tests__/pt-search-multi-token.integration.test.ts
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { prisma } from "../repositories/profile.repository";
import { startApp, tokenFor, type App } from "./pt-contract-scope.test-helpers";
import { cleanupListingPts, makePublicPt } from "./pt-listing.test-helpers";

let app: App;
const created: string[] = [];
const contracts: string[] = [];
const others: string[] = [];
const tag = randomUUID().slice(0, 6);
// Vietnamese order: lastName "Lý", firstName "Thành Đạt" (+ a unique tag so the test DB's other rows never match).
const ids: Record<string, string> = {};

test.before(async () => {
  app = await startApp();
  const mk = async (key: string, firstName: string, lastName: string, extra: string) => {
    const pt = await makePublicPt({ marker: `${extra}${tag}` });
    created.push(pt.userId);
    await prisma.userProfile.update({
      where: { userId: pt.userId },
      data: {
        firstName: `${firstName}`,
        lastName,
        firstNameNormalized: firstName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase(),
        lastNameNormalized: lastName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase(),
      },
    });
    ids[key] = pt.userId;
  };
  await mk("dat", `Thành Đạt ${tag}`, "Lý", "A");
  await mk("huy", `Gia Huy ${tag}`, "Phạm", "B");
  await mk("other", `Thành Công ${tag}`, "Nguyễn", "C"); // shares "Thành" with dat only
  await mk("ly", `Hoài ${tag}`, "Ly", "D"); // unaccented "Ly" - must not match "Lý" typed with the accent
});

test.after(async () => {
  await app.close();
  await cleanupListingPts(created, contracts, others);
  await prisma.userProfile.deleteMany({ where: { userId: { in: others } } }).catch(() => {});
});

const search = async (q: string): Promise<string[]> => {
  const viewer = randomUUID();
  others.push(viewer);
  const r = await app.call("GET", `/profile/pts?q=${encodeURIComponent(q)}&limit=100`, tokenFor(viewer, "CUSTOMER"));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body.pts as any[]).map((p) => p.userId).filter((id) => Object.values(ids).includes(id));
};

test("full name in display order (last + first) matches", async () => {
  assert.deepEqual(await search(`Lý Thành Đạt ${tag}`), [ids.dat]);
  assert.deepEqual(await search(`Phạm Gia Huy ${tag}`), [ids.huy]);
});

test("full name, case- and accent-insensitive", async () => {
  assert.deepEqual(await search(`ly thanh dat ${tag.toUpperCase()}`), [ids.dat]);
});

test("reversed token order still matches", async () => {
  assert.deepEqual(await search(`${tag} Đạt Lý Thành`), [ids.dat]);
});

test("partial: a subset of tokens narrows, every token must match", async () => {
  assert.deepEqual((await search(`Thành ${tag}`)).sort(), [ids.dat, ids.other].sort());
  assert.deepEqual(await search(`Thành Đạt ${tag}`), [ids.dat]);
  assert.deepEqual(await search(`Thành Huy ${tag}`), [], "tokens from two different people never combine");
});

test("accent-sensitive like before: Lý does not match Ly; tokens never match gym name/address", async () => {
  const r = await search(`Lý ${tag}`);
  assert.ok(r.includes(ids.dat) && !r.includes(ids.ly), "Lý finds Lý only");
  assert.deepEqual(await search(`Gia Huy ${tag}`), [ids.huy]);
});

test("single token and extra whitespace behave as before", async () => {
  assert.deepEqual(await search(`Lý`).then((r) => r.includes(ids.dat)), true);
  assert.deepEqual(await search(`  Gia   Huy   ${tag} `), [ids.huy]);
});

test("no match returns nothing", async () => {
  assert.deepEqual(await search(`Lý Thành Đạt ${tag} Zzzz`), []);
  assert.deepEqual(await search(`Zzzz${tag}`), []);
});
