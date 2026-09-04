#!/usr/bin/env node
// Builds artifacts/auth-migrate-lambda.zip — a TEMPORARY, standalone AWS Lambda package whose
// only job is to run `prisma migrate deploy` against Aurora from inside the VPC (Aurora is
// private; there's no other network path to it from a local machine). Ready for manual upload
// via the Lambda Console. Does NOT touch AWS in any way; this only produces a local file.
//
// Usage: node backend/services/auth-service/scripts/build-lambda-migrate-artifact.js
//
// Deliberately does NOT reuse build-lambda-artifact.js's `pnpm deploy` step: the migrate
// artifact's dependency set (prisma CLI + @prisma/engines, NOT @prisma/client, NOT
// express/serverless-http/etc.) is different enough, and small enough, that a standalone
// throwaway package.json (outside the pnpm workspace, referencing @gym-coach/shared via a
// `file:` path) is simpler than threading a second dependency profile through auth-service's
// own package.json — which would also risk changing what `pnpm deploy --prod` resolves for the
// UNRELATED production auth-lambda.zip (see TASK 15: don't touch that artifact's build).
//
// What it does:
//   1. tsc build auth-service (dist/migrate-lambda.js + dist/config/lambda-runtime.js — the
//      only two compiled files this artifact actually needs; migrate-lambda.ts never imports
//      app.ts/routes/controllers, verified by grep).
//   2. Fetch the Linux schema-engine binary (schema-engine-rhel-openssl-3.0.x — the *migration*
//      engine `prisma migrate deploy` spawns as a subprocess; NOT the same file as the query
//      engine `@prisma/client` dlopens, and NOT covered by prisma/schema.prisma's own
//      `binaryTargets`, which only governs the generated client). Cross-compiled fetch via
//      PRISMA_CLI_BINARY_TARGETS, done once on this (internet-connected) dev machine — Lambda's
//      private subnet has no NAT/internet egress to fetch it at runtime.
//   3. Build a standalone throwaway package.json (prisma + @aws-sdk/client-secrets-manager +
//      @gym-coach/shared via `file:`), `pnpm install` it, flatten pnpm's isolated store into a
//      classic flat node_modules (see flattenNodeModules() below).
//   4. Prune node_modules/@prisma/engines down to its JS + package.json — its own bundled
//      engine binaries (Windows/other platforms) are dead weight once
//      PRISMA_SCHEMA_ENGINE_BINARY points the CLI at our own bundled Linux binary instead
//      (verified: the CLI's `require("@prisma/engines")` only needs that package's JS/metadata
//      at import time, not its binaries, once the env var override is set).
//   5. Copy prisma/schema.prisma + prisma/migrations/** (incl. migration_lock.toml) verbatim —
//      migration history is never regenerated or edited by this script.
//   6. Write artifacts/auth-migrate-lambda.zip by hand — same spec-correct writer as the auth
//      Lambda build (Windows Compress-Archive's backslash path separators break Amazon Linux's
//      unzip) — and this time FORCE the executable bit on the schema-engine binary regardless
//      of what Windows reports via fs.stat (Windows has no real Unix permission bits, and this
//      file — unlike the query engine .node file — is spawned via execve, not dlopen, so it
//      genuinely needs +x once unzipped on Lambda).
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const AUTH_SERVICE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(AUTH_SERVICE_DIR, "..", "..", "..");
const SHARED_DIR = path.join(REPO_ROOT, "backend", "shared");
const DIST_DIR = path.join(AUTH_SERVICE_DIR, "dist");
const ZIP_OUT = path.join(AUTH_SERVICE_DIR, "artifacts", "auth-migrate-lambda.zip");

const TMP_ROOT = path.join(os.tmpdir(), "auth-migrate-lambda-build");
const PKG_DIR = path.join(TMP_ROOT, "pkg");
const ARTIFACT_ROOT = path.join(TMP_ROOT, "root");

// Read the exact resolved prisma version so the CLI we bundle matches the generated client's
// engine hash — mismatched CLI/client versions is a common source of confusing Prisma errors.
const authPkg = JSON.parse(fs.readFileSync(path.join(AUTH_SERVICE_DIR, "package.json"), "utf8"));
const PRISMA_VERSION_RANGE = authPkg.devDependencies.prisma;
if (!PRISMA_VERSION_RANGE) throw new Error("auth-service package.json has no `prisma` devDependency to pin against");

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: cwd || REPO_ROOT, stdio: "inherit", shell: process.platform === "win32" });
}

function isRuntimeChaff(rel) {
  return (
    rel.endsWith(".d.ts") ||
    rel.endsWith(".d.ts.map") ||
    rel.endsWith(".d.cts") ||
    rel.endsWith(".d.mts") ||
    rel.endsWith(".map") ||
    /(^|[\\/])dist-types([\\/]|$)/.test(rel) ||
    /(^|[\\/])(README(\.[a-zA-Z]+)?|CHANGELOG(\.[a-zA-Z]+)?|LICENSE(\.[a-zA-Z]+)?|\.github)$/i.test(rel)
  );
}

// Same flattener as build-lambda-artifact.js — see that file's header comment for the full
// rationale (pnpm's isolated store hides a package's private transitive deps as symlink
// siblings, not descendants; naive top-level dereference silently drops them).
function flattenNodeModules(deployDir, outNodeModules) {
  const pnpmDir = path.join(deployDir, "node_modules", ".pnpm");
  fs.mkdirSync(outNodeModules, { recursive: true });
  let copied = 0;
  const conflicts = [];
  const instances = fs.readdirSync(pnpmDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  for (const inst of instances) {
    const instNodeModules = path.join(pnpmDir, inst.name, "node_modules");
    if (!fs.existsSync(instNodeModules)) continue;

    const findSelfPackages = (dir, relBase) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".bin" || entry.name === ".modules.yaml") continue;
        const full = path.join(dir, entry.name);
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        const lst = fs.lstatSync(full);
        if (lst.isSymbolicLink()) continue;
        if (entry.name.startsWith("@") && lst.isDirectory()) {
          findSelfPackages(full, rel);
          continue;
        }
        if (lst.isDirectory()) copyPackage(full, rel);
      }
    };
    const copyPackage = (srcDir, rel) => {
      const dest = path.join(outNodeModules, ...rel.split("/"));
      if (fs.existsSync(dest)) {
        let existingVersion = null, newVersion = null;
        try { existingVersion = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).version; } catch {}
        try { newVersion = JSON.parse(fs.readFileSync(path.join(srcDir, "package.json"), "utf8")).version; } catch {}
        if (existingVersion === newVersion) return;
        conflicts.push({ rel, existingVersion, newVersion, loser: inst.name });
        return;
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(srcDir, dest, {
        recursive: true,
        dereference: false,
        filter: (s) => {
          if (fs.lstatSync(s).isSymbolicLink()) return false;
          return !isRuntimeChaff(path.relative(srcDir, s));
        },
      });
      copied++;
    };
    findSelfPackages(instNodeModules, "");
  }
  console.log(`Flattened ${copied} unique packages into ${outNodeModules}`);
  if (conflicts.length) {
    console.log(`WARNING: ${conflicts.length} version conflict(s) — first-seen kept:`);
    for (const c of conflicts) console.log(`  ${c.rel}: kept ${c.existingVersion}, discarded ${c.newVersion} (from ${c.loser})`);
  }
}

// Hand-written ZIP — see build-lambda-artifact.js's makeZip() header comment for why (Windows
// Compress-Archive writes spec-violating backslash separators). `forceExecutable(rel)` lets the
// caller mark specific entries +x regardless of what Windows' fs.stat reports.
function makeZip(srcDir, outZip, forceExecutable) {
  function walk(dir, base, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel, out);
      else if (entry.isFile()) out.push({ full, rel });
    }
  }
  function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const d = (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, d };
  }

  const files = [];
  walk(srcDir, "", files);
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  const now = dosDateTime(new Date());

  for (const f of files) {
    const data = fs.readFileSync(f.full);
    const crc = zlib.crc32(data) >>> 0;
    const deflated = zlib.deflateRawSync(data, { level: zlib.constants.Z_BEST_COMPRESSION });
    const useStore = deflated.length >= data.length;
    const method = useStore ? 0 : 8;
    const payload = useStore ? data : deflated;

    const nameBuf = Buffer.from(f.rel, "utf8");
    const flags = nameBuf.length === f.rel.length ? 0x0000 : 0x0800;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.d, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, nameBuf, payload);

    const wantExec = (forceExecutable && forceExecutable(f.rel)) || !!(fs.statSync(f.full).mode & 0o111);
    const mode = wantExec ? 0o100755 : 0o100644;
    const externalAttrs = (mode << 16) >>> 0;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.d, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(externalAttrs, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);

  fs.mkdirSync(path.dirname(outZip), { recursive: true });
  fs.writeFileSync(outZip, Buffer.concat([...localChunks, centralBuf, eocd]));
  return { entries: files.length, bytes: fs.statSync(outZip).size };
}

function main() {
  console.log("== 1: tsc build auth-service ==");
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  run("pnpm", ["--filter", "@gym-coach/auth-service", "build"]);
  for (const f of ["migrate-lambda.js", "migrate-lambda.js.map", "migrate-lambda.d.ts"]) {
    if (!fs.existsSync(path.join(DIST_DIR, f)) && f === "migrate-lambda.js") {
      throw new Error("dist/migrate-lambda.js was not produced by the build — check src/migrate-lambda.ts");
    }
  }

  console.log("== 2: fetch the Linux schema-engine binary (cross-compiled fetch, this machine only) ==");
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(PKG_DIR, { recursive: true });
  execFileSync("npx", ["prisma", "generate"], {
    cwd: AUTH_SERVICE_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, PRISMA_CLI_BINARY_TARGETS: "rhel-openssl-3.0.x" },
  });

  console.log("== 3: standalone package.json + pnpm install + flatten ==");
  const sharedFileSpec = `file:${SHARED_DIR.replace(/\\/g, "/")}`;
  fs.writeFileSync(
    path.join(PKG_DIR, "package.json"),
    JSON.stringify(
      {
        name: "auth-migrate-lambda-build-tmp",
        version: "1.0.0",
        private: true,
        dependencies: {
          "@aws-sdk/client-secrets-manager": authPkg.dependencies["@aws-sdk/client-secrets-manager"],
          "@gym-coach/shared": sharedFileSpec,
          prisma: PRISMA_VERSION_RANGE.replace(/^\^|^~/, ""),
        },
      },
      null,
      2,
    ),
  );
  run("pnpm", ["install", "--no-frozen-lockfile", "--ignore-scripts"], PKG_DIR);

  fs.rmSync(ARTIFACT_ROOT, { recursive: true, force: true });
  flattenNodeModules(PKG_DIR, path.join(ARTIFACT_ROOT, "node_modules"));

  console.log("== 4: prune node_modules/@prisma/engines to JS-only (binaries overridden via env var) ==");
  const enginesPkgDir = path.join(ARTIFACT_ROOT, "node_modules", "@prisma", "engines");
  if (fs.existsSync(enginesPkgDir)) {
    for (const entry of fs.readdirSync(enginesPkgDir)) {
      const full = path.join(enginesPkgDir, entry);
      if (fs.statSync(full).isFile() && !entry.endsWith(".json") && !entry.endsWith(".md") && entry !== "LICENSE") {
        fs.rmSync(full, { force: true }); // drop bundled engine binaries for every platform
      }
    }
  }

  console.log("== 5: copy dist (migrate-lambda.js + config/ only), prisma/ (schema+migrations), engine binary ==");
  fs.mkdirSync(path.join(ARTIFACT_ROOT, "dist", "config"), { recursive: true });
  fs.copyFileSync(path.join(DIST_DIR, "migrate-lambda.js"), path.join(ARTIFACT_ROOT, "dist", "migrate-lambda.js"));
  fs.copyFileSync(path.join(DIST_DIR, "config", "lambda-runtime.js"), path.join(ARTIFACT_ROOT, "dist", "config", "lambda-runtime.js"));

  fs.mkdirSync(path.join(ARTIFACT_ROOT, "prisma"), { recursive: true });
  fs.copyFileSync(path.join(AUTH_SERVICE_DIR, "prisma", "schema.prisma"), path.join(ARTIFACT_ROOT, "prisma", "schema.prisma"));
  fs.cpSync(path.join(AUTH_SERVICE_DIR, "prisma", "migrations"), path.join(ARTIFACT_ROOT, "prisma", "migrations"), { recursive: true });

  const engineSrc = path.join(
    REPO_ROOT,
    "node_modules", ".pnpm", "@prisma+engines@" + PRISMA_VERSION_RANGE.replace(/^\^|^~/, ""),
    "node_modules", "@prisma", "engines", "schema-engine-rhel-openssl-3.0.x",
  );
  if (!fs.existsSync(engineSrc)) {
    throw new Error(
      `Linux schema-engine binary not found at ${engineSrc} — step 2's PRISMA_CLI_BINARY_TARGETS fetch did not produce it`,
    );
  }
  fs.mkdirSync(path.join(ARTIFACT_ROOT, "prisma-engines"), { recursive: true });
  fs.copyFileSync(engineSrc, path.join(ARTIFACT_ROOT, "prisma-engines", "schema-engine-rhel-openssl-3.0.x"));

  const pkg = { name: "auth-migrate-lambda", version: "1.0.0", private: true, main: "dist/migrate-lambda.js" };
  fs.writeFileSync(path.join(ARTIFACT_ROOT, "package.json"), JSON.stringify(pkg, null, 2));

  console.log("== 6: write zip ==");
  const { entries, bytes } = makeZip(ARTIFACT_ROOT, ZIP_OUT, (rel) => rel === "prisma-engines/schema-engine-rhel-openssl-3.0.x");
  console.log(`\nWrote ${ZIP_OUT}`);
  console.log(`  ${entries} entries, ${(bytes / 1024 / 1024).toFixed(2)} MB compressed`);
  console.log(`  Handler: dist/migrate-lambda.handler`);
}

main();
