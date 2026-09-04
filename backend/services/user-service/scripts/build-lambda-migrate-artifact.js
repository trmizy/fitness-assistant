#!/usr/bin/env node
// Builds artifacts/user-migrate-lambda.zip — a temporary, standalone Lambda package whose only
// job is to run `prisma migrate deploy` for User Service against the logical PostgreSQL database
// `fitness_assistant_user`. This script never contacts AWS and never runs migrations.
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const USER_SERVICE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(USER_SERVICE_DIR, "..", "..", "..");
const SHARED_DIR = path.join(REPO_ROOT, "backend", "shared");
const DIST_DIR = path.join(USER_SERVICE_DIR, "dist");
const ZIP_OUT = path.join(USER_SERVICE_DIR, "artifacts", "user-migrate-lambda.zip");

const TMP_ROOT = path.join(os.tmpdir(), "user-migrate-lambda-build");
const PKG_DIR = path.join(TMP_ROOT, "pkg");
const ARTIFACT_ROOT = path.join(TMP_ROOT, "root");
const LINUX_SCHEMA_ENGINE = "schema-engine-rhel-openssl-3.0.x";

const userPkg = JSON.parse(fs.readFileSync(path.join(USER_SERVICE_DIR, "package.json"), "utf8"));
const PRISMA_VERSION_RANGE = userPkg.devDependencies && userPkg.devDependencies.prisma;
if (!PRISMA_VERSION_RANGE) {
  throw new Error("user-service package.json has no `prisma` devDependency to pin against");
}
const PRISMA_VERSION = PRISMA_VERSION_RANGE.replace(/^\^|^~/, "");

function run(cmd, args, cwd, extraEnv) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd: cwd || REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...(extraEnv || {}) },
  });
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

function flattenNodeModules(deployDir, outNodeModules) {
  const pnpmDir = path.join(deployDir, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) throw new Error(`pnpm store not found: ${pnpmDir}`);
  fs.mkdirSync(outNodeModules, { recursive: true });

  let copied = 0;
  let skippedIdenticalDuplicates = 0;
  const conflicts = [];
  const instances = fs.readdirSync(pnpmDir, { withFileTypes: true }).filter((d) => d.isDirectory());

  function copyPackage(srcDir, rel, instanceName) {
    const dest = path.join(outNodeModules, ...rel.split("/"));
    if (fs.existsSync(dest)) {
      let existingVersion = null;
      let newVersion = null;
      try { existingVersion = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).version; } catch {}
      try { newVersion = JSON.parse(fs.readFileSync(path.join(srcDir, "package.json"), "utf8")).version; } catch {}
      if (existingVersion === newVersion) {
        skippedIdenticalDuplicates++;
        return;
      }
      conflicts.push({ rel, existingVersion, newVersion, loser: instanceName });
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
  }

  function findSelfPackages(dir, relBase, instanceName) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".bin" || entry.name === ".modules.yaml") continue;
      const full = path.join(dir, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      const lst = fs.lstatSync(full);
      if (lst.isSymbolicLink()) continue;
      if (entry.name.startsWith("@") && lst.isDirectory()) {
        findSelfPackages(full, rel, instanceName);
        continue;
      }
      if (lst.isDirectory()) copyPackage(full, rel, instanceName);
    }
  }

  for (const inst of instances) {
    const instNodeModules = path.join(pnpmDir, inst.name, "node_modules");
    if (fs.existsSync(instNodeModules)) findSelfPackages(instNodeModules, "", inst.name);
  }

  console.log(`Flattened ${copied} unique packages into ${outNodeModules}`);
  console.log(`Skipped ${skippedIdenticalDuplicates} identical duplicate hoists`);
  if (conflicts.length) {
    console.log(`WARNING: ${conflicts.length} version conflict(s) — first-seen kept:`);
    for (const c of conflicts) {
      console.log(`  ${c.rel}: kept ${c.existingVersion}, discarded ${c.newVersion} (from ${c.loser})`);
    }
  }
}

function directorySizeBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySizeBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

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
  console.log("== 1: build shared + user-service ==");
  run("pnpm", ["--filter", "@gym-coach/shared", "build"]);
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  run("pnpm", ["--filter", "@gym-coach/user-service", "build"]);
  if (!fs.existsSync(path.join(DIST_DIR, "migrate-lambda.js"))) {
    throw new Error("dist/migrate-lambda.js was not produced by TypeScript build");
  }

  console.log("== 2: fetch Linux Prisma schema-engine binary ==");
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(PKG_DIR, { recursive: true });
  run("npx", ["prisma", "generate"], USER_SERVICE_DIR, { PRISMA_CLI_BINARY_TARGETS: "rhel-openssl-3.0.x" });

  console.log("== 3: standalone dependency install + flatten ==");
  const sharedFileSpec = `file:${SHARED_DIR.replace(/\\/g, "/")}`;
  fs.writeFileSync(
    path.join(PKG_DIR, "package.json"),
    JSON.stringify(
      {
        name: "user-migrate-lambda-build-tmp",
        version: "1.0.0",
        private: true,
        dependencies: {
          "@aws-sdk/client-secrets-manager": userPkg.dependencies["@aws-sdk/client-secrets-manager"],
          "@gym-coach/shared": sharedFileSpec,
          prisma: PRISMA_VERSION,
        },
      },
      null,
      2,
    ),
  );
  run("pnpm", ["install", "--no-frozen-lockfile", "--ignore-scripts"], PKG_DIR);

  fs.rmSync(ARTIFACT_ROOT, { recursive: true, force: true });
  flattenNodeModules(PKG_DIR, path.join(ARTIFACT_ROOT, "node_modules"));

  console.log("== 4: prune node_modules/@prisma/engines bundled binaries ==");
  const enginesPkgDir = path.join(ARTIFACT_ROOT, "node_modules", "@prisma", "engines");
  if (fs.existsSync(enginesPkgDir)) {
    for (const entry of fs.readdirSync(enginesPkgDir)) {
      const full = path.join(enginesPkgDir, entry);
      if (fs.statSync(full).isFile() && !entry.endsWith(".json") && !entry.endsWith(".md") && entry !== "LICENSE") {
        fs.rmSync(full, { force: true });
      }
    }
  }

  console.log("== 5: copy handler, schema, migrations, Linux schema-engine ==");
  fs.mkdirSync(path.join(ARTIFACT_ROOT, "dist"), { recursive: true });
  fs.copyFileSync(path.join(DIST_DIR, "migrate-lambda.js"), path.join(ARTIFACT_ROOT, "dist", "migrate-lambda.js"));

  fs.mkdirSync(path.join(ARTIFACT_ROOT, "prisma"), { recursive: true });
  fs.copyFileSync(path.join(USER_SERVICE_DIR, "prisma", "schema.prisma"), path.join(ARTIFACT_ROOT, "prisma", "schema.prisma"));
  fs.cpSync(path.join(USER_SERVICE_DIR, "prisma", "migrations"), path.join(ARTIFACT_ROOT, "prisma", "migrations"), { recursive: true });

  const engineSrc = path.join(
    REPO_ROOT,
    "node_modules",
    ".pnpm",
    `@prisma+engines@${PRISMA_VERSION}`,
    "node_modules",
    "@prisma",
    "engines",
    LINUX_SCHEMA_ENGINE,
  );
  if (!fs.existsSync(engineSrc)) {
    throw new Error(`Linux schema-engine binary not found at ${engineSrc}`);
  }
  fs.mkdirSync(path.join(ARTIFACT_ROOT, "prisma-engines"), { recursive: true });
  fs.copyFileSync(engineSrc, path.join(ARTIFACT_ROOT, "prisma-engines", LINUX_SCHEMA_ENGINE));

  fs.writeFileSync(
    path.join(ARTIFACT_ROOT, "package.json"),
    JSON.stringify({ name: "user-migrate-lambda", version: "1.0.0", private: true, main: "dist/migrate-lambda.js" }, null, 2),
  );

  console.log("== 6: write zip ==");
  const uncompressedBytes = directorySizeBytes(ARTIFACT_ROOT);
  const { entries, bytes } = makeZip(
    ARTIFACT_ROOT,
    ZIP_OUT,
    (rel) => rel === `prisma-engines/${LINUX_SCHEMA_ENGINE}`,
  );

  console.log(`\nWrote ${ZIP_OUT}`);
  console.log(`  ${entries} entries`);
  console.log(`  ${(bytes / 1024 / 1024).toFixed(2)} MB compressed`);
  console.log(`  ${(uncompressedBytes / 1024 / 1024).toFixed(2)} MB uncompressed`);
  console.log("  Handler: dist/migrate-lambda.handler");
}

main();
