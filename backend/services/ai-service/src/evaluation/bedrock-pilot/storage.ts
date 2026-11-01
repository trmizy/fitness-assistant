import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { canonical, digest } from "../evaluation-kit/identity";
import { PilotError } from "./config";

/** Append, fsync and hash-chain. An incomplete/tampered tail is never truncated automatically. */
export function openJournal(file: string, create = false) {
  if (create) { const fd = fs.openSync(file, "wx", 0o600); fs.fsyncSync(fd); fs.closeSync(fd); }
  const text = fs.readFileSync(file, "utf8");
  const identity = fs.statSync(file); let expectedText = text;
  if (text && !text.endsWith("\n")) throw new PilotError("JOURNAL_INCOMPLETE");
  let previous = "GENESIS", sequence = 0;
  const records: unknown[] = [];
  for (const line of text.trimEnd().split("\n").filter(Boolean)) {
    let row: { sequence: number; previous: string; record: unknown; hash: string };
    try { row = JSON.parse(line); } catch { throw new PilotError("JOURNAL_INVALID"); }
    if (row.sequence !== ++sequence || row.previous !== previous || row.hash !== digest({ sequence: row.sequence, previous: row.previous, record: row.record })) throw new PilotError("JOURNAL_INTEGRITY_FAILED");
    previous = row.hash; records.push(row.record);
  }
  let broken = false;
  return { records, append(record: unknown) {
    if (broken) throw new PilotError("JOURNAL_UNUSABLE");
    const body = { sequence: sequence + 1, previous, record }, row = { ...body, hash: digest(body) };
    let fd: number | undefined;
    try {
      const current = fs.lstatSync(file);
      if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || fs.readFileSync(file, "utf8") !== expectedText) throw new PilotError("JOURNAL_REPLACED_OR_CHANGED");
      const line = canonical(row) + "\n";
      fd = fs.openSync(file, "a"); fs.writeFileSync(fd, line); fs.fsyncSync(fd); expectedText += line;
    }
    catch { broken = true; throw new PilotError("PersistenceFailure"); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
    sequence++; previous = row.hash; records.push(record);
  } };
}
/** Atomic immutable outputs. Never replace an existing review result on resume. */
export function atomicCreate(file: string, value: unknown) {
  const temp = path.join(path.dirname(file), ".pending-" + randomUUID());
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, canonical(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); } finally { fs.unlinkSync(temp); }
}
export function assertSeparate(a: string, b: string) {
  const x = path.resolve(a).toLowerCase(), y = path.resolve(b).toLowerCase();
  if (x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep)) throw new PilotError("LedgerMustBeOutsideRun");
}
export function realDirectory(directory: string) {
  const resolved = path.resolve(directory);
  if (fs.lstatSync(resolved).isSymbolicLink() || fs.realpathSync(resolved).toLowerCase() !== resolved.toLowerCase()) throw new PilotError("UNTRUSTED_LEDGER_PATH");
  if (!fs.statSync(resolved).isDirectory()) throw new PilotError("LEDGER_DIRECTORY_REQUIRED");
  return resolved;
}
