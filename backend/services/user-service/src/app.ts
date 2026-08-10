import express from "express";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { logger, register, metricsMiddleware } from "@gym-coach/shared";
import profileRoutes from "./routes/profile.routes";
import inbodyRoutes from "./routes/inbody.routes";
import ptApplicationRoutes from "./routes/pt_application.routes";
import contractRoutes from "./routes/contract.routes";
import notificationRoutes from "./routes/notification.routes";
import sessionRoutes from "./routes/session.routes";
import availabilityRoutes from "./routes/availability.routes";
import dropboxSignWebhookRouter from "./routes/dropboxSignWebhook.routes";
import internalRoutes from "./routes/internal.routes";
import locationRoutes from "./routes/location.routes";
import trainingLocationRoutes from "./routes/training_location.routes";
import adminRoutes from "./routes/admin.routes";

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);
// No CORS middleware here on purpose — see the matching note in
// auth-service/src/app.ts: this service is only ever reached via the
// gateway's proxy, and a no-args cors() was overriding the gateway's own
// origin-scoped CORS header with an invalid wildcard-plus-credentials
// combination once http-proxy-middleware forwarded it through.
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use(metricsMiddleware());

// Ensure upload directories exist
for (const dir of [
  "uploads/pt-applications",
  "uploads/profile-photos",
  "uploads/contracts",
]) {
  const p = path.join(process.cwd(), dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// Only profile-photos (public avatars, same exposure level as any social-app
// avatar URL) are served statically/unauthenticated. `pt-applications`
// (national ID, portrait, certificates) and `contracts` are identity/legal
// documents and must NEVER be reachable without an ownership/role check —
// they are served through the authenticated /pt-applications/documents/:filename
// endpoint instead (see pt_application.routes.ts). Do not add a blanket
// `/uploads` static mount back — that previously served every file in
// `uploads/pt-applications` to anyone on the internet with no auth at all.
app.use(
  "/uploads/profile-photos",
  express.static(path.join(process.cwd(), "uploads/profile-photos")),
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "user-service" });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

// Webhook: no auth (Dropbox Sign posts directly to this endpoint)
app.use("/webhooks/dropbox-sign", dropboxSignWebhookRouter);

app.use("/profile", profileRoutes);
app.use("/inbody", inbodyRoutes);
app.use("/pt-applications", ptApplicationRoutes);
app.use("/contracts", contractRoutes);
app.use("/notifications", notificationRoutes);
app.use("/sessions", sessionRoutes);
app.use("/availability", availabilityRoutes);

// Admin-only operations owned by this service (disputed sessions, …)
app.use("/admin", adminRoutes);

// Public location data (provinces/wards) — no auth required
app.use("/locations", locationRoutes);

// PT training location management — requires auth (handled in route middleware)
app.use("/pt/training-locations", trainingLocationRoutes);

// Service-to-service only. Protected by serviceSecretMiddleware inside the router.
// NOT exposed via gateway public routing.
app.use("/internal", internalRoutes);

export default app;
