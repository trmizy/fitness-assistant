/**
 * Listing Management (Phase D2) — installs the "new client" headers (see listingFlow.ts) on the shared axios instance.
 *
 * A side-effect module: importing it once registers ONE request interceptor. It is imported by the files that make the
 * affected calls (services/partnerApplication.ts for the application wizard, services/gymListingApi.ts, the add-branch
 * wizard page), so the interceptor exists before any of those requests is sent. Registering is idempotent per module load
 * (ES modules evaluate once); services/api.ts itself is untouched.
 */
import { api } from "./api";
import { listingFlowHeaders } from "./listingFlow";

api.interceptors.request.use((config) => {
  const headers = listingFlowHeaders(config.method, config.url);
  if (headers) for (const [name, value] of Object.entries(headers)) config.headers.set(name, value);
  return config;
});
