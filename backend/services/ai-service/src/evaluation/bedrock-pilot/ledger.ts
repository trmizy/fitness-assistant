import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { canonical } from "../evaluation-kit/identity";
import { ApprovalSchema, PilotError, type SessionConfig, type Approval } from "./config";
import { assertSeparate, openJournal, realDirectory } from "./storage";

const StateSchema = z.object({ attempts: z.number().int().nonnegative(), inferenceCalls: z.number().int().nonnegative(), countCalls: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), estimatedUsd: z.number().finite().nonnegative(), failures: z.number().int().nonnegative(), stopped: z.boolean(), counts: z.record(z.number().int().nonnegative()), attemptKeys: z.array(z.string()) }).strict();
export type LedgerState = z.infer<typeof StateSchema>;
export const initialState = (): LedgerState => ({ attempts: 0, inferenceCalls: 0, countCalls: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, failures: 0, stopped: false, counts: {}, attemptKeys: [] });
const IssuedSchema = z.object({ event: z.literal("ISSUED"), authority: z.enum(["FAKE_TEST_ONLY", "OWNER_SIGNED"]), approvalId: z.string(), approvalHash: z.string(), configHash: z.string() }).strict();

// Fixed bootstrap location; never taken from env or an artifact/config payload.
export const installedTrustFile = () => path.join(os.homedir(), ".gymini-evaluation", "trust.json");
export function verifySignedApproval(value: unknown, trust: { issuer: string; publicKeyPem: string }) {
  const a = ApprovalSchema.parse(value), { signature, ...body } = a;
  const key = createPublicKey(trust.publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519" || a.issuer !== trust.issuer || !verify(null, Buffer.from(canonical(body)), key, Buffer.from(signature, "base64"))) throw new PilotError("APPROVAL_SIGNATURE_INVALID");
  if (Date.parse(a.expiresAt) <= Date.now()) throw new PilotError("APPROVAL_EXPIRED");
  return a;
}
export function installedApproval(c: SessionConfig): { directory: string; approval: Approval } {
  try {
    const file = installedTrustFile(); realDirectory(path.dirname(file));
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error();
    const trust = z.object({ version: z.literal("owner-trust-v1"), issuer: z.string(), publicKeyPem: z.string(), ledgerDirectory: z.string() }).strict().parse(JSON.parse(fs.readFileSync(file, "utf8")));
    const directory = realDirectory(trust.ledgerDirectory);
    if (c.sources) assertSeparate(directory, c.sources.workspaceRoot);
    return { directory, approval: verifySignedApproval(c.approval, trust) };
  } catch (e) { if (e instanceof PilotError) throw e; throw new PilotError("TRUSTED_APPROVAL_STORE_UNAVAILABLE"); }
}
/** TEST FIXTURE ONLY. Live needs an owner-preissued, durable ISSUED journal. */
export function issueFixtureLedger(directory: string, approvalId: string, configHash: string, approvalHash: string) {
  fs.mkdirSync(directory, { recursive: true });
  const journal = openJournal(path.join(realDirectory(directory), approvalId + ".jsonl"), true);
  journal.append({ event: "ISSUED", authority: "FAKE_TEST_ONLY", approvalId, approvalHash, configHash });
}
export function openBudgetLedger(args: { directory: string; approvalId: string; approvalHash: string; configHash: string; runDirectory: string; mode: "FAKE" | "LIVE"; resume: boolean }) {
  const root = realDirectory(args.directory); assertSeparate(root, args.runDirectory);
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(args.approvalId)) throw new PilotError("APPROVAL_ID_INVALID");
  const lock = path.join(root, args.approvalId + ".lock"), file = path.join(root, args.approvalId + ".jsonl");
  let fd: number;
  try { fd = fs.openSync(lock, "wx", 0o600); fs.writeFileSync(fd, canonical({ pid: process.pid, configHash: args.configHash, runDirectory: path.resolve(args.runDirectory) })); fs.fsyncSync(fd); }
  catch { throw new PilotError("LEDGER_LOCK_UNAVAILABLE"); }
  let closed = false;
  const close = () => { if (!closed) { fs.closeSync(fd); fs.unlinkSync(lock); closed = true; } };
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new PilotError("LEDGER_UNVERIFIABLE");
    const journal = openJournal(file), issued = IssuedSchema.parse(journal.records[0]);
    if (issued.approvalId !== args.approvalId || issued.approvalHash !== args.approvalHash || issued.configHash !== args.configHash || (args.mode === "LIVE" && issued.authority !== "OWNER_SIGNED")) throw new PilotError("APPROVAL_LEDGER_BINDING_MISMATCH");
    const claims = journal.records.slice(1) as { event: string; runDirectory: string; state: LedgerState }[];
    const previous = claims.at(-1);
    if (previous && (!args.resume || previous.runDirectory !== path.resolve(args.runDirectory))) throw new PilotError("APPROVAL_ALREADY_USED");
    if (!previous && args.resume) throw new PilotError("RESUME_WITHOUT_CLAIM");
    let state = StateSchema.parse(previous?.state ?? initialState());
    const save = (next: LedgerState, event: string) => {
      if (closed) throw new PilotError("LEDGER_CLOSED");
      // Missing/replaced ledger/lock or a partial append cannot silently reset accounting.
      if (!fs.existsSync(lock) || !fs.existsSync(file)) throw new PilotError("LEDGER_UNVERIFIABLE");
      journal.append({ event, runDirectory: path.resolve(args.runDirectory), state: StateSchema.parse(next) }); state = structuredClone(next);
    };
    save(state, args.resume ? "RESUMED" : "CLAIMED");
    return { state: () => structuredClone(state), save, close };
  } catch (e) { close(); if (e instanceof PilotError) throw e; throw new PilotError("LEDGER_UNVERIFIABLE"); }
}
