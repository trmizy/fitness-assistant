import axios from "axios";
import { testAccountsBlocked } from "@gym-coach/shared";
import { invokeHttpLambda } from "./lambda-http.client";

/**
 * Ids of test/seed/eval accounts, from auth-service (the only service that knows emails) — left out of admin statistics
 * on the deployed server (2026-11-08, "lọc dữ liệu test khỏi thống kê"). Returns [] when the filter is off (local stacks,
 * where nearly every account is a test account) and null when auth cannot be read: callers then show unfiltered numbers
 * and say so, never a guess. Cached 5 minutes per warm instance.
 */
const TTL_MS = 5 * 60 * 1000;
let cache: { at: number; ids: string[] } | null = null;

export async function fetchTestAccountIds(): Promise<string[] | null> {
  if (!testAccountsBlocked()) return [];
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  const headers = { "x-service-secret": process.env.INTERNAL_SERVICE_SECRET || "" };
  const path = "/auth/internal/test-account-ids";
  try {
    let body: any;
    if (process.env.AUTH_LAMBDA_NAME) {
      const r = await invokeHttpLambda({ functionName: process.env.AUTH_LAMBDA_NAME, method: "GET", path, headers });
      if (r.statusCode >= 400) throw new Error(`auth ${r.statusCode}`);
      body = r.body;
    } else {
      body = (await axios.get(`${process.env.AUTH_SERVICE_URL || "http://localhost:3001"}${path}`, { headers, timeout: 5000 })).data;
    }
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string") : null;
    if (!ids) return null;
    cache = { at: Date.now(), ids };
    return ids;
  } catch {
    return null;
  }
}

/** Test hook. */
export function resetTestAccountIdsCache(): void { cache = null; }
