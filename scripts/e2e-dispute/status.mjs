// Read-only: logs in as admin1 through the gateway and prints the flags/runtime the user-service REALLY evaluates (REAL HTTP/API).
import { USERS, http, login, data } from "./lib.mjs";
try {
  const t = await login(USERS.admin1);
  const cap = data(await http("GET", "/admin/dispute-cases/capabilities", t));
  console.log("dispute capabilities (user-service):", JSON.stringify({ execution: cap.execution, evidenceStorage: cap.evidenceStorage, d65bResolution: cap.d65bResolution, t0: cap.t0, lateOpenReconciliation: cap.lateOpenReconciliation, runtime: cap.runtime }));
  console.log("details:", JSON.stringify(cap.details));
} catch (e) {
  console.log("status: not seeded yet or gateway down:", e.message);
}
