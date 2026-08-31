#!/usr/bin/env node
// Builds artifacts/user-lambda.zip — a self-contained AWS Lambda deployment package for
// user-service, ready for manual upload via the Lambda Console (Code -> Upload from -> .zip
// file). Does NOT touch AWS in any way; this only produces a local file.
//
// Direct structural port of auth-service/scripts/build-lambda-artifact.js (that service's own
// Lambda is already deployed and passing — see docs/aws-deployment/04-backend-migration-plan.md
// and docs/features/USER_SERVICE_LAMBDA_IMPACT_ANALYSIS.md). Only paths/names differ; see that
// script's own header comment for the full rationale behind each step (pnpm deploy, isolated
// .pnpm store flattening, dropping node_modules/@prisma, pruning non-Lambda Prisma engines, and
// why the zip is written by hand instead of via PowerShell Compress-Archive).
//
// Usage (from repo root or anywhere): node backend/services/user-service/scripts/build-lambda-artifact.js
//
// KNOWN WINDOWS GOTCHA: if a local `gymcoach-user-dev` Docker container is running and bind-
// mounts this directory, `prisma generate` can EPERM on the query engine .node file (file lock
// held by the container). Fix: `docker stop gymcoach-user-dev`, run this script, then
// `docker start gymcoach-user-dev`.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const USER_SERVICE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(USER_SERVICE_DIR, "..", "..", "..");
const DIST_DIR = path.join(USER_SERVICE_DIR, "dist");
const ZIP_OUT = path.join(USER_SERVICE_DIR, "artifacts", "user-lambda.zip");

// Short path — same MAX_PATH concern as auth-service's script (node_modules/@aws-sdk/*/dist-
// types/**/*.d.ts trees run deep enough to hit Windows' 260-char limit from a nested scratch dir).
const TMP_ROOT = path.join(os.tmpdir(), "user-lambda-build");
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
    rel.endsWith(".test.js") ||
    rel.endsWith(".spec.js") ||
    /(^|[\\/])dist-types([\\/]|$)/.test(rel) ||
    /(^|[\\/])(test|tests|__tests__|fixtures?)([\\/]|$)/i.test(rel) ||
    /(^|[\\/])(README(\.[a-zA-Z]+)?|CHANGELOG(\.[a-zA-Z]+)?|LICENSE(\.[a-zA-Z]+)?|\.github)$/i.test(rel)
  );
}

// pnpm's node_modules is an "isolated" store: <deploy>/node_modules/<pkg> is a symlink into
// <deploy>/node_modules/.pnpm/<id>/node_modules/<pkg>, and that package's OWN transitive deps
// live as further symlink siblings inside the SAME .pnpm/<id>/node_modules/ folder — not
// underneath <pkg> itself. Naively dereferencing only the top-level symlinks copies each
// package's own files but silently drops those private sibling deps => MODULE_NOT_FOUND at
// runtime. Fix: iterate every .pnpm/<id> instance directly and copy each one's REAL (non-
// symlink) "self" package folder into a single flat node_modules/<pkg>.
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
  console.log("== 1-3: pnpm build (shared, prisma generate, user-service) ==");
  run("pnpm", ["--filter", "@gym-coach/shared", "build"]);
  run("pnpm", ["--filter", "@gym-coach/user-service", "db:generate"]);
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  run("pnpm", ["--filter", "@gym-coach/user-service", "build"]);

  console.log("== 4: copy generated Prisma client into dist/ ==");
  fs.rmSync(path.join(DIST_DIR, "generated"), { recursive: true, force: true });
  fs.cpSync(path.join(USER_SERVICE_DIR, "src", "generated"), path.join(DIST_DIR, "generated"), { recursive: true });

  console.log("== 5: pnpm deploy (resolve workspace + prod deps) ==");
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  run("pnpm", ["--filter", "@gym-coach/user-service", "deploy", DEPLOY_DIR, "--prod"]);

  console.log("== 6: flatten node_modules ==");
  fs.rmSync(ARTIFACT_ROOT, { recursive: true, force: true });
  flattenNodeModules(DEPLOY_DIR, path.join(ARTIFACT_ROOT, "node_modules"));

  // HISTORY — this originally assumed (copied verbatim from auth-service's script) that
  // node_modules/@prisma is entirely unused, because auth-service's generated client is fully
  // self-contained. That was WRONG for user-service: pt_service_package.service.ts and
  // pt_service_package.repository.ts used to `import { Decimal } from
  // "@prisma/client/runtime/library"` directly — dropping the whole @prisma scope shipped a
  // broken artifact (MODULE_NOT_FOUND on Amazon Linux; passed locally the first time only
  // because the repo's own node_modules was still reachable during that test). Root-caused and
  // fixed at the SOURCE instead: both files now import `Prisma` from `../generated/prisma` and
  // use `Prisma.Decimal` (re-exported by the generated client's own self-contained runtime —
  // verified: `Prisma.Decimal = Decimal` in generated/prisma/index.js, sourced from
  // generated/prisma/runtime/library.js, not the npm package). Production source no longer
  // imports "@prisma/client" anywhere (grep-verified). @prisma/client itself is still kept in
  // the artifact below purely as a defensive safety net — its own runtime/library.js has zero
  // `require("@prisma/...")` calls, so keeping it costs ~8MB and drags nothing else in; only the
  // genuinely bulky, unreachable-either-way packages (@prisma/engines ~72MB, @prisma/fetch-
  // engine, @prisma/get-platform — CLI-only tooling) are dropped.
  console.log("== 7: drop unused @prisma/engines + @prisma/fetch-engine + @prisma/get-platform (source no longer imports @prisma/client at all; kept as a defensive no-cost safety net) ==");
  for (const pkg of ["engines", "fetch-engine", "get-platform"]) {
    fs.rmSync(path.join(ARTIFACT_ROOT, "node_modules", "@prisma", pkg), { recursive: true, force: true });
  }

  console.log("== 8: copy dist (minus tests/sourcemaps), prune non-Lambda Prisma engines ==");
  fs.cpSync(DIST_DIR, path.join(ARTIFACT_ROOT, "dist"), {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(DIST_DIR, src);
      if (rel === "__tests__" || rel.startsWith("__tests__" + path.sep)) return false;
      if (rel === "scripts" || rel.startsWith("scripts" + path.sep)) return false;
      if (src.endsWith(".js.map")) return false;
      return true;
    },
  });
  // "debian-openssl-3.0.x" is not one of this schema's declared binaryTargets (native /
  // linux-musl-openssl-3.0.x / rhel-openssl-3.0.x) but was already present as a stale,
  // previously-committed engine file in src/generated/prisma/ before this pass (leftover from
  // an earlier `native` resolution on a different host) — pruned too, since Lambda only ever
  // loads rhel-openssl-3.0.x and this is 16MB of genuine dead weight otherwise.
  for (const engine of [
    "query_engine-windows.dll.node",
    "libquery_engine-linux-musl-openssl-3.0.x.so.node",
    "libquery_engine-debian-openssl-3.0.x.so.node",
  ]) {
    fs.rmSync(path.join(ARTIFACT_ROOT, "dist", "generated", "prisma", engine), { force: true });
  }

  console.log("== 9: drop dev-only python OCR prototype (never invoked by the Node runtime — see impact analysis) ==");
  // inbody_extractor/ is a standalone Python CLI, not imported/spawned by any TypeScript source
  // (grep-verified during audit) — dead weight in a Node Lambda artifact either way, and pnpm
  // deploy never copies it into DEPLOY_DIR in the first place since it isn't part of the
  // package's `files`/dependency graph, so there is nothing to explicitly remove here — this
  // step is documentation of that fact, not an active prune.

  const pkg = JSON.parse(fs.readFileSync(path.join(USER_SERVICE_DIR, "package.json"), "utf8"));
  fs.writeFileSync(
    path.join(ARTIFACT_ROOT, "package.json"),
    JSON.stringify({ name: pkg.name, version: pkg.version, private: true, main: "dist/lambda.js" }, null, 2),
  );

  console.log("== 10: write zip ==");
  const { entries, bytes } = makeZip(ARTIFACT_ROOT, ZIP_OUT);
  console.log(`\nWrote ${ZIP_OUT}`);
  console.log(`  ${entries} entries, ${(bytes / 1024 / 1024).toFixed(2)} MB compressed`);
  console.log(`  Handler: dist/lambda.handler`);
}

main();
