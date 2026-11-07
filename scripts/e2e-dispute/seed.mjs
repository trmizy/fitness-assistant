// Seeds the isolated Dispute E2E environment. Idempotent. Everything is labelled E2E_DISPUTE.
//  TEST FIXTURE : the 5 accounts (auth users table), user/PT profile + PT-terms confirmation, the PENDING_PAYMENT contract + 2 starting sessions (user-service
//                 Prisma, inside its container), the gym / partner / plan / membership / complaint rows (gym-service Prisma, inside its container).
//  REAL HTTP/API: login, the client PAYS the contract (POST /contracts/:id/pay -> payment-service checkout -> demo-checkout success -> ledger + activation),
//                 the client DISPUTES one session (POST /sessions/:id/dispute) and reports a PT no-show on the other (POST /sessions/:id/report-no-show).
//  No ledger / wallet / transaction row is written by hand. The D-NEW-12 policy review is NOT seeded: it is done through the four-eyes API (see smoke.mjs).
import { C, GATEWAY, PAYMENT, PASSWORD, USERS, docker, psql, http, login, must, data, sleep, saveState, loadState, HERE } from "./lib.mjs";
import { join } from "node:path";

const log = (...a) => console.log("[seed]", ...a);

async function ensureAccounts() {
  const hash = docker(["exec", C.auth, "node", "-e", `process.stdout.write(require('bcryptjs').hashSync(${JSON.stringify(PASSWORD)},10))`]).trim();
  const rows = Object.values(USERS)
    .map((u) => `('${u.id}','${u.email}','${hash.replace(/'/g, "''")}','${u.firstName}','${u.lastName}','${u.role}'::"Role",now(),now())`)
    .join(",\n");
  psql(
    "gymini_auth_e2e",
    `INSERT INTO users (id,email,password,"firstName","lastName",role,"createdAt","updatedAt") VALUES ${rows}
     ON CONFLICT (email) DO UPDATE SET password=EXCLUDED.password, role=EXCLUDED.role, "isActive"=true;`,
  );
  log("accounts ok:", Object.values(USERS).map((u) => u.email).join(", "));
}

function runFixture(container, service, file, env) {
  const dest = `/app/backend/services/${service}/e2e-seed-fixture.ts`;
  docker(["cp", join(HERE, "seed", file), `${container}:${dest}`]);
  const args = ["exec", "-w", `/app/backend/services/${service}`];
  for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  args.push(container, "node_modules/.bin/tsx", "e2e-seed-fixture.ts");
  const out = docker(args);
  const line = out.split("\n").find((l) => l.startsWith("FIXTURE_JSON "));
  if (!line) throw new Error(`${file}: no FIXTURE_JSON in output: ${out.slice(-400)}`);
  return JSON.parse(line.slice("FIXTURE_JSON ".length));
}

async function payContract(contractId, clientToken, status) {
  if (status === "ACTIVE") return log("contract already ACTIVE");
  const pay = must(await http("POST", `/contracts/${contractId}/pay`, clientToken, { provider: "VNPAY" }), 200, "pay contract");
  const txnId = pay?.payment?.transactionId;
  if (!txnId) throw new Error("pay: no transactionId in " + JSON.stringify(pay).slice(0, 300));
  // payment-service demo checkout (VNPAY_SIMULATE): the page links the signed success return; following it is what the browser does on "Thanh toan thanh cong".
  const page = await http("GET", `/payments/vnpay/sim?txnId=${txnId}`, null, undefined, { base: PAYMENT, raw: true });
  const m = /href="(\/payments\/vnpay\/return\?[^"]+)"[^>]*>\s*(?:&#10004;|✔)/.exec(page.text) || /class="btn pay" href="([^"]+)"/.exec(page.text);
  if (!m) throw new Error(`demo checkout page (HTTP ${page.status}) has no success link: ${page.text.slice(0, 200)}`);
  const ret = await http("GET", m[1].replace(/&amp;/g, "&"), null, undefined, { base: PAYMENT, raw: true });
  log("demo checkout return HTTP", ret.status);
  for (let i = 0; i < 20; i++) {
    const c = data(await http("GET", `/contracts/${contractId}`, clientToken));
    if ((c?.contract ?? c)?.status === "ACTIVE") return log("contract ACTIVE, txn", txnId);
    await sleep(1500);
  }
  throw new Error("contract did not become ACTIVE after the demo checkout");
}

async function extraDispute() {
  // `seed.sh --new-dispute`: one more DISPUTED session on the same paid contract (a case can be opened once per session; use it to re-run smoke.mjs).
  const token = await login(USERS.client);
  const uf = runFixture(C.user, "user-service", "user-fixture.ts", { E2E_CLIENT_ID: USERS.client.id, E2E_PT_ID: USERS.pt.id, E2E_NEW_DISPUTE: "1" });
  must(await http("POST", `/sessions/${uf.extraSession.id}/dispute`, token, { reason: "E2E_DISPUTE: buổi tập bổ sung không như PT đã báo" }), 200, "dispute extra session");
  const st = loadState();
  saveState({ ...st, spareDisputeSessionIds: [...(st.spareDisputeSessionIds ?? []), uf.extraSession.id] });
  console.log("[seed] new DISPUTED session:", uf.extraSession.id, "(run: SMOKE_SESSION_ID=" + uf.extraSession.id + " node scripts/e2e-dispute/smoke.mjs)");
}

async function main() {
  if (process.argv.includes("--new-dispute")) return extraDispute();
  await ensureAccounts();
  const tokens = {};
  for (const [k, u] of Object.entries(USERS)) tokens[k] = await login(u);
  log("logins ok (REAL HTTP via gateway)");

  const uf = runFixture(C.user, "user-service", "user-fixture.ts", { E2E_CLIENT_ID: USERS.client.id, E2E_PT_ID: USERS.pt.id });
  log("user fixture:", JSON.stringify(uf));
  await payContract(uf.contractId, tokens.client, uf.status);

  const sessionState = async (id) => {
    const r = await http("GET", `/sessions/${id}`, tokens.client);
    return data(r)?.status ?? data(r)?.session?.status ?? `HTTP ${r.status}`;
  };
  if ((await sessionState(uf.disputeSession.id)) !== "DISPUTED") {
    must(await http("POST", `/sessions/${uf.disputeSession.id}/dispute`, tokens.client, { reason: "E2E_DISPUTE: buổi tập không như PT đã báo" }), 200, "dispute session");
  }
  if ((await sessionState(uf.noShowSession.id)) !== "PT_NO_SHOW_REPORTED") {
    must(await http("POST", `/sessions/${uf.noShowSession.id}/report-no-show`, tokens.client, { reason: "E2E_DISPUTE: PT không đến buổi tập" }), 200, "report PT no-show");
  }
  log("session states:", await sessionState(uf.disputeSession.id), await sessionState(uf.noShowSession.id));

  const gf = runFixture(C.gym, "gym-service", "gym-fixture.ts", { E2E_CLIENT_ID: USERS.client.id, E2E_OWNER_ID: USERS.gymOwner.id });
  log("gym fixture:", JSON.stringify(gf));

  saveState({ seededAt: new Date().toISOString(), gateway: GATEWAY, contractId: uf.contractId, disputeSessionId: uf.disputeSession.id, noShowSessionId: uf.noShowSession.id, gymId: gf.gymId, membershipId: gf.membershipId, gymComplaintId: gf.complaintId, users: Object.fromEntries(Object.entries(USERS).map(([k, u]) => [k, u.id])) });
  log("DONE");
}
main().catch((e) => {
  console.error("[seed] FAILED:", e.message);
  process.exit(1);
});
