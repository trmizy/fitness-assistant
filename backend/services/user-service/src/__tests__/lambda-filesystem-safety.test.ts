import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Regression coverage for the real Lambda crash this fix addresses:
 *   ENOENT: no such file or directory, mkdir 'uploads/profile-photos/'
 * at `require("./dist/routes/profile.routes.js")` — root cause: multer({dest: <string>})
 * synchronously `mkdirSync`s its destination INSIDE its own constructor
 * (node_modules/multer/storage/disk.js), which used to run at module-import time.
 *
 * These tests run with `AWS_LAMBDA_FUNCTION_NAME` set (the real signal `isLambdaRuntime()`
 * checks) and — critically — from a cwd where `uploads/` genuinely does not exist, so a
 * regression would reproduce the exact ENOENT here, not just in a real Lambda cold start.
 */

function withLambdaEnv(fn: (emptyCwd: string) => void) {
  const prev = process.env.AWS_LAMBDA_FUNCTION_NAME;
  const prevCwd = process.cwd();
  // A directory that exists but definitely has no `uploads/` child — reproduces the exact
  // "cwd has no uploads dir" condition a real Lambda cold start is in.
  const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "user-svc-fs-safety-"));
  process.env.AWS_LAMBDA_FUNCTION_NAME = "fitness-assistant-dev-user";
  process.chdir(emptyCwd);
  try {
    fn(emptyCwd); // callers must check emptyCwd for side effects BEFORE this returns — cwd/dir are restored/deleted right after
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(emptyCwd, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: 100,
    });
    if (prev === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = prev;
  }
}

function withLocalEnv(fn: () => void) {
  const prev = process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  try {
    fn();
  } finally {
    if (prev !== undefined) process.env.AWS_LAMBDA_FUNCTION_NAME = prev;
  }
}

test("isLambdaRuntime() reflects AWS_LAMBDA_FUNCTION_NAME exactly", async () => {
  const { isLambdaRuntime } = await import("../utils/runtime.util");
  const prev = process.env.AWS_LAMBDA_FUNCTION_NAME;
  try {
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    assert.strictEqual(isLambdaRuntime(), false);
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fitness-assistant-dev-user";
    assert.strictEqual(isLambdaRuntime(), true);
  } finally {
    if (prev === undefined) delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    else process.env.AWS_LAMBDA_FUNCTION_NAME = prev;
  }
});

test("profile.routes.ts imports cleanly on Lambda with no uploads/ dir present (the exact original crash)", () => {
  withLambdaEnv((emptyCwd) => {
    assert.doesNotThrow(() => {
      delete require.cache[require.resolve("../routes/profile.routes")];
      require("../routes/profile.routes");
    });
    assert.ok(!fs.existsSync(path.join(emptyCwd, "uploads")), "must not have created uploads/ as a side effect");
  });
});

test("inbody.routes.ts imports cleanly on Lambda with no uploads/ dir present", () => {
  withLambdaEnv(() => {
    assert.doesNotThrow(() => {
      delete require.cache[require.resolve("../routes/inbody.routes")];
      require("../routes/inbody.routes");
    });
  });
});

test("pt_application.routes.ts imports cleanly on Lambda with no uploads/ dir present", () => {
  withLambdaEnv(() => {
    assert.doesNotThrow(() => {
      delete require.cache[require.resolve("../routes/pt_application.routes")];
      require("../routes/pt_application.routes");
    });
  });
});

test("app.ts imports cleanly on Lambda and creates no uploads/ directory", () => {
  withLambdaEnv((emptyCwd) => {
    assert.doesNotThrow(() => {
      delete require.cache[require.resolve("../app")];
      require("../app");
    });
    assert.ok(!fs.existsSync(path.join(emptyCwd, "uploads")), "app.ts must not create uploads/ on Lambda");
  });
});

test("local/Docker (AWS_LAMBDA_FUNCTION_NAME unset): profile.routes.ts still constructs disk multer as before (no regression)", () => {
  withLocalEnv(() => {
    delete require.cache[require.resolve("../routes/profile.routes")];
    assert.doesNotThrow(() => require("../routes/profile.routes"));
  });
});

test("local/Docker: inbody.routes.ts still targets uploads/ (not /tmp) — behavior unchanged", () => {
  withLocalEnv(() => {
    delete require.cache[require.resolve("../routes/inbody.routes")];
    assert.doesNotThrow(() => require("../routes/inbody.routes"));
  });
});
