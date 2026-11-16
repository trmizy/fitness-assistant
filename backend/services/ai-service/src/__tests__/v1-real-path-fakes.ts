/**
 * Test-only in-memory stand-in for the Prisma CLIENT used by the V1 AI Coach code (M9.3-T2). It replaces ONLY the database boundary:
 * `conversationRepository`, `ragService`, the orchestrator, the fitness agent … all stay real and talk to these delegates exactly as
 * they talk to Prisma. `chatSession` and `conversation` behave like the real tables for the operations V1 uses (incl. the unique
 * (userId, clientRequestId) index → P2002); every other model is a null-object (reads → null / [] / 0, writes echo their data).
 * Never imported by production code. No DB, no network.
 */
import { randomUUID } from "node:crypto";

type Row = Record<string, any>;
const matches = (row: Row, where: Row | undefined): boolean => {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Row[]).some((c) => matches(row, c));
    if (k === "AND") return (cond as Row[]).every((c) => matches(row, c));
    if (k === "userId_clientRequestId") return row.userId === (cond as Row).userId && row.clientRequestId === (cond as Row).clientRequestId;
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("not" in c) return row[k] !== c.not;
      if ("in" in c) return (c.in as unknown[]).includes(row[k]);
      if ("startsWith" in c) return String(row[k] ?? "").startsWith(c.startsWith);
      if ("gt" in c) return row[k] > c.gt;
      if ("lt" in c) return row[k] < c.lt;
      return true;
    }
    return (row[k] ?? null) === (cond ?? null);
  });
};
const unique = (code = "P2002") => Object.assign(new Error("Unique constraint failed"), { code });

export interface FakeDb { sessions: Row[]; conversations: Row[]; writes: string[] }

function table(rows: Row[], name: string, writes: string[], hooks: { uniq?: (rows: Row[], data: Row) => boolean; defaults?: () => Row } = {}) {
  const sortBy = (list: Row[], orderBy: Row | Row[] | undefined) => {
    const o = Array.isArray(orderBy) ? orderBy[0] : orderBy;
    if (!o) return list;
    const [k, dir] = Object.entries(o)[0] as [string, string];
    return [...list].sort((a, b) => (String(a[k] ?? "") < String(b[k] ?? "") ? -1 : String(a[k] ?? "") > String(b[k] ?? "") ? 1 : 0) * (dir === "desc" ? -1 : 1));
  };
  const clock = () => new Date();
  return {
    async create({ data }: { data: Row }) {
      if (hooks.uniq?.(rows, data)) throw unique();
      const row = { id: randomUUID(), createdAt: clock(), ...(hooks.defaults?.() ?? {}), ...data };
      rows.push(row); writes.push(`${name}.create`); return row;
    },
    async findUnique({ where }: { where: Row }) { return rows.find((r) => matches(r, where)) ?? null; },
    async findFirst({ where, orderBy }: { where?: Row; orderBy?: Row }) { return sortBy(rows.filter((r) => matches(r, where)), orderBy)[0] ?? null; },
    async findMany({ where, orderBy, take }: { where?: Row; orderBy?: Row; take?: number } = {}) { const l = sortBy(rows.filter((r) => matches(r, where)), orderBy); return take ? l.slice(0, take) : l; },
    async update({ where, data }: { where: Row; data: Row }) { const r = rows.find((x) => matches(x, where)); if (!r) throw Object.assign(new Error("not found"), { code: "P2025" }); Object.assign(r, data, { updatedAt: clock() }); writes.push(`${name}.update`); return r; },
    async updateMany({ where, data }: { where?: Row; data: Row }) { let n = 0; for (const r of rows) if (matches(r, where)) { Object.assign(r, data); n++; } return { count: n }; },
    async count({ where }: { where?: Row } = {}) { return rows.filter((r) => matches(r, where)).length; },
    async deleteMany({ where }: { where?: Row } = {}) { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); n++; } return { count: n }; },
  };
}

const NULL_OPS = ["findFirst", "findUnique", "findMany", "count", "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany", "aggregate", "groupBy"] as const;
const nullObject = (name: string, writes: string[]) => Object.fromEntries(NULL_OPS.map((op) => [op, async (args: Row = {}) => {
  if (["create", "update", "upsert", "createMany", "updateMany", "delete", "deleteMany"].includes(op)) writes.push(`${name}.${op}[null-object]`);
  if (op === "findMany" || op === "groupBy") return [];
  if (op === "count") return 0;
  if (op === "create" || op === "upsert" || op === "update") return { id: randomUUID(), ...(args.data ?? args.create ?? {}) };
  if (op === "aggregate") return {};
  if (op.endsWith("Many")) return { count: 0 };
  return null;
}]));

/** Installs the fakes on the real generated client instance (delegates are assignable; verified in M9.3-T2). */
export function installFakePrisma(prisma: any, models: string[]): FakeDb {
  const db: FakeDb = { sessions: [], conversations: [], writes: [] };
  for (const m of models) prisma[m] = nullObject(m, db.writes);
  prisma.chatSession = table(db.sessions, "chatSession", db.writes, { defaults: () => ({ lastMessageAt: new Date(), archivedAt: null, updatedAt: new Date() }) });
  prisma.conversation = table(db.conversations, "conversation", db.writes, {
    uniq: (rows, d) => d.clientRequestId != null && rows.some((r) => r.userId === d.userId && r.clientRequestId === d.clientRequestId),
    defaults: () => ({ feedback: null, clientRequestId: null }),
  });
  return db;
}
