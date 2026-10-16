const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadHandler() {
  const queries = [];
  let secretReads = 0;
  let spawns = 0;
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "../../backend/services/ai-service/src/migrate-lambda.ts",
    ),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  class Client {
    async connect() {}
    async end() {}
    async query(sql) {
      queries.push(sql);
      return { rows: sql.includes("count(*)::int") ? [{ count: 0 }] : [] };
    }
  }
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    URL,
    process: { env: { DATABASE_SECRET_ID: "test-only" } },
    require(name) {
      if (name === "pg") return { Client };
      if (name === "node:child_process")
        return {
          spawn() {
            spawns++;
            throw new Error("Unexpected process");
          },
        };
      if (name === "@aws-sdk/client-secrets-manager")
        return {
          GetSecretValueCommand: class {},
          SecretsManagerClient: class {
            async send() {
              secretReads++;
              return {
                SecretString: JSON.stringify({
                  username: "fixture",
                  password: "fixture",
                  host: "fixture",
                  port: 5432,
                  database: "fitness_assistant_ai",
                }),
              };
            }
          },
        };
      return require(name);
    },
  });
  return {
    handler: exports.handler,
    queries,
    counts: () => ({ secretReads, spawns }),
  };
}

test("status runs only read-only metadata queries and never starts Prisma migrations", async () => {
  const h = loadHandler();
  const result = await h.handler({
    database: "fitness_assistant_ai",
    operation: "status",
  });
  assert.equal(result.status, "inspection");
  assert.equal(h.queries[0], "BEGIN READ ONLY");
  assert.equal(h.queries.at(-1), "COMMIT");
  assert.ok(h.queries.slice(1, -1).every((sql) => sql.startsWith("SELECT ")));
  assert.deepEqual(h.counts(), { secretReads: 1, spawns: 0 });
});

test("unknown operations fail before credentials, database access or migrations", async () => {
  const h = loadHandler();
  await assert.rejects(
    h.handler({ operation: "reset" }),
    /Unsupported migration operation/,
  );
  assert.deepEqual(h.counts(), { secretReads: 0, spawns: 0 });
  assert.equal(h.queries.length, 0);
});

test("status refuses any database other than the AI database", async () => {
  const h = loadHandler();
  await assert.rejects(
    h.handler({ database: "fitness_assistant_user", operation: "status" }),
    /Refusing/,
  );
  assert.deepEqual(h.counts(), { secretReads: 0, spawns: 0 });
  assert.equal(h.queries.length, 0);
});
