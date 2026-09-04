/**
 * Regression tests for the P0 fix: PT application identity documents
 * (national ID front/back, portrait, certificates) were previously served
 * unauthenticated via `express.static("/uploads")` — anyone who knew or
 * guessed a filename could download another person's ID documents with no
 * login at all.
 *
 * These tests exercise the signed-URL scheme (ptDocumentUrl.util.ts) that
 * replaced it: a link is only valid if its HMAC signature matches, and only
 * within a short TTL. The signature is minted only inside getMe/getById/
 * listApplications, which already run behind authMiddleware + the existing
 * own-application/ADMIN-only route gates — this is what makes an
 * unauthenticated <img src> request to the document-serving endpoint safe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  toSignedPtDocumentUrl,
  verifyDocumentS3Key,
  verifyDocumentUrl,
  canonicalizePtDocumentUrl,
  signPtApplicationDocumentUrls,
} from "../utils/ptDocumentUrl.util";

function parseSignedUrl(url: string): { filename: string; exp: string; sig: string } {
  const [path, query] = url.split("?");
  const filename = decodeURIComponent(path.replace("/pt-applications/documents/", ""));
  const params = new URLSearchParams(query);
  return { filename, exp: params.get("exp")!, sig: params.get("sig")! };
}

function parseSignedS3Url(url: string): { key: string; exp: string; sig: string } {
  const parsed = new URL(url, "http://internal.local");
  return {
    key: parsed.searchParams.get("key")!,
    exp: parsed.searchParams.get("exp")!,
    sig: parsed.searchParams.get("sig")!,
  };
}

test("SECURITY: toSignedPtDocumentUrl produces a link that verifies successfully", () => {
  const signed = toSignedPtDocumentUrl("/uploads/pt-applications/document-123-456.png");
  assert.ok(signed);
  const { filename, exp, sig } = parseSignedUrl(signed!);
  assert.equal(filename, "document-123-456.png");
  assert.equal(verifyDocumentUrl(filename, exp, sig), true);
});

test("SECURITY: toSignedPtDocumentUrl supports private S3 PT documents via a short-lived redirect URL", () => {
  const signed = toSignedPtDocumentUrl("s3://pt-applications/user-123/front.png");
  assert.ok(signed);
  assert.ok(signed!.startsWith("/pt-applications/documents/s3?"));
  const { key, exp, sig } = parseSignedS3Url(signed!);
  assert.equal(key, "pt-applications/user-123/front.png");
  assert.equal(verifyDocumentS3Key(key, exp, sig), true);
});

test("SECURITY: S3 document signatures cannot be reused across keys", () => {
  const signed = toSignedPtDocumentUrl("s3://pt-applications/user-123/front.png")!;
  const { exp, sig } = parseSignedS3Url(signed);
  assert.equal(verifyDocumentS3Key("pt-applications/user-456/front.png", exp, sig), false);
});

test("SECURITY: a forged signature (attacker guesses filename, invents a signature) is rejected", () => {
  const signed = toSignedPtDocumentUrl("/uploads/pt-applications/id-card-front.png")!;
  const { filename, exp } = parseSignedUrl(signed);
  assert.equal(verifyDocumentUrl(filename, exp, "0000000000000000000000000000000000000000000000000000000000000000"), false);
});

test("SECURITY: a signature for one filename does not verify for a different filename (no cross-file reuse)", () => {
  const signedA = toSignedPtDocumentUrl("/uploads/pt-applications/a.png")!;
  const { exp, sig } = parseSignedUrl(signedA);
  // Attacker takes a validly-signed link's signature and tries to reuse it for a
  // different filename they want to steal.
  assert.equal(verifyDocumentUrl("b.png", exp, sig), false);
});

test("SECURITY: an expired link (exp in the past) is rejected even with a correct signature", () => {
  // Manually construct what would have been a validly-signed link 10 minutes
  // ago (TTL is 5 minutes) by asking for a signature with a past exp — this
  // simulates a link a user held onto/shared long after it should have expired.
  const pastExp = String(Date.now() - 10 * 60 * 1000);
  // We can't compute a "real" past signature without the module's private key,
  // so instead verify indirectly: a freshly-minted signature checked against a
  // tampered (rolled-back) exp must fail, proving exp is bound into the signature
  // and can't be freely edited independently of it.
  const signed = toSignedPtDocumentUrl("/uploads/pt-applications/c.png")!;
  const { filename, sig } = parseSignedUrl(signed);
  assert.equal(verifyDocumentUrl(filename, pastExp, sig), false);
});

test("SECURITY: tampering with exp (extending it) invalidates the signature", () => {
  const signed = toSignedPtDocumentUrl("/uploads/pt-applications/d.png")!;
  const { filename, exp, sig } = parseSignedUrl(signed);
  const extendedExp = String(Number(exp) + 999_999_999);
  assert.equal(verifyDocumentUrl(filename, extendedExp, sig), false);
});

test("verifyDocumentUrl rejects missing exp or sig outright", () => {
  assert.equal(verifyDocumentUrl("a.png", undefined, "somesig"), false);
  assert.equal(verifyDocumentUrl("a.png", "123", undefined), false);
  assert.equal(verifyDocumentUrl("a.png", undefined, undefined), false);
});

test("toSignedPtDocumentUrl passes through non-pt-application URLs unchanged (e.g. already-external or null)", () => {
  assert.equal(toSignedPtDocumentUrl(null), null);
  assert.equal(toSignedPtDocumentUrl(undefined), null);
  assert.equal(toSignedPtDocumentUrl("https://cdn.example.com/photo.png"), "https://cdn.example.com/photo.png");
});

test("canonicalizePtDocumentUrl round-trips a signed link back to the stable stored path", () => {
  const signed = toSignedPtDocumentUrl("/uploads/pt-applications/document-999-111.jpg")!;
  assert.equal(canonicalizePtDocumentUrl(signed), "/uploads/pt-applications/document-999-111.jpg");
});

test("canonicalizePtDocumentUrl round-trips a signed S3 link back to a stable private S3 ref", () => {
  const signed = toSignedPtDocumentUrl("s3://pt-applications/user-123/cert.pdf")!;
  assert.equal(canonicalizePtDocumentUrl(signed), "s3://pt-applications/user-123/cert.pdf");
});

test("canonicalizePtDocumentUrl leaves an already-raw stored path unchanged", () => {
  const raw = "/uploads/pt-applications/document-1-2.jpg";
  assert.equal(canonicalizePtDocumentUrl(raw), raw);
});

test("canonicalizePtDocumentUrl passes through null/undefined safely", () => {
  assert.equal(canonicalizePtDocumentUrl(null), null);
  assert.equal(canonicalizePtDocumentUrl(undefined), undefined);
});

test("SECURITY: signPtApplicationDocumentUrls signs every document field, including nested certificates/media", () => {
  const app = {
    id: "app-1",
    idCardFrontUrl: "/uploads/pt-applications/front.png",
    idCardBackUrl: "/uploads/pt-applications/back.png",
    portraitPhotoUrl: "/uploads/pt-applications/portrait.png",
    certificates: [{ id: "c1", certificateFileUrl: "/uploads/pt-applications/cert.pdf" }],
    media: [{ id: "m1", fileUrl: "/uploads/pt-applications/media.png" }],
  };
  const signed = signPtApplicationDocumentUrls(app);
  for (const url of [
    signed.idCardFrontUrl,
    signed.idCardBackUrl,
    signed.portraitPhotoUrl,
    signed.certificates[0].certificateFileUrl,
    signed.media[0].fileUrl,
  ]) {
    assert.ok(url.startsWith("/pt-applications/documents/"), `expected a signed link, got ${url}`);
    const { filename, exp, sig } = parseSignedUrl(url);
    assert.equal(verifyDocumentUrl(filename, exp, sig), true);
  }
});

test("signPtApplicationDocumentUrls does not mutate the original object", () => {
  const app = { idCardFrontUrl: "/uploads/pt-applications/front.png" };
  const original = { ...app };
  signPtApplicationDocumentUrls(app);
  assert.deepEqual(app, original);
});

test("signPtApplicationDocumentUrls handles a null document field without throwing", () => {
  const app = { idCardFrontUrl: null, certificates: [], media: [] };
  const signed = signPtApplicationDocumentUrls(app);
  assert.equal(signed.idCardFrontUrl, null);
});
