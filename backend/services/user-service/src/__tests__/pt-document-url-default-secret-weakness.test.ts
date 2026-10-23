import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * SECURITY HARDENING (D75 item 4) — DEMONSTRATES A CURRENT WEAKNESS, DOES NOT FIX IT.
 *
 * ptDocumentUrl.util.ts signs the short-lived links to PT-application identity documents
 * (national ID, portrait). When neither PT_DOCUMENT_URL_SECRET nor INTERNAL_SERVICE_SECRET is
 * set it falls back to a hard-coded literal (EFFECTIVE_SECRET) EVEN WITH NODE_ENV=production —
 * the production branch only logs an error; verifyDocumentUrl() does not re-check it, despite
 * the comment claiming otherwise. Anyone who has read the repo can then mint a valid link for
 * any known filename.
 *
 * Registered as `todo`: encodes the DESIRED behaviour (such a signature is rejected).
 * The fallback literal is read from source at run time and never printed.
 */
process.env.NODE_ENV = "production";
process.env.PT_DOCUMENT_URL_SECRET = "";
process.env.INTERNAL_SERVICE_SECRET = "";

test(
  "production with no document-URL secret must not accept a link signed with the in-repo fallback literal",
  { todo: "Security Hardening slice S1: no literal fallback for signing secrets; fail-closed unless ALLOW_INSECURE_DEV_SECRETS=true" },
  async () => {
    const src = fs.readFileSync(path.join(__dirname, "../utils/ptDocumentUrl.util.ts"), "utf8");
    const m = src.match(/EFFECTIVE_SECRET\s*=\s*SECRET\s*\|\|\s*"([^"]+)"/);
    assert.ok(m, "fallback literal not found (code changed — update this test)");

    const { verifyDocumentUrl } = await import("../utils/ptDocumentUrl.util");
    const filename = "any-known-file.jpg";
    const exp = Date.now() + 60_000;
    const sig = crypto.createHmac("sha256", m![1]).update(`${filename}:${exp}`).digest("hex");

    assert.equal(
      verifyDocumentUrl(filename, String(exp), sig),
      false,
      "WEAKNESS CONFIRMED: PT identity-document link signed with the public fallback literal verified in production mode",
    );
  },
);
