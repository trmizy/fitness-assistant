// Runs the UNMODIFIED fitness-service Lambda artifact (the same zip the
// Lambda function executes) as a long-lived HTTP server, so the container
// and serverless arms share identical code, dependencies and Prisma engine.
// Only the deployment model differs.
//
// Mirrors src/lambda.ts: resolve DATABASE_URL from DATABASE_SECRET_ID,
// validate runtime config, then load dist/app.js — but call app.listen()
// instead of wrapping it with serverless-http. Background jobs started by
// src/server.ts are deliberately NOT started (the Lambda arm has none).
"use strict";

function pick(mod, name) {
  if (mod && typeof mod[name] === "function") return mod[name];
  if (mod && mod.default && typeof mod.default[name] === "function") return mod.default[name];
  throw new Error(`export ${name} not found`);
}

(async () => {
  const runtime = await import("./dist/config/lambda-runtime.js");
  await pick(runtime, "ensureDatabaseUrlConfigured")();
  pick(runtime, "validateRequiredRuntimeConfig")();

  const appMod = await import("./dist/app.js");
  const app = (appMod.default && appMod.default.default) || appMod.default || appMod;
  const port = Number(process.env.PORT || 3002);
  const server = app.listen(port, () => {
    console.log(JSON.stringify({ msg: "fitness container ready", port, t: Date.now() }));
  });
  // Keep-alive must outlive the ALB idle timeout (60 s) to avoid 502s.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
