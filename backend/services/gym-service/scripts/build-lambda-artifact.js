#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  copyTree,
  copyRhelQueryEngine,
  flattenNodeModules,
  makeZip,
  prunePrismaEngines,
  run,
  runOptional,
} = require("./lambda-package-lib");

const SERVICE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVICE_DIR, "..", "..", "..");
const DIST_DIR = path.join(SERVICE_DIR, "dist");
const ZIP_OUT = path.join(SERVICE_DIR, "artifacts", "gym-lambda.zip");
const TMP_ROOT = path.join(os.tmpdir(), "gym-lambda-build");
const DEPLOY_DIR = path.join(TMP_ROOT, "deploy");
const ARTIFACT_ROOT = path.join(TMP_ROOT, "root");

function main() {
  console.log("== 1: build shared ==");
  run("pnpm", ["--filter", "@gym-coach/shared", "build"], REPO_ROOT);

  console.log("== 2: generate Prisma client ==");
  runOptional("pnpm", ["--filter", "@gym-coach/gym-service", "db:generate"], REPO_ROOT);

  console.log("== 3: build gym-service ==");
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  run("pnpm", ["--filter", "@gym-coach/gym-service", "build"], REPO_ROOT);

  console.log("== 4: prepare production dependencies ==");
  fs.rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  run("pnpm", ["--filter", "@gym-coach/gym-service", "deploy", DEPLOY_DIR, "--prod"], REPO_ROOT);

  console.log("== 5: flatten node_modules ==");
  flattenNodeModules(DEPLOY_DIR, path.join(ARTIFACT_ROOT, "node_modules"));

  console.log("== 6: copy dist/generated and prune non-Lambda Prisma engines ==");
  copyTree(DIST_DIR, path.join(ARTIFACT_ROOT, "dist"));
  fs.rmSync(path.join(ARTIFACT_ROOT, "dist", "generated"), { recursive: true, force: true });
  copyTree(path.join(SERVICE_DIR, "src", "generated"), path.join(ARTIFACT_ROOT, "dist", "generated"));
  copyRhelQueryEngine(REPO_ROOT, SERVICE_DIR, ARTIFACT_ROOT);
  prunePrismaEngines(ARTIFACT_ROOT);

  console.log("== 7: write zip ==");
  const result = makeZip(ARTIFACT_ROOT, ZIP_OUT);
  console.log(`Wrote ${ZIP_OUT}`);
  console.log(`  ${result.entries} entries, ${(result.bytes / 1024 / 1024).toFixed(2)} MB compressed`);
  console.log("  Handler: dist/lambda.handler");
}

main();
