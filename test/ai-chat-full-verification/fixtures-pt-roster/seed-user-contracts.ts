// TEST FIXTURE: creates ACTIVE PT->client contracts in the ISOLATED user test DB (the real contract purchase/signing flow is not under test here).
// Usage (from backend/services/user-service): DATABASE_URL=...gymcoach_user_test node node_modules/tsx/dist/cli.mjs <this file> <ptUserId> <clientId>...
import { randomUUID } from "node:crypto";
import { prisma } from "C:/D_Backup/project_personal/fitness-assistant/backend/services/user-service/src/repositories/profile.repository";
if (!/localhost:55433\/[a-z_]*_test/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing: not the isolated test DB");
(async () => {
const [pt, ...clients] = process.argv.slice(2);
for (const c of clients) {
  await prisma.contract.create({ data: { id: randomUUID(), ptUserId: pt, clientUserId: c, packageName: "Roster probe", totalSessions: 12, status: "ACTIVE" } });
}
console.log(`contracts: ${clients.length}`);
await prisma.$disconnect();
})();
