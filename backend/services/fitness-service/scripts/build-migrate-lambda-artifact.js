#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const SERVICE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVICE_DIR, "..", "..", "..");
const DIST_DIR = path.join(SERVICE_DIR, "dist");
const ZIP_OUT = path.join(SERVICE_DIR, "artifacts", "fitness-migrate-lambda.zip");
const TMP_ROOT = path.join(os.tmpdir(), "fitness-migrate-lambda-build");
const DEPLOY_DIR = path.join(TMP_ROOT, "deploy");
const ARTIFACT_ROOT = path.join(TMP_ROOT, "root");

function run(cmd, args, cwd = REPO_ROOT) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function isChaff(rel) {
  return (
    rel.endsWith(".d.ts") ||
    rel.endsWith(".d.ts.map") ||
    rel.endsWith(".map") ||
    rel.endsWith(".test.js") ||
    rel.endsWith(".spec.js") ||
    /(^|[\\/])dist-types([\\/]|$)/.test(rel) ||
    /(^|[\\/])(test|tests|__tests__|fixtures?)([\\/]|$)/i.test(rel) ||
    /(^|[\\/])(README(\.[a-zA-Z]+)?|CHANGELOG(\.[a-zA-Z]+)?|LICENSE(\.[a-zA-Z]+)?|\.github)$/i.test(rel)
  );
}

function copyTree(srcDir, destDir, options = {}) {
  fs.mkdirSync(path.dirname(destDir), { recursive: true });
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      if (fs.lstatSync(src).isSymbolicLink()) return false;
      const rel = path.relative(srcDir, src);
      if (!rel) return true;
      return options.keepAll || !isChaff(rel);
    },
  });
}

function flattenNodeModules(deployDir, outNodeModules) {
  const pnpmDir = path.join(deployDir, "node_modules", ".pnpm");
  fs.mkdirSync(outNodeModules, { recursive: true });
  let copied = 0;
  const conflicts = [];

  for (const inst of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!inst.isDirectory()) continue;
    const instNodeModules = path.join(pnpmDir, inst.name, "node_modules");
    if (!fs.existsSync(instNodeModules)) continue;

    const scan = (dir, relBase = "") => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".bin" || entry.name === ".modules.yaml") continue;
        const full = path.join(dir, entry.name);
        const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
        const stat = fs.lstatSync(full);
        if (stat.isSymbolicLink()) continue;
        if (entry.name.startsWith("@") && stat.isDirectory()) {
          scan(full, rel);
          continue;
        }
        if (!stat.isDirectory()) continue;
        const dest = path.join(outNodeModules, ...rel.split("/"));
        if (fs.existsSync(dest)) {
          let existingVersion = "";
          let newVersion = "";
          try {
            existingVersion = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).version;
            newVersion = JSON.parse(fs.readFileSync(path.join(full, "package.json"), "utf8")).version;
          } catch {}
          if (existingVersion !== newVersion) conflicts.push(`${rel}: kept ${existingVersion}, discarded ${newVersion}`);
          continue;
        }
        copyTree(full, dest);
        copied++;
      }
    };

    scan(instNodeModules);
  }

  console.log(`Flattened ${copied} unique production packages into ${outNodeModules}`);
  if (conflicts.length) {
    console.log(`WARNING: ${conflicts.length} version conflict(s) — first-seen kept:`);
    for (const c of conflicts.slice(0, 20)) console.log(`  ${c}`);
  }
}

function copyRootPackage(packageName, destRel) {
  const packagePath = resolveWorkspacePackageJson(packageName);
  const sourceDir = fs.realpathSync(path.dirname(packagePath));
  const destDir = path.join(ARTIFACT_ROOT, "node_modules", ...destRel.split("/"));
  fs.rmSync(destDir, { recursive: true, force: true });
  copyTree(sourceDir, destDir);
}

function resolveWorkspacePackageJson(packageName) {
  try {
    return require.resolve(`${packageName}/package.json`, { paths: [REPO_ROOT, SERVICE_DIR] });
  } catch {
    const pnpmDir = path.join(REPO_ROOT, "node_modules", ".pnpm");
    const encoded = packageName.replace("/", "+");
    const candidates = fs
      .readdirSync(pnpmDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${encoded}@`))
      .map((entry) => path.join(pnpmDir, entry.name, "node_modules", ...packageName.split("/"), "package.json"))
      .filter((candidate) => fs.existsSync(candidate))
      .sort();

    if (candidates.length === 0) {
      throw new Error(`Could not resolve workspace package ${packageName}`);
    }

    return candidates[candidates.length - 1];
  }
}

function copyPrismaCliAndEngines() {
  copyRootPackage("prisma", "prisma");
  copyRootPackage("@prisma/engines", "@prisma/engines");
  copyRootPackage("@prisma/engines-version", "@prisma/engines-version");
  copyRootPackage("@prisma/debug", "@prisma/debug");
  copyRootPackage("@prisma/fetch-engine", "@prisma/fetch-engine");
  copyRootPackage("@prisma/get-platform", "@prisma/get-platform");

  const enginesDir = path.join(ARTIFACT_ROOT, "node_modules", "@prisma", "engines");
  for (const entry of fs.readdirSync(enginesDir)) {
    const full = path.join(enginesDir, entry);
    if (!fs.statSync(full).isFile()) continue;
    if (
      /^(schema-engine|libquery_engine|query_engine)/.test(entry) &&
      !entry.includes("rhel-openssl-3.0.x")
    ) {
      fs.rmSync(full, { force: true });
    }
  }
}

function copyPrismaSchemaAndMigrations() {
  const prismaOut = path.join(ARTIFACT_ROOT, "prisma");
  fs.mkdirSync(prismaOut, { recursive: true });
  fs.copyFileSync(path.join(SERVICE_DIR, "prisma", "schema.prisma"), path.join(prismaOut, "schema.prisma"));
  copyTree(path.join(SERVICE_DIR, "prisma", "migrations"), path.join(prismaOut, "migrations"), { keepAll: true });
}

function isExecutableRel(rel) {
  return (
    /(^|\/)node_modules\/\.bin\//.test(rel) ||
    /(^|\/)schema-engine-rhel-openssl-3\.0\.x$/.test(rel) ||
    /(^|\/)query-engine-rhel-openssl-3\.0\.x$/.test(rel) ||
    /(^|\/)prisma\/build\/index\.js$/.test(rel)
  );
}

function makeZip(srcDir, outZip) {
  const files = [];
  const walk = (dir, base = "") => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) files.push({ full, rel: rel.replace(/\\/g, "/") });
    }
  };
  const dos = (date) => ({
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  });

  walk(srcDir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  const now = dos(new Date());
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const f of files) {
    const data = fs.readFileSync(f.full);
    const crc = zlib.crc32(data) >>> 0;
    const deflated = zlib.deflateRawSync(data, { level: zlib.constants.Z_BEST_COMPRESSION });
    const stored = deflated.length >= data.length;
    const payload = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const name = Buffer.from(f.rel, "utf8");
    const flags = name.length === f.rel.length ? 0 : 0x0800;
    const fileMode = isExecutableRel(f.rel) ? 0o100755 : 0o100644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(now.time, 10);
    local.writeUInt16LE(now.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(now.time, 12);
    central.writeUInt16LE(now.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((fileMode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += local.length + name.length + payload.length;
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
  console.log("== 1: build shared ==");
  run("pnpm", ["--filter", "@gym-coach/shared", "build"]);

  console.log("== 2: generate Prisma client ==");
  run("pnpm", ["--filter", "@gym-coach/fitness-service", "db:generate"]);

  console.log("== 3: build fitness-service ==");
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  run("pnpm", ["--filter", "@gym-coach/fitness-service", "build"]);

  console.log("== 4: prepare artifact root ==");
  fs.rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });

  console.log("== 5: pnpm deploy production dependencies ==");
  run("pnpm", ["--filter", "@gym-coach/fitness-service", "deploy", DEPLOY_DIR, "--prod"]);

  console.log("== 6: flatten production node_modules ==");
  flattenNodeModules(DEPLOY_DIR, path.join(ARTIFACT_ROOT, "node_modules"));

  console.log("== 7: add Prisma CLI and Linux migration engines ==");
  copyPrismaCliAndEngines();

  console.log("== 8: copy compiled migration handler ==");
  fs.mkdirSync(path.join(ARTIFACT_ROOT, "dist"), { recursive: true });
  fs.copyFileSync(path.join(DIST_DIR, "migrate-lambda.js"), path.join(ARTIFACT_ROOT, "dist", "migrate-lambda.js"));

  console.log("== 9: copy Prisma schema and migrations ==");
  copyPrismaSchemaAndMigrations();

  console.log("== 10: write zip ==");
  const result = makeZip(ARTIFACT_ROOT, ZIP_OUT);
  console.log(`Wrote ${ZIP_OUT}`);
  console.log(`  ${result.entries} entries, ${(result.bytes / 1024 / 1024).toFixed(2)} MB compressed`);
  console.log("  Handler: dist/migrate-lambda.handler");
}

main();
