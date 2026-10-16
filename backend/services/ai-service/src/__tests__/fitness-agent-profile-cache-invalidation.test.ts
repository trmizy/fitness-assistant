/**
 * Stale-context-after-write (found by the full chat verification, docs/ai-chat-multi-agent-full-verification.md):
 * the chat workflow writes the authoritative profile and immediately resumes the original request, but profile_extractor
 * served its 15 s per-user cache, so the resumed roadmap answered "missing profile data" for values that had just been
 * saved. The single write path (fitnessAgentTools.updateProfileFields) must now invalidate that cache.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { profileExtractor } from "../llm/profile_extractor";
import { fitnessAgentTools } from "../services/fitness-agent-tools";

test("after updateProfileFields the NEXT profile read is fresh (not the pre-write cached snapshot)", async () => {
  const userId = `cache-${randomUUID()}`;
  const identity = { userId, authorizationHeader: "Bearer test" } as any;
  const origGet = axios.get; const origRequest = axios.request;
  let profileReads = 0;
  try {
    axios.get = (async (url: string) => {
      if (String(url).endsWith("/profile/me")) profileReads += 1;
      return { data: { profile: { age: profileReads >= 2 ? 27 : null } } };
    }) as any;
    axios.request = (async () => ({ data: { ok: true } })) as any;

    await profileExtractor.extract(userId, "Bearer test");
    assert.equal(profileReads, 1);
    await profileExtractor.extract(userId, "Bearer test");
    assert.equal(profileReads, 1, "control: within the TTL the second read is served from the cache");

    await fitnessAgentTools.updateProfileFields(identity, { age: 27 } as any);
    await profileExtractor.extract(userId, "Bearer test");
    assert.equal(profileReads, 2, "the read after the authoritative write must go back to user-service");
  } finally {
    axios.get = origGet; axios.request = origRequest; profileExtractor.invalidateCache(userId);
  }
});

test("a FAILED profile write does not need to (and does not silently) invalidate: the error propagates", async () => {
  const identity = { userId: `cache-${randomUUID()}`, authorizationHeader: "Bearer test" } as any;
  const origRequest = axios.request;
  try {
    axios.request = (async () => { throw Object.assign(new Error("boom"), { response: { status: 503 } }); }) as any;
    await assert.rejects(() => fitnessAgentTools.updateProfileFields(identity, { age: 27 } as any));
  } finally { axios.request = origRequest; }
});
