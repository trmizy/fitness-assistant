import { randomInt } from "crypto";
import { profileRepository } from "../repositories/profile.repository";

// Excludes 0/O/1/I/L and vowels that spell awkward words by accident — a code a PT reads
// aloud to a client over the phone should not be ambiguous on either end.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LENGTH = 8;

function randomCode(): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/**
 * Assigns a referral code to a PT, once. Called at approval time (money-flow plan §2.1) —
 * never regenerated afterward, so a code a PT has already handed out never goes stale.
 *
 * Idempotent: a PT who somehow gets approved twice (retry, admin re-click) keeps their
 * existing code rather than getting a second one that would orphan the first.
 */
export async function assignReferralCodeIfMissing(userId: string): Promise<string> {
  const existing = await profileRepository.findByUserId(userId);
  if (existing?.referralCode) return existing.referralCode;

  // Collision odds are astronomically low at 32^8, but the unique constraint is the real
  // guarantee — retry is just to give a human-readable error path a chance to not happen.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    try {
      await profileRepository.upsert(userId, { referralCode: code });
      return code;
    } catch (e: any) {
      if (e?.code !== "P2002") throw e; // not a unique-constraint clash — a real failure
    }
  }
  throw new Error(`Could not assign a unique referral code for ${userId} after 5 attempts`);
}
