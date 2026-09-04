#!/usr/bin/env node
// Builds artifacts/auth-lambda.zip — a self-contained AWS Lambda deployment package for
// auth-service, ready for manual upload via the Lambda Console (Code -> Upload from -> .zip
// file). Does NOT touch AWS in any way; this only produces a local file.
//
// Usage (from repo root or anywhere): node backend/services/auth-service/scripts/build-lambda-artifact.js
//
// What it does, in order:
//   1. pnpm build the @gym-coach/shared workspace package (auth-service imports it).
//   2. pnpm prisma generate (regenerates src/generated/prisma — see the EPERM note below).
//   3. pnpm build auth-service itself (tsc -> dist/).
//   4. Copy the generated Prisma client into dist/generated (tsc never touches pre-generated
//      .js/.node files, so this step is not implicit in step 3 — see prisma/schema.prisma's
//      `output` path and Dockerfile's equivalent `cp -R` step).
//   5. `pnpm --filter @gym-coach/auth-service deploy <tmp> --prod` to resolve the workspace
//      dependency (@gym-coach/shared, a `workspace:*` reference) and production deps into one
//      place.
//   6. Flatten pnpm's isolated `.pnpm` store into a classic flat node_modules (see
//      flattenNodeModules() below for why naive symlink-dereferencing silently drops
//      transitive deps like @aws-sdk/core).
//   7. Drop node_modules/@prisma/* (~90MB: engines/fetch-engine/get-platform/client) — dead
//      weight for this deployment, since the schema's custom `output` path makes the generated
//      client fully self-contained (verified: dist/generated/prisma/index.js only ever
//      `require`s "./runtime/library.js", never "@prisma/client" or any @prisma/* subpackage).
//   8. Keep only the Lambda-relevant Prisma query engine binary
//      (libquery_engine-rhel-openssl-3.0.x.so.node — Amazon Linux 2023 / Node 22.x / x86_64,
//      glibc + OpenSSL 3), dropping the Windows .dll.node and musl (Alpine) engines that are
//      only needed for local/Docker-dev.
//   9. Write artifacts/auth-lambda.zip by hand (see makeZip() — Windows PowerShell's
//      Compress-Archive writes backslash path separators in zip entries, which violates the
//      ZIP spec and Amazon Linux's unzip does not treat as a directory separator).
//
// KNOWN WINDOWS GOTCHA: if a local `gymcoach-auth-dev` Docker container is running and bind-
// mounts this directory, `prisma generate` can EPERM on the query engine .node file (file lock
// held by the container). Fix: `docker stop gymcoach-auth-dev`, run this script, then
// `docker start gymcoach-auth-dev`.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const AUTH_SERVICE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(AUTH_SERVICE_DIR, "..", "..", "..");
const DIST_DIR = path.join(AUTH_SERVICE_DIR, "dist");
const ZIP_OUT = path.join(REPO_ROOT, "artifacts", "auth-lambda.zip");

// Short path — Windows PowerShell/.NET zip and some npm tooling aren't long-path-safe, and
// node_modules/@aws-sdk/*/dist-types/**/*.d.ts trees run deep enough to hit MAX_PATH (260
// chars) from a nested scratch directory.
const TMP_ROOT = path.join(os.tmpdir(), "auth-lambda-build");
const DEPLOY_DIR = path.join(TMP_ROOT, "deploy");
const ARTIFACT_ROOT = path.join(TMP_ROOT, "root");

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

// pnpm's node_modules is an "isolated" store: <deploy>/node_modules/<pkg> is a symlink into
// <deploy>/node_modules/.pnpm/<id>/node_modules/<pkg>, and that package's OWN transitive deps
// live as further symlink siblings inside the SAME .pnpm/<id>/node_modules/ folder (pnpm's
// private per-package resolution scope) — not underneath <pkg> itself. Naively dereferencing
// only the top-level symlinks copies each package's own files but silently drops those private
// sibling deps (e.g. @aws-sdk/client-secrets-manager needs @aws-sdk/core this way) =>
// MODULE_NOT_FOUND at runtime. Fix: iterate every .pnpm/<id> instance directly and copy each
// one's REAL (non-symlink) "self" package folder into a single flat node_modules/<pkg>. Every
// unique package version in the store gets exactly one instance directory, so this naturally
// hoists the whole graph flat — the classic npm/yarn-v1 shape, which plain Node resolution
// (walk up through ancestor node_modules dirs) already knows how to satisfy without symlinks.
function flattenNodeModules(deployDir, outNodeModules) {
  const pnpmDir = path.join(deployDir, "node_modules", ".pnpm");
  fs.mkdirSync(outNodeModules, { recursive: true });

  let copied = 0;
  let skippedIdenticalDuplicates = 0;
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
        if (lst.isSymbolicLink()) continue; // resolved when we reach ITS OWN instance
        if (entry.name.startsWith("@") && lst.isDirectory()) {
          findSelfPackages(full, rel); // scoped namespace folder — recurse to find the real pkg
          continue;
        }
        if (lst.isDirectory()) copyPackage(full, rel);
      }
    };

    const copyPackage = (srcDir, rel) => {
      const dest = path.join(outNodeModules, ...rel.split("/"));
      if (fs.existsSync(dest)) {
        let existingVersion = null;
        let newVersion = null;
        try {
          existingVersion = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8")).version;
        } catch {}
        try {
          newVersion = JSON.parse(fs.readFileSync(path.join(srcDir, "package.json"), "utf8")).version;
        } catch {}
        if (existingVersion === newVersion) {
          skippedIdenticalDuplicates++;
          return;
        }
        conflicts.push({ rel, existingVersion, newVersion, loser: inst.name });
        return; // keep the first-seen version
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(srcDir, dest, {
        recursive: true,
        dereference: false,
        filter: (s) => {
          if (fs.lstatSync(s).isSymbolicLink()) return false;
          const r = path.relative(srcDir, s);
          return !isRuntimeChaff(r);
        },
      });
      copied++;
    };

    findSelfPackages(instNodeModules, "");
  }

  console.log(`Flattened ${copied} unique packages into ${outNodeModules}`);
  console.log(`Skipped ${skippedIdenticalDuplicates} identical duplicate hoists`);
  if (conflicts.length) {
    console.log(`WARNING: ${conflicts.length} version conflict(s) — first-seen kept, review manually:`);
    for (const c of conflicts) {
      console.log(`  ${c.rel}: kept ${c.existingVersion}, discarded ${c.newVersion} (from ${c.loser})`);
    }
  }
}

// Minimal, spec-correct ZIP writer. Windows PowerShell's Compress-Archive writes entry names
// with backslash separators ("dist\lambda.js"), which violates the ZIP spec (APPNOTE.TXT
// mandates '/') — Amazon Linux's unzip does not treat '\' as a path separator, so Lambda would
// unpack one flat garbage-named file instead of a dist/ tree. Writing the archive by hand
// avoids that, and lets us set real Unix file-mode bits (0644/0755) in external attributes.
function makeZip(srcDir, outZip) {
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

    const mode = fs.statSync(f.full).mode & 0o111 ? 0o100755 : 0o100644;
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
  console.log("== 1-3: pnpm build (shared, prisma generate, auth-service) ==");
  run("pnpm", ["--filter", "@gym-coach/shared", "build"]);
  run("pnpm", ["--filter", "@gym-coach/auth-service", "db:generate"]);
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  run("pnpm", ["--filter", "@gym-coach/auth-service", "build"]);

  console.log("== 4: copy generated Prisma client into dist/ ==");
  fs.rmSync(path.join(DIST_DIR, "generated"), { recursive: true, force: true });
  fs.cpSync(path.join(AUTH_SERVICE_DIR, "src", "generated"), path.join(DIST_DIR, "generated"), { recursive: true });

  console.log("== 5: pnpm deploy (resolve workspace + prod deps) ==");
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  run("pnpm", ["--filter", "@gym-coach/auth-service", "deploy", DEPLOY_DIR, "--prod"]);

  console.log("== 6: flatten node_modules ==");
  fs.rmSync(ARTIFACT_ROOT, { recursive: true, force: true });
  flattenNodeModules(DEPLOY_DIR, path.join(ARTIFACT_ROOT, "node_modules"));

  console.log("== 7: drop node_modules/@prisma (unused by the self-contained generated client) ==");
  fs.rmSync(path.join(ARTIFACT_ROOT, "node_modules", "@prisma"), { recursive: true, force: true });

  console.log("== 8: copy dist (minus tests/sourcemaps), prune non-Lambda Prisma engines ==");
  fs.cpSync(DIST_DIR, path.join(ARTIFACT_ROOT, "dist"), {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(DIST_DIR, src);
      if (rel === "__tests__" || rel.startsWith("__tests__" + path.sep)) return false;
      if (src.endsWith(".js.map")) return false;
      return true;
    },
  });
  for (const engine of ["query_engine-windows.dll.node", "libquery_engine-linux-musl-openssl-3.0.x.so.node"]) {
    fs.rmSync(path.join(ARTIFACT_ROOT, "dist", "generated", "prisma", engine), { force: true });
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(AUTH_SERVICE_DIR, "package.json"), "utf8"));
  fs.writeFileSync(
    path.join(ARTIFACT_ROOT, "package.json"),
    JSON.stringify({ name: pkg.name, version: pkg.version, private: true, main: "dist/lambda.js" }, null, 2),
  );

  console.log("== 9: write zip ==");
  const { entries, bytes } = makeZip(ARTIFACT_ROOT, ZIP_OUT);
  console.log(`\nWrote ${ZIP_OUT}`);
  console.log(`  ${entries} entries, ${(bytes / 1024 / 1024).toFixed(2)} MB compressed`);
  console.log(`  Handler: dist/lambda.handler`);
}

main();
