#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function runOptional(cmd, args, cwd) {
  try {
    run(cmd, args, cwd);
    return true;
  } catch (error) {
    console.log(`WARNING: optional command failed and artifact build will continue: ${cmd} ${args.join(" ")}`);
    console.log(`WARNING: ${error.message}`);
    return false;
  }
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

  console.log(`Flattened ${copied} unique packages into ${outNodeModules}`);
  if (conflicts.length) {
    console.log(`WARNING: ${conflicts.length} version conflict(s) — first-seen kept:`);
    for (const c of conflicts.slice(0, 20)) console.log(`  ${c}`);
  }
}

function resolveWorkspacePackageJson(packageName, repoRoot, serviceDir) {
  try {
    return require.resolve(`${packageName}/package.json`, { paths: [repoRoot, serviceDir] });
  } catch {
    const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
    const encoded = packageName.replace("/", "+");
    const candidates = fs
      .readdirSync(pnpmDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${encoded}@`))
      .map((entry) => path.join(pnpmDir, entry.name, "node_modules", ...packageName.split("/"), "package.json"))
      .filter((candidate) => fs.existsSync(candidate))
      .sort();

    if (candidates.length === 0) throw new Error(`Could not resolve workspace package ${packageName}`);
    return candidates[candidates.length - 1];
  }
}

function copyRootPackage(packageName, destRel, repoRoot, serviceDir, artifactRoot) {
  const packagePath = resolveWorkspacePackageJson(packageName, repoRoot, serviceDir);
  const sourceDir = fs.realpathSync(path.dirname(packagePath));
  const destDir = path.join(artifactRoot, "node_modules", ...destRel.split("/"));
  fs.rmSync(destDir, { recursive: true, force: true });
  copyTree(sourceDir, destDir);
}

function prunePrismaEngines(rootDir) {
  for (const dir of [
    path.join(rootDir, "dist", "generated", "prisma"),
    path.join(rootDir, "node_modules", ".prisma", "client"),
    path.join(rootDir, "node_modules", "@prisma", "engines"),
  ]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (/^(libquery_engine|query_engine|schema-engine|schema-engine-)/.test(entry) && !entry.includes("rhel-openssl-3.0.x")) {
        fs.rmSync(path.join(dir, entry), { force: true });
      }
    }
  }
}

function copyRhelQueryEngine(repoRoot, serviceDir, artifactRoot) {
  const candidates = [
    path.join(serviceDir, "node_modules", "prisma", "libquery_engine-rhel-openssl-3.0.x.so.node"),
    path.join(repoRoot, "node_modules", ".pnpm", "prisma@5.22.0", "node_modules", "prisma", "libquery_engine-rhel-openssl-3.0.x.so.node"),
    path.join(repoRoot, "node_modules", ".pnpm", "@prisma+engines@5.22.0", "node_modules", "@prisma", "engines", "libquery_engine-rhel-openssl-3.0.x.so.node"),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error("Could not find libquery_engine-rhel-openssl-3.0.x.so.node for Lambda artifact");
  }
  const destinations = [
    path.join(artifactRoot, "dist", "generated", "prisma", "libquery_engine-rhel-openssl-3.0.x.so.node"),
    path.join(artifactRoot, "node_modules", ".prisma", "client", "libquery_engine-rhel-openssl-3.0.x.so.node"),
  ];
  for (const dest of destinations) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
  }
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
    const executable = /(^|\/)(schema-engine-rhel-openssl-3\.0\.x|query-engine-rhel-openssl-3\.0\.x)$/.test(f.rel);
    const fileMode = executable ? 0o100755 : 0o100644;

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

module.exports = {
  copyRootPackage,
  copyRhelQueryEngine,
  copyTree,
  flattenNodeModules,
  makeZip,
  prunePrismaEngines,
  run,
  runOptional,
};
