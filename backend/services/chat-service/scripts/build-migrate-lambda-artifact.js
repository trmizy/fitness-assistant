#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  copyRootPackage,
  copyTree,
  flattenNodeModules,
  makeZip,
  prunePrismaEngines,
  run,
  runOptional,
} = require("../../gym-service/scripts/lambda-package-lib");

const SERVICE_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SERVICE_DIR, "..", "..", "..");
const DIST_DIR = path.join(SERVICE_DIR, "dist");
const ZIP_OUT = path.join(SERVICE_DIR, "artifacts", "chat-migrate-lambda.zip");
const TMP_ROOT = path.join(os.tmpdir(), "chat-migrate-lambda-build");
const DEPLOY_DIR = path.join(TMP_ROOT, "deploy");
const ARTIFACT_ROOT = path.join(TMP_ROOT, "root");

function copyPrismaCliAndEngines() {
  copyRootPackage("prisma", "prisma", REPO_ROOT, SERVICE_DIR, ARTIFACT_ROOT);
  copyRootPackage("@prisma/engines", "@prisma/engines", REPO_ROOT, SERVICE_DIR, ARTIFACT_ROOT);
  copyRootPackage("@prisma/engines-version", "@prisma/engines-version", REPO_ROOT, SERVICE_DIR, ARTIFACT_ROOT);
  copyRootPackage("@prisma/debug", "@prisma/debug", REPO_ROOT, SERVICE_DIR, ARTIFACT_ROOT);
  copyRootPackage("@prisma/fetch-engine", "@prisma/fetch-engine", REPO_ROOT, SERVICE_DIR, ARTIFACT_ROOT);
  copyRootPackage("@prisma/get-platform", "@prisma/get-platform", REPO_ROOT, SERVICE_DIR, ARTIFACT_ROOT);
  prunePrismaEngines(ARTIFACT_ROOT);
}

function main() {
  console.log("== 1: build shared ==");
  run("pnpm", ["--filter", "@gym-coach/shared", "build"], REPO_ROOT);

  console.log("== 2: generate Prisma client ==");
  runOptional("pnpm", ["--filter", "@gym-coach/chat-service", "db:generate"], REPO_ROOT);

  console.log("== 3: build chat-service ==");
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  run("pnpm", ["--filter", "@gym-coach/chat-service", "build"], REPO_ROOT);

  console.log("== 4: prepare production dependencies ==");
  fs.rmSync(TMP_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(DEPLOY_DIR, { recursive: true });
  run("pnpm", ["--filter", "@gym-coach/chat-service", "deploy", DEPLOY_DIR, "--prod"], REPO_ROOT);

  console.log("== 5: flatten node_modules ==");
  flattenNodeModules(DEPLOY_DIR, path.join(ARTIFACT_ROOT, "node_modules"));

  console.log("== 6: add Prisma CLI and Linux migration engines ==");
  copyPrismaCliAndEngines();

  console.log("== 7: copy migration handler and migrations ==");
  fs.mkdirSync(path.join(ARTIFACT_ROOT, "dist"), { recursive: true });
  fs.copyFileSync(path.join(DIST_DIR, "migrate-lambda.js"), path.join(ARTIFACT_ROOT, "dist", "migrate-lambda.js"));
  fs.mkdirSync(path.join(ARTIFACT_ROOT, "prisma"), { recursive: true });
  fs.copyFileSync(path.join(SERVICE_DIR, "prisma", "schema.prisma"), path.join(ARTIFACT_ROOT, "prisma", "schema.prisma"));
  copyTree(path.join(SERVICE_DIR, "prisma", "migrations"), path.join(ARTIFACT_ROOT, "prisma", "migrations"), { keepAll: true });

  console.log("== 8: write zip ==");
  const result = makeZip(ARTIFACT_ROOT, ZIP_OUT);
  console.log(`Wrote ${ZIP_OUT}`);
  console.log(`  ${result.entries} entries, ${(result.bytes / 1024 / 1024).toFixed(2)} MB compressed`);
  console.log("  Handler: dist/migrate-lambda.handler");
}

main();
