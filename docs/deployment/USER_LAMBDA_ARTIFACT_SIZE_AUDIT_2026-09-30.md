# User Service Lambda Artifact Size & Runtime Dependency Safety Audit

Date: 2026-09-30  
Scope: `backend/services/user-service` only  
Artifact inspected: `backend/services/user-service/artifacts/user-lambda.zip`  
AWS target: `fitness-assistant-dev-user`, `ap-southeast-1`, Node.js 22.x, x86_64, handler `dist/lambda.handler`

No AWS deployment, S3 upload, Lambda update, database mutation, migration, source deletion, `package.json` change, build-script edit, commit, or push was performed.

## Executive Summary

The current local `user-lambda.zip` is **not deploy-safe** because its uncompressed size is only 11,863 bytes below the AWS Lambda unzipped quota.

The main cause is **not** `node_modules/@prisma/client`. The main cause is that the artifact contains **13 stale Prisma Debian query-engine temporary files** under:

```text
dist/generated/prisma/libquery_engine-debian-openssl-3.0.x.so.node.tmp*
```

Each temp file is `16,161,048` bytes. Together they add:

```text
210,093,624 bytes
≈ 200.36 MiB uncompressed
≈ 93.50 MiB compressed contribution
```

`node_modules/@prisma/client` is also removable based on the current import graph, but it saves only:

```text
8,116,761 bytes
≈ 7.74 MiB uncompressed
≈ 2.88 MiB compressed
```

Recommended minimal change: fix the build script to prune all generated Prisma temp engines (`*.tmp*`) after copying `dist/generated/prisma`. Optionally also remove `node_modules/@prisma/client` after smoke tests confirm no module-resolution regression.

Final verdict: **NEEDS_BUILD_SCRIPT_FIX**.

## Current ZIP Size

Measured directly from `backend/services/user-service/artifacts/user-lambda.zip` using `System.IO.Compression.ZipFile`.

| Metric | Value |
|---|---:|
| ZIP file size on disk | `116,169,645` bytes |
| Sum compressed entries | `115,382,203` bytes |
| Sum uncompressed entries | `262,132,137` bytes |
| Entries | `4,205` |
| AWS zipped quota | `52,428,800` bytes |
| AWS unzipped quota | `262,144,000` bytes |
| Unzipped headroom | `11,863` bytes |

Current artifact status:

```text
MUST NOT DEPLOY
```

It is technically under the unzipped quota by only a few KB, but the ZIP is far above direct-upload quota and any small packaging drift can exceed the unzipped quota.

## Runtime Import Graph

Search scope:

```text
backend/services/user-service/src
backend/services/user-service/dist
```

Excluded:

```text
**/__tests__/**
**/*.map
**/generated/prisma/**
**/node_modules/**
```

Findings for Prisma-related imports:

| Reference | Classification | Evidence |
|---|---|---|
| `@prisma/client` | Not imported by application runtime | fixed-string search returned `0` hits outside generated Prisma/test/source maps |
| `@prisma/client/runtime/library` | Not imported by application runtime | fixed-string search returned `0` hits outside generated Prisma/test/source maps |
| `Prisma.Decimal` | Runtime application usage, but imported via generated client | `contract.service.ts`, `contract-payout.service.ts`, `pt_service_package.service.ts`, repositories |
| `@prisma/*` | No application runtime import | no direct app import outside generated Prisma |

Important nuance: application code does use `Prisma.Decimal`, but compiled output references the local generated Prisma client import path, not `node_modules/@prisma/client`.

Lambda reachability:

```text
dist/lambda.js
  -> ensureDatabaseUrlConfigured()
  -> validateRequiredRuntimeConfig()
  -> dynamic require("./app")
  -> app mounts all route modules
```

Heavy reachable modules from `dist/app.js` and mounted routes/services:

| Module | Reachability |
|---|---|
| `serverless-http` | Eager from `dist/lambda.js`; required |
| `express`, `helmet`, `pino-http`, `@gym-coach/shared` | Eager from `dist/app.js`; required |
| `@aws-sdk/client-secrets-manager` | Eager from Lambda runtime config; required when using `DATABASE_SECRET_ID` |
| `@aws-sdk/client-lambda` | Reachable via `auth-service.client`; required for direct Auth Lambda invoke |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | Reachable via S3 upload service; conditionally required for presigned upload |
| `@dropbox/sign` | Reachable via Dropbox Sign provider/webhook controller; conditionally required when e-sign is enabled |
| `@anthropic-ai/sdk` | Reachable via InBody vision service; conditionally required |
| `pdfkit` | Reachable via contract PDF service; required for PDF generation path |
| `multer` | Reachable via upload/webhook routes; required by current mounted routes |
| `axios` | Reachable via service clients; required |

No production runtime import of `@prisma/client` was found.

## Prisma Dependency Result

Result:

```text
SELF_CONTAINED
```

Evidence:

`src/generated/prisma/index.js` and `dist/generated/prisma/index.js` start by importing local runtime:

```js
} = require('./runtime/library.js')
```

They export:

```js
Prisma.Decimal = Decimal
```

Targeted search of generated Prisma files did not find a runtime `require("@prisma/client")`, `require("@prisma/engines")`, `require("@prisma/fetch-engine")`, or `require("@prisma/get-platform")` import. `runtime/library.js` contains string metadata mentioning Prisma workspace packages, but those are embedded metadata/strings, not package imports for the normal library-engine runtime.

Required engine:

```text
dist/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node
```

This file exists and must be kept.

Files that are not required for Lambda runtime and are currently present:

```text
dist/generated/prisma/libquery_engine-debian-openssl-3.0.x.so.node.tmp*
```

There are 13 of these stale temp files in the ZIP. They are not valid selected Lambda engine targets and should be pruned.

## Package Size Breakdown

Measured uncompressed and compressed size by ZIP prefix.

| Group | Entries | Uncompressed | Compressed |
|---|---:|---:|---:|
| `dist/generated/prisma` | 33 | 219.07 MiB | 101.25 MiB |
| `node_modules/@prisma/client` | 28 | 7.74 MiB | 2.88 MiB |
| `node_modules/pdfkit` | 20 | 3.54 MiB | 0.77 MiB |
| `node_modules/zod` | 276 | 2.06 MiB | 0.44 MiB |
| `node_modules/@dropbox/sign` | 215 | 2.06 MiB | 0.42 MiB |
| `node_modules/fontkit` | 123 | 1.56 MiB | 0.34 MiB |
| `node_modules/brotli` | 18 | 1.43 MiB | 0.39 MiB |
| `node_modules/@smithy/core` | 384 | 1.11 MiB | 0.28 MiB |
| `node_modules/axios` | 71 | 0.71 MiB | 0.21 MiB |
| `node_modules/pako` | 23 | 0.70 MiB | 0.19 MiB |
| `node_modules/bluebird` | 42 | 0.60 MiB | 0.14 MiB |
| `node_modules/@anthropic-ai/sdk` | 140 | 0.59 MiB | 0.15 MiB |
| `node_modules/@aws-sdk/client-s3` | 148 | 0.51 MiB | 0.10 MiB |
| `node_modules/crypto-js` | 54 | 0.46 MiB | 0.10 MiB |
| `dist` excluding `dist/generated/prisma` | 90 | 0.44 MiB | 0.11 MiB |

Specific requested packages:

| Path | Entries | Uncompressed | Compressed | Runtime necessity | Potentially removable? |
|---|---:|---:|---:|---|---|
| `node_modules/@prisma/client` | 28 | 7.74 MiB | 2.88 MiB | No direct runtime import found | Yes, after smoke test |
| `node_modules/@aws-sdk/*` | 818 | 2.04 MiB | 0.46 MiB | Secrets/S3/Lambda clients | No |
| `node_modules/@smithy/*` | 519 | 1.28 MiB | 0.33 MiB | AWS SDK transitive runtime | No |
| `node_modules/@anthropic-ai/*` | 140 | 0.59 MiB | 0.15 MiB | InBody vision path | Conditional, not safe to prune blindly |
| `node_modules/pdfkit` | 20 | 3.54 MiB | 0.77 MiB | Contract PDF path | No |
| `node_modules/multer` | 9 | 0.02 MiB | 0.01 MiB | Upload/webhook routes | No |
| `node_modules/axios` | 71 | 0.71 MiB | 0.21 MiB | Service clients | No |
| `node_modules/pino` | 76 | 0.37 MiB | 0.17 MiB | Logger dependency via shared/pino-http | No |
| `node_modules/pino-http` | 18 | 0.02 MiB | 0.01 MiB | Express middleware | No |
| `node_modules/@dropbox/sign` | 215 | 2.06 MiB | 0.42 MiB | E-sign path | Conditional, not safe to prune blindly |

Top Prisma generated files:

| File pattern | Count | Uncompressed |
|---|---:|---:|
| `libquery_engine-debian-openssl-3.0.x.so.node.tmp*` | 13 | 200.36 MiB |
| `libquery_engine-rhel-openssl-3.0.x.so.node` | 1 | 15.41 MiB |
| `index.d.ts` | 1 | 1.83 MiB |
| `index.js` | 1 | 0.21 MiB |
| `runtime/library.js` | 1 | 0.18 MiB |

## Runtime Dependency Classification

Production dependencies from `backend/services/user-service/package.json` compared against source/dist runtime imports.

| Dependency | Classification | Evidence / reason |
|---|---|---|
| `@anthropic-ai/sdk` | CONDITIONALLY_USED | imported by `inbody-vision.service`; reachable via InBody route/service |
| `@aws-sdk/client-lambda` | CONDITIONALLY_USED | imported by `auth-service.client`; used for direct Auth Lambda invoke |
| `@aws-sdk/client-s3` | CONDITIONALLY_USED | imported by `s3-upload.service`; presigned S3 upload path |
| `@aws-sdk/client-secrets-manager` | REQUIRED_RUNTIME | imported by Lambda runtime config for `DATABASE_SECRET_ID`; migrate Lambda also imports it |
| `@aws-sdk/s3-request-presigner` | CONDITIONALLY_USED | imported by `s3-upload.service` |
| `@dropbox/sign` | CONDITIONALLY_USED | imported by Dropbox Sign provider/webhook controller |
| `@gym-coach/shared` | REQUIRED_RUNTIME | imported by app, config, clients, jobs |
| `@prisma/client` | UNUSED_RUNTIME in current artifact graph | no direct app runtime import; generated client is self-contained |
| `axios` | REQUIRED_RUNTIME | imported by service clients and profile/application/notification services |
| `cors` | UNUSED_RUNTIME currently | no active import; only comment string in `app.ts` |
| `dotenv` | LOCAL_SERVER_ONLY | imported by `server.ts`, not by Lambda handler |
| `express` | REQUIRED_RUNTIME | imported by `app.ts` |
| `helmet` | REQUIRED_RUNTIME | imported by `app.ts` |
| `multer` | REQUIRED_RUNTIME / CONDITIONALLY_USED | mounted upload/webhook routes import it |
| `pdfkit` | CONDITIONALLY_USED | contract PDF generation |
| `pino` | REQUIRED_TRANSITIVE_RUNTIME | required by shared logger / pino-http dependency graph |
| `pino-http` | REQUIRED_RUNTIME | imported by `app.ts` |
| `serverless-http` | REQUIRED_RUNTIME | imported by `lambda.ts` |
| `zod` | REQUIRED_RUNTIME | controllers/models validation |

The only clear production dependency candidates for future package-level cleanup are:

```text
@prisma/client
cors
dotenv
```

However this audit did **not** change `package.json`. For this deployment, artifact cleanup should happen in the build/package step only.

## Flattening Conflict Analysis

The build script flattens pnpm's isolated dependency graph into one `node_modules` and keeps the first version it sees. This is not a generally safe package-resolution strategy because different parents can require incompatible transitive versions.

Observed conflicts and classification:

| Package | Kept | Discarded | Parent/version evidence | Reachability | Classification |
|---|---:|---:|---|---|---|
| `@aws-sdk/core` | 3.977.9 | 3.978.0 | `@aws-sdk/client-lambda` keeps 3.977.9; credential-provider packages want 3.978.0 | reachable via AWS SDK | LIKELY_SAFE, patch-level, but flattening is structurally risky |
| `@types/node` | 18.19.130 | 20.19.30 | type package from Anthropic/types packages | not runtime | SAFE |
| `axios` | 1.13.2 | 1.18.1, 1.20.0 | direct/shared use 1.13.2; `@dropbox/sign` wants 1.18.1 | reachable | LIKELY_SAFE only if API surface used remains compatible; not ideal |
| `base64-js` | 0.0.8 | 1.5.1 | `linebreak` wants 0.0.8; `buffer`/`fontkit`/`brotli` paths want 1.5.1 | reachable via PDF/font stack and pino stream stack | RISKY due major-version mismatch |
| `debug` | 2.6.9 | 4.4.3 | Express stack wants 2.6.9; proxy/agent stack wants 4.4.3 | reachable if Dropbox/axios proxy path used | RISKY due major-version mismatch |
| `follow-redirects` | 1.15.11 | 1.16.0 | direct/shared axios wants 1.15.11; Dropbox axios wants 1.16.0 | reachable | LIKELY_SAFE patch/minor within v1 |
| `form-data` | 4.0.5 | 4.0.6 | Anthropic types/Dropbox/axios paths | reachable if multipart/provider path used | LIKELY_SAFE patch-level |
| `ms` | 2.0.0 | 2.1.3 | Express/debug wants 2.0.0; agent/debug/humanize-ms wants 2.1.3 | reachable | RISKY/LIKELY_SAFE depending path; API simple but major flatten issue remains |
| `pako` | 0.2.9 | 1.0.11 | `unicode-trie` wants 0.2.9; `browserify-zlib` wants 1.0.11 | reachable via PDF/font/png stack | RISKY due major-version mismatch |
| `proxy-from-env` | 1.1.0 | 2.1.0 | axios 1.13.2 wants 1.1.0; Dropbox axios wants 2.1.0 | reachable | RISKY due major-version mismatch |
| `readable-stream` | 3.6.2 | 4.7.0 | multer/concat-stream wants 3.6.2; pino wants 4.7.0 | reachable via upload and logging | RISKY due major-version mismatch |
| `undici-types` | 5.26.5 | 6.21.0 | type-only via `@types/node` | not runtime | SAFE |

Conclusion: none of these conflicts explains the current size blow-up, but the flatten-first strategy is a runtime risk. If this service continues to grow, the packaging approach should move toward an npm-resolved staging install or a bundler/esbuild strategy that preserves dependency version isolation.

For the immediate deployment-size problem, do **not** solve conflicts first; prune the stale Prisma temp engines first.

## Pino Warning Analysis

Build warning:

```text
Failed to create bin: node_modules/.bin/pino
```

ZIP inspection:

| Check | Result |
|---|---:|
| `node_modules/.bin/pino` present | `0` |
| `node_modules/pino/package.json` present | `1` |
| `node_modules/pino-http/package.json` present | `1` |
| Runtime imports `pino-http` | yes, from `dist/app.js` |

Lambda runtime needs:

```js
require("pino-http")
require("pino")
```

It does **not** need:

```text
node_modules/.bin/pino
```

Classification:

```text
SAFE for Lambda runtime
```

The warning affects CLI execution of the `pino` binary, not application runtime module resolution.

## Safe Prune Candidates

Ranked by size saving, confidence, and runtime risk.

| Rank | Path/package | Estimated saving | Safety | Evidence | Required build-script change |
|---:|---|---:|---|---|---|
| 1 | `dist/generated/prisma/*.tmp*` | 200.36 MiB uncompressed / 93.50 MiB compressed | SAFE | 13 stale Debian temp engines; Lambda uses RHEL engine; filenames are temp artifacts | Add glob prune for `*.tmp*` in generated Prisma output |
| 2 | `node_modules/@prisma/client` | 7.74 MiB uncompressed / 2.88 MiB compressed | SAFE after smoke test | no app runtime import; generated client imports local `./runtime/library.js` | Remove directory after flattening |
| 3 | `node_modules/cors` | tiny | LIKELY_SAFE | no active import, only comment string | package-level cleanup later, not needed now |
| 4 | `node_modules/dotenv` | tiny | LAMBDA_SAFE but local-server dependency | Lambda does not import `server.ts`; local runtime still uses it | do not prune blindly unless Lambda-only artifact is isolated |
| 5 | `node_modules/pino` benchmarks/chaff | small | LIKELY_SAFE | runtime does not need benchmark files | improve `isRuntimeChaff` later; not required for quota |

Do not remove:

```text
dist/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node
```

It is the required native Prisma engine for Lambda x86_64 / Amazon Linux / OpenSSL 3.

## Recommended Minimal Change

Minimal safe fix:

```text
Prune all generated Prisma temp engine files from dist/generated/prisma after copying generated Prisma into dist.
```

This alone changes expected uncompressed size from:

```text
262,132,137 bytes
```

to approximately:

```text
52,038,513 bytes
≈ 49.63 MiB
```

This is far below the preferred `<= 230 MiB` target and the minimum acceptable `<= 240 MiB` target.

Optional additional prune:

```text
Remove node_modules/@prisma/client
```

Expected combined result:

```text
43,921,752 bytes
≈ 41.89 MiB uncompressed
```

Because the temp-engine fix alone is enough, the safest first deployment-oriented change is:

```text
1. prune *.tmp*
2. rebuild
3. run local artifact smoke tests
4. optionally prune @prisma/client in a second rebuild if tests pass
```

## Expected New Artifact Size

| Scenario | Predicted uncompressed size | Meets <= 240 MiB? | Meets <= 230 MiB? |
|---|---:|---:|---:|
| Current artifact | `262,132,137` bytes / 250.94 MiB | No production-safe headroom | No |
| Remove only `node_modules/@prisma/client` | `254,015,376` bytes / 242.25 MiB | No | No |
| Remove only Prisma `*.tmp*` engines | `52,038,513` bytes / 49.63 MiB | Yes | Yes |
| Remove Prisma `*.tmp*` engines + `@prisma/client` | `43,921,752` bytes / 41.89 MiB | Yes | Yes |

Compressed estimate:

| Scenario | Predicted compressed entries |
|---|---:|
| Current entries | `115,382,203` bytes |
| Remove only Prisma `*.tmp*` engines | about `17,337,503` bytes |
| Remove Prisma `*.tmp*` engines + `@prisma/client` | about `14,315,324` bytes |

The ZIP file itself has central-directory overhead, so final on-disk ZIP size will be slightly larger than compressed-entry sum, but still safely below AWS direct-upload quota.

## Local Smoke Test Plan

Run only against a rebuilt local artifact. Do not connect to production AWS/database.

Suggested commands from repository root:

```powershell
pnpm --filter @gym-coach/user-service run build:lambda-zip
```

Inspect rebuilt ZIP size:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path "backend/services/user-service/artifacts/user-lambda.zip"))
($zip.Entries | Measure-Object Length -Sum).Sum
($zip.Entries | Where-Object { $_.FullName -like "dist/generated/prisma/*.tmp*" }).Count
($zip.Entries | Where-Object { $_.FullName -eq "dist/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node" }).Count
$zip.Dispose()
```

Extract to a temporary folder outside the repo:

```powershell
$tmp = Join-Path $env:TEMP ("user-lambda-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
Expand-Archive -Path "backend/services/user-service/artifacts/user-lambda.zip" -DestinationPath $tmp
```

Module-resolution smoke checks:

```powershell
$env:AWS_LAMBDA_FUNCTION_NAME = "local-smoke"
$env:NODE_ENV = "production"
$env:AWS_REGION = "ap-southeast-1"
$env:DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/fitness_assistant_user?schema=public"
$env:INTERNAL_SERVICE_SECRET = "local-smoke-secret"
$env:JWT_SECRET = "local-smoke-jwt"
node -e "const h=require(process.argv[1] + '/dist/lambda.js'); console.log(typeof h.handler)" $tmp
node -e "const p=require(process.argv[1] + '/dist/generated/prisma'); console.log(typeof p.PrismaClient, typeof p.Prisma.Decimal)" $tmp
node -e "require(process.argv[1] + '/dist/app.js'); console.log('app-load-ok')" $tmp
node -e "const fs=require('fs'), path=require('path'); const f=path.join(process.argv[1],'dist/generated/prisma/libquery_engine-rhel-openssl-3.0.x.so.node'); if(!fs.existsSync(f)) process.exit(1); console.log('engine-ok')" $tmp
node -e "const s=require('fs').readFileSync(process.argv[1] + '/dist/services/availability.service.js','utf8'); console.log(s.includes('DAY_NAME_NORMALIZE') && s.includes('Mon') && s.includes('MONDAY'))" $tmp
```

If `node_modules/@prisma/client` is pruned, add:

```powershell
node -e "require(process.argv[1] + '/dist/generated/prisma'); require(process.argv[1] + '/dist/app.js'); console.log('no-prisma-client-module-needed')" $tmp
```

These smoke checks validate:

1. `dist/lambda.js` loads.
2. generated Prisma module loads.
3. required native Prisma engine exists.
4. no immediate `MODULE_NOT_FOUND`.
5. key app modules load.
6. availability normalization is compiled.
7. no missing `@prisma/client` runtime error if pruned.
8. Lambda handler can initialize without making external calls beyond environment validation.

## Deploy Safety Verdict

Verdict:

```text
NEEDS_BUILD_SCRIPT_FIX
```

Reason:

The artifact is currently not deploy-safe due to stale generated Prisma temp engines. The safest immediate fix is a packaging/build-script prune for `dist/generated/prisma/*.tmp*`, followed by rebuild and local artifact smoke tests. Removing `node_modules/@prisma/client` is supported by the import graph, but it is not the minimal fix needed to meet size target.

Proposed build-script patch only, not applied:

```diff
diff --git a/backend/services/user-service/scripts/build-lambda-artifact.js b/backend/services/user-service/scripts/build-lambda-artifact.js
--- a/backend/services/user-service/scripts/build-lambda-artifact.js
+++ b/backend/services/user-service/scripts/build-lambda-artifact.js
@@
   for (const engine of [
     "query_engine-windows.dll.node",
     "libquery_engine-linux-musl-openssl-3.0.x.so.node",
     "libquery_engine-debian-openssl-3.0.x.so.node",
   ]) {
     fs.rmSync(path.join(ARTIFACT_ROOT, "dist", "generated", "prisma", engine), { force: true });
   }
+  for (const entry of fs.readdirSync(path.join(ARTIFACT_ROOT, "dist", "generated", "prisma"))) {
+    if (/^libquery_engine-.*\\.tmp\\d*$/.test(entry)) {
+      fs.rmSync(path.join(ARTIFACT_ROOT, "dist", "generated", "prisma", entry), { force: true });
+    }
+  }
```

Optional second patch after smoke tests:

```diff
@@
   for (const pkg of ["engines", "fetch-engine", "get-platform"]) {
     fs.rmSync(path.join(ARTIFACT_ROOT, "node_modules", "@prisma", pkg), { recursive: true, force: true });
   }
+  fs.rmSync(path.join(ARTIFACT_ROOT, "node_modules", "@prisma", "client"), {
+    recursive: true,
+    force: true,
+  });
```

