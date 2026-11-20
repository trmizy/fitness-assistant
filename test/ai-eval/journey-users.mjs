// Shared by run-journeys.mjs and the playground: a cached real account per persona (profile applied), so the auth rate limiter is not burnt.
import fs from "node:fs";
import path from "node:path";
import { registerUser, login, putProfile } from "../ai-chat-full-verification/lib.mjs";

const cachePath = path.resolve(".tmp-stack/journey-users.json");
const read = () => (fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {});

export async function userFor(key, profile) {
  const stamp = process.env.JOURNEY_STAMP || "v1";
  const cache = read();
  const email = `journey.${key}.${stamp}@gymini-test.local`;
  let u = cache[`${stamp}:${key}`] ? await login(email).catch(() => null) : null;
  if (!u?.token) u = await registerUser(email, `Journey ${key}`);
  cache[`${stamp}:${key}`] = { email };
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  const p = await putProfile(u, profile);
  if (p.status !== 200) throw new Error(`profile ${key}: ${p.status}`);
  return u;
}
