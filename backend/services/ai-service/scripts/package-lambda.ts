/**
 * Builds the real AWS Lambda deployment artifacts for ai-service:
 *
 *   artifacts/ai-lambda.zip          handler dist/lambda.handler        (API Gateway HTTP API, payload 2.0)
 *   artifacts/ai-worker-lambda.zip   handler dist/worker-lambda.handler (SQS trigger) — byte-identical to
 *                                    ai-lambda.zip by design: same dependency graph, only the configured
 *                                    Lambda Handler differs. dist/jobs-lambda.handler ships in it too.
 *   artifacts/ai-migrate-lambda.zip  handler dist/migrate-lambda.handler (manual invoke, prisma migrate deploy)
 *
 * Why it doesn't just zip the workspace node_modules: this is a pnpm monorepo,
 * so node_modules is a tree of symlinks into the pnpm store, and
 * @gym-coach/shared is a `workspace:*` link. A Lambda zip must be
 * self-contained. So each artifact is staged in its own scratch directory and
 * its dependencies are installed there with plain npm (real files, no
 * symlinks), cross-targeted at the Lambda runtime (--os=linux --cpu=x64
 * --libc=glibc), with @gym-coach/shared injected as an `npm pack` tarball.
 *
 * Prisma: the query engine for AWS Lambda (Amazon Linux 2023 = glibc) is
 * rhel-openssl-3.0.x — declared in prisma/schema.prisma's binaryTargets and
 * produced by `prisma generate`. Engines for the other targets (musl/debian/
 * windows) are pruned from the artifact; only rhel is kept. The migration
 * artifact additionally needs the prisma CLI's own schema-engine for that
 * platform, which is why its npm install runs with
 * PRISMA_CLI_BINARY_TARGETS=rhel-openssl-3.0.x.
 *
 * Executable bits: this repo is developed on Windows, where the +x bit does
 * not exist. The zip writer below sets mode 0o755 on every file whose first
 * four bytes are the ELF magic number (\x7fELF) — that covers both the
 * `*.so.node` engine addon and the extension-less `schema-engine-*` binary the
 * migration Lambda spawns, which would otherwise be un-runnable on Lambda.
 *
 * Usage: pnpm --filter @gym-coach/ai-service run build:lambda:package
 * (run `pnpm --filter @gym-coach/shared build` and
 *  `pnpm --filter @gym-coach/ai-service build` first — this script does not
 *  compile, it only packages what dist/ already holds.)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const SERVICE_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVICE_ROOT, "../../..");
const SHARED_ROOT = path.join(REPO_ROOT, "backend/shared");
const ARTIFACTS = path.join(SERVICE_ROOT, "artifacts");
const STAGE = path.join(ARTIFACTS, "_stage");

const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
// Cross-target the Lambda runtime (Node.js 22.x, x86_64, Amazon Linux 2023).
const CROSS_TARGET = ["--os=linux", "--cpu=x64", "--libc=glibc"];
// Mirrors pnpm's (non-strict) peer resolution — bullmq declares an optional
// peer on redis>=5 while this service pins redis@^4, which npm's strict
// resolver rejects outright.
const NPM_FLAGS = ["--omit=dev", "--no-audit", "--no-fund", "--legacy-peer-deps", ...CROSS_TARGET];

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): void {
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
    // npm ships as npm.cmd on Windows, and Node refuses to spawn .cmd/.bat
    // without a shell since the CVE-2024-27980 fix (EINVAL otherwise).
    shell: process.platform === "win32",
  });
}

function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

/**
 * Compiled tests are never reachable from any Lambda handler's import graph
 * (they are test *entrypoints*), so they are dead weight in a deployment
 * package and the deployment spec excludes them outright.
 */
function pruneTests(distDir: string): void {
  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    const full = path.join(distDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") rmrf(full);
      else pruneTests(full);
    } else if (/\.(test|spec)\.js(\.map)?$/.test(entry.name)) {
      fs.rmSync(full, { force: true });
    }
  }
}

function isElf(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  } catch {
    return false;
  }
}

/** Minimal store-nothing-fancy zip writer (deflate), with unix modes. */
async function zipDir(srcDir: string, outZip: string): Promise<number> {
  // archiver is resolved from the service's own devDependencies at package
  // time; it is never shipped inside an artifact.
  const archiver = require("archiver");
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outZip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(output);

    const add = (dir: string, base: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) add(full, rel);
        else if (entry.isFile())
          archive.file(full, { name: rel, mode: isElf(full) ? 0o755 : 0o644 });
      }
    };
    add(srcDir, "");
    void archive.finalize();
  });
  return fs.statSync(outZip).size;
}

function stageHttpPackage(): string {
  const stage = path.join(STAGE, "http");
  rmrf(stage);
  fs.mkdirSync(stage, { recursive: true });

  // @gym-coach/shared is a workspace: link — npm can't resolve that protocol,
  // so hand it a real tarball instead.
  run(NPM, ["pack", "--silent"], SHARED_ROOT);
  const tarball = fs
    .readdirSync(SHARED_ROOT)
    .find((f) => f.startsWith("gym-coach-shared-") && f.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack did not produce a @gym-coach/shared tarball");
  fs.copyFileSync(path.join(SHARED_ROOT, tarball), path.join(stage, tarball));

  const pkg = JSON.parse(fs.readFileSync(path.join(SERVICE_ROOT, "package.json"), "utf8"));
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        private: true,
        dependencies: { ...pkg.dependencies, "@gym-coach/shared": `file:./${tarball}` },
      },
      null,
      2,
    ),
  );

  run(NPM, ["install", ...NPM_FLAGS], stage);

  fs.cpSync(path.join(SERVICE_ROOT, "dist"), path.join(stage, "dist"), { recursive: true });
  pruneTests(path.join(stage, "dist"));
  fs.cpSync(
    path.join(SERVICE_ROOT, "src/generated/prisma"),
    path.join(stage, "dist/generated/prisma"),
    { recursive: true },
  );
  // Runtime-read seed data (datasetConfig.ts resolves these relative to cwd) —
  // same reason the Dockerfile copies data/ into its runner stage.
  if (fs.existsSync(path.join(SERVICE_ROOT, "data")))
    fs.cpSync(path.join(SERVICE_ROOT, "data"), path.join(stage, "data"), { recursive: true });

  // Keep only the Lambda-target engine, plus strip type declarations and any
  // stray .tmp files a failed `prisma generate` may have left behind.
  const generated = path.join(stage, "dist/generated/prisma");
  for (const file of fs.readdirSync(generated)) {
    const isOtherEngine =
      (file.endsWith(".node") || file.endsWith(".dll.node")) &&
      !file.includes("rhel-openssl-3.0.x");
    if (isOtherEngine || file.endsWith(".d.ts") || file.includes(".tmp"))
      fs.rmSync(path.join(generated, file), { force: true });
  }

  fs.rmSync(path.join(stage, tarball), { force: true });
  fs.rmSync(path.join(stage, "package-lock.json"), { force: true });
  fs.rmSync(path.join(SHARED_ROOT, tarball), { force: true });
  return stage;
}

function stageMigratePackage(): string {
  const stage = path.join(STAGE, "migrate");
  rmrf(stage);
  fs.mkdirSync(stage, { recursive: true });

  const pkg = JSON.parse(fs.readFileSync(path.join(SERVICE_ROOT, "package.json"), "utf8"));
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify(
      {
        name: "ai-migrate-lambda",
        version: pkg.version,
        private: true,
        dependencies: {
          // prisma: the CLI + engines that `migrate deploy` spawns.
          // pg: the maintenance connection that creates fitness_assistant_ai
          //     when it does not exist yet.
          // secrets-manager: DATABASE_SECRET_ID resolution.
          prisma: pkg.devDependencies.prisma,
          pg: pkg.dependencies.pg,
          "@aws-sdk/client-secrets-manager":
            pkg.dependencies["@aws-sdk/client-secrets-manager"],
        },
      },
      null,
      2,
    ),
  );

  // PRISMA_CLI_BINARY_TARGETS makes the CLI's postinstall fetch the
  // schema-engine for the Lambda platform rather than only this build host's.
  run(NPM, ["install", "--no-audit", "--no-fund", "--legacy-peer-deps", ...CROSS_TARGET], stage, {
    PRISMA_CLI_BINARY_TARGETS: "rhel-openssl-3.0.x",
  });

  fs.mkdirSync(path.join(stage, "dist"), { recursive: true });
  fs.copyFileSync(
    path.join(SERVICE_ROOT, "dist/migrate-lambda.js"),
    path.join(stage, "dist/migrate-lambda.js"),
  );
  fs.mkdirSync(path.join(stage, "prisma"), { recursive: true });
  fs.copyFileSync(
    path.join(SERVICE_ROOT, "prisma/schema.prisma"),
    path.join(stage, "prisma/schema.prisma"),
  );
  fs.cpSync(
    path.join(SERVICE_ROOT, "prisma/migrations"),
    path.join(stage, "prisma/migrations"),
    { recursive: true },
  );

  // The engine download cache duplicates binaries already extracted next to it.
  rmrf(path.join(stage, "node_modules/@prisma/engines/node_modules/.cache"));
  rmrf(path.join(stage, "node_modules/.bin"));
  fs.rmSync(path.join(stage, "package-lock.json"), { force: true });
  fs.rmSync(path.join(stage, "node_modules/.package-lock.json"), { force: true });
  return stage;
}

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(SERVICE_ROOT, "dist/lambda.js"))) {
    throw new Error(
      "dist/lambda.js not found — run `pnpm --filter @gym-coach/ai-service build` first.",
    );
  }
  fs.mkdirSync(ARTIFACTS, { recursive: true });

  const httpStage = stageHttpPackage();
  const httpZip = path.join(ARTIFACTS, "ai-lambda.zip");
  fs.rmSync(httpZip, { force: true });
  const httpSize = await zipDir(httpStage, httpZip);

  // Same package, different Handler — see this file's header.
  const workerZip = path.join(ARTIFACTS, "ai-worker-lambda.zip");
  fs.rmSync(workerZip, { force: true });
  fs.copyFileSync(httpZip, workerZip);

  const migrateStage = stageMigratePackage();
  const migrateZip = path.join(ARTIFACTS, "ai-migrate-lambda.zip");
  fs.rmSync(migrateZip, { force: true });
  const migrateSize = await zipDir(migrateStage, migrateZip);

  rmrf(STAGE);

  console.log("\nartifacts:");
  console.log(`  ai-lambda.zip          ${httpSize} bytes   handler dist/lambda.handler`);
  console.log(`  ai-worker-lambda.zip   ${httpSize} bytes   handler dist/worker-lambda.handler`);
  console.log(`  ai-migrate-lambda.zip  ${migrateSize} bytes   handler dist/migrate-lambda.handler`);
}

void main();
