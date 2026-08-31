import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  buildDatabaseUrl,
  createMigrationHandler,
  getRuntimePaths,
  NON_USER_DATABASE_ERROR,
  parseDatabaseSecret,
} from "../migrate-lambda";

const validSecret = {
  username: "user@name",
  password: "p@ss:word/with%chars",
  host: "db.example.internal",
  port: 5432,
  database: "fitness_assistant_user",
};

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(updates)) {
    previous.set(key, process.env[key]);
    const next = updates[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("parseDatabaseSecret validates required fields and port", () => {
  assert.deepEqual(parseDatabaseSecret(JSON.stringify(validSecret)), validSecret);
  assert.throws(() => parseDatabaseSecret(undefined), /SecretString/);
  assert.throws(() => parseDatabaseSecret("{not-json"), /JSON/);
  assert.throws(
    () => parseDatabaseSecret(JSON.stringify({ ...validSecret, username: "" })),
    /username/,
  );
  assert.throws(
    () => parseDatabaseSecret(JSON.stringify({ ...validSecret, port: 70000 })),
    /invalid port/,
  );
});

test("buildDatabaseUrl URL-encodes credentials and targets only fitness_assistant_user", () => {
  const url = buildDatabaseUrl(validSecret);
  assert.equal(
    url,
    "postgresql://user%40name:p%40ss%3Aword%2Fwith%25chars@db.example.internal:5432/fitness_assistant_user",
  );
});

test("buildDatabaseUrl refuses the Auth database fitness_assistant", () => {
  assert.throws(
    () =>
      buildDatabaseUrl({
        ...validSecret,
        database: "fitness_assistant",
      }),
    new RegExp(NON_USER_DATABASE_ERROR),
  );
});

test("buildDatabaseUrl refuses any non-user database", () => {
  assert.throws(
    () =>
      buildDatabaseUrl({
        ...validSecret,
        database: "postgres",
      }),
    new RegExp(NON_USER_DATABASE_ERROR),
  );
});

test("handler succeeds with mocked Secrets Manager and mocked Prisma migrate deploy", async () => {
  await withEnv({ DATABASE_SECRET_ID: "fitness-assistant/dev/user-database" }, async () => {
    let sawDatabaseUrl = "";
    const handler = createMigrationHandler({
      fetchSecretString: async () => JSON.stringify(validSecret),
      runMigrate: () => {
        sawDatabaseUrl = process.env.DATABASE_URL ?? "";
        return { status: 0, stdout: "migrations applied", stderr: "" };
      },
    });

    const response = await handler({}, {});
    assert.equal(response.statusCode, 200);
    assert.match(sawDatabaseUrl, /fitness_assistant_user$/);
    assert.doesNotMatch(JSON.stringify(response), /p@ss:word/);
  });
});

test("handler fails closed when secret points to Auth database", async () => {
  await withEnv({ DATABASE_SECRET_ID: "fitness-assistant/dev/user-database" }, async () => {
    let prismaWasCalled = false;
    const handler = createMigrationHandler({
      fetchSecretString: async () =>
        JSON.stringify({ ...validSecret, database: "fitness_assistant" }),
      runMigrate: () => {
        prismaWasCalled = true;
        return { status: 0 };
      },
    });

    const response = await handler({}, {});
    assert.equal(response.statusCode, 500);
    assert.match(response.body, new RegExp(NON_USER_DATABASE_ERROR));
    assert.equal(prismaWasCalled, false);
  });
});

test("handler fails closed when secret points to an unrelated database", async () => {
  await withEnv({ DATABASE_SECRET_ID: "fitness-assistant/dev/user-database" }, async () => {
    const handler = createMigrationHandler({
      fetchSecretString: async () =>
        JSON.stringify({ ...validSecret, database: "postgres" }),
      runMigrate: () => {
        throw new Error("must not run");
      },
    });

    const response = await handler({}, {});
    assert.equal(response.statusCode, 500);
    assert.match(response.body, new RegExp(NON_USER_DATABASE_ERROR));
  });
});

test("handler reports Prisma CLI non-zero exit as HTTP 500", async () => {
  await withEnv({ DATABASE_SECRET_ID: "fitness-assistant/dev/user-database" }, async () => {
    const handler = createMigrationHandler({
      fetchSecretString: async () => JSON.stringify(validSecret),
      runMigrate: () => ({ status: 1, stdout: "", stderr: "migration failed" }),
    });

    const response = await handler({}, {});
    assert.equal(response.statusCode, 500);
    assert.match(response.body, /migration failed/);
  });
});

test("handler import and Prisma runtime paths resolve artifact-local CLI/schema/engine", async () => {
  const imported = await import("../migrate-lambda");
  assert.equal(typeof imported.handler, "function");

  const paths = getRuntimePaths(path.join("artifact-root", "dist"));
  assert.match(paths.schemaPath, /prisma[\\/]schema\.prisma$/);
  assert.match(paths.prismaCliEntry, /node_modules[\\/]prisma[\\/]build[\\/]index\.js$/);
  assert.match(paths.schemaEngineBinary, /schema-engine-(rhel-openssl-3\.0\.x|windows\.exe)$/);
});
