/**
 * db-clean - small shared helpers: canonical JSON, hashing, tuple normalisation, SQL literals, atomic file writes, arg parsing.
 * Nothing here talks to a database.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class Refused extends Error {
  constructor(msg, code = 'REFUSED') {
    super(msg);
    this.name = 'Refused';
    this.code = code;
  }
}

export const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

/** Deterministic JSON: object keys sorted (code-unit order), array order kept, strings NFC. undefined is dropped, NaN/Infinity refused. */
export function canonicalJSON(value) {
  return JSON.stringify(canon(value));
}
function canon(v) {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(canon);
  switch (typeof v) {
    case 'string':
      return v.normalize('NFC');
    case 'number':
      if (!Number.isFinite(v)) throw new Error('canonicalJSON: non-finite number');
      return v;
    case 'boolean':
      return v;
    case 'object': {
      if (v instanceof Date) return v.toISOString();
      const out = {};
      for (const k of Object.keys(v).sort()) {
        if (v[k] === undefined) continue;
        out[k.normalize('NFC')] = canon(v[k]);
      }
      return out;
    }
    default:
      throw new Error(`canonicalJSON: unsupported type ${typeof v}`);
  }
}

/** One normalised key tuple -> one line (unambiguous: a JSON array of strings). */
export const tupleLine = (tuple) => JSON.stringify(tuple);
/** Sort tuples by their line, plain code-unit comparison (never the database collation). */
export function sortTuples(tuples) {
  return tuples
    .map((t) => [tupleLine(t), t])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map((x) => x[1]);
}
/** fingerprint = sha256( the normalised, sorted tuples, one per line ). */
export const fingerprintOf = (sortedTuples) => sha256Hex(sortedTuples.map(tupleLine).join('\n'));
export function hasDuplicateTuples(sortedTuples) {
  for (let i = 1; i < sortedTuples.length; i++) if (tupleLine(sortedTuples[i]) === tupleLine(sortedTuples[i - 1])) return true;
  return false;
}
/** Two-way difference of two tuple sets. Returns { extra: in a not b, missing: in b not a } (full lists). */
export function diffTuples(a, b) {
  const sa = new Set(a.map(tupleLine));
  const sb = new Set(b.map(tupleLine));
  return {
    extra: a.filter((t) => !sb.has(tupleLine(t))),
    missing: b.filter((t) => !sa.has(tupleLine(t))),
  };
}

// ---------- SQL literals (only used by the psql-in-container driver; the TCP driver uses real bind parameters) ----------
const pgArrayElem = (e) => (e === null ? 'NULL' : `"${String(e).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
export function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Array.isArray(v)) return `'${`{${v.map(pgArrayElem).join(',')}}`.replace(/'/g, "''")}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
/** Replace $1..$n with literals (outside quotes - our statements never contain a $n inside a string). */
export function bindParams(sql, params) {
  if (!params || params.length === 0) return sql;
  return sql.replace(/\$(\d+)(?!\d)/g, (m, n) => {
    const i = Number(n) - 1;
    if (i < 0 || i >= params.length) throw new Error(`bindParams: no value for ${m}`);
    return sqlLiteral(params[i]);
  });
}

// ---------- files ----------
export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
/** Atomic JSON write (write temp, rename). */
export function writeJsonAtomic(file, data, { pretty = true } = {}) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, pretty ? `${JSON.stringify(data, null, 2)}\n` : JSON.stringify(data));
  fs.renameSync(tmp, file);
}
export const fileSha256 = (file) => sha256Hex(fs.readFileSync(file));
export const nowIso = () => new Date().toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- CLI parsing: strict, unknown flags are refused (there is no override flag for anything) ----------
export function parseArgs(argv, spec) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const def = spec[name];
    if (!def) throw new Refused(`unknown option --${name}`, 'UNKNOWN_OPTION');
    if (def === 'bool') {
      out[name] = true;
    } else {
      let val = eq === -1 ? argv[++i] : a.slice(eq + 1);
      if (val === undefined) throw new Refused(`--${name} needs a value`, 'BAD_ARGS');
      out[name] = val;
    }
  }
  return out;
}

export function mapLimit(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  return Promise.all(workers).then(() => results);
}
