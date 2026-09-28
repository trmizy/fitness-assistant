# One-time AWS data-migration importer image — Fargate task image, source
# preparation only. NOT pushed to ECR by this pass, NOT run against AWS.
#
# Why this image exists at all (see docs/aws-full-local-data-migration-
# final-reconciliation.md §21): the importer
# (scripts/data-migration-import-aws.mjs) is a Node.js script that shells
# out to `psql`/`pg_restore`. A plain `postgres:15` image has those two
# binaries but no Node.js runtime; a plain `node:20` image has Node but no
# PostgreSQL client tools. Neither alone can run this script. This image
# is the small, dedicated combination of both — nothing else.
#
# postgres:15-alpine is the base (NOT node:20-alpine, which was tried
# first and rejected): as of this pass, Alpine's own package index no
# longer carries `postgresql15-client` at all (only 16/17/18 — confirmed
# empirically with `apk search postgresql`), so a node:20-alpine base
# would only offer a NEWER major-version client than the `pg_dump
# (PostgreSQL) 15.18` these dumps were created with. Going the other
# direction avoids that mismatch entirely: `postgres:15-alpine` already
# ships the exact matching `psql`/`pg_restore` 15.18, and its Alpine
# package index (a slightly older Alpine release, pinned to match
# Postgres 15) still carries a `nodejs` package — a single `apk add`.
FROM postgres:15-alpine

# Provides the Node.js runtime this script needs. `psql`/`pg_restore` are
# already present in this base image at the correct matching version.
RUN apk add --no-cache nodejs

WORKDIR /app

# The importer script has zero npm dependencies of its own (only Node
# built-ins: node:child_process, node:crypto, node:fs, node:os,
# node:path — confirmed by reading its own import block) — so there is no
# `package.json`/`node_modules` to install here at all. If a future
# revision of the script adds a real dependency, a `package.json` +
# `npm ci --omit=dev` step belongs here, before this COPY line.
COPY scripts/data-migration-import-aws.mjs /app/data-migration-import-aws.mjs

# No credentials are ever baked into the image — DATABASE_URL (built from
# a Secrets Manager secret by whatever orchestrates the Fargate task run)
# is supplied entirely at container-run time via the environment, per the
# importer script's own design (it errors out immediately if
# DATABASE_URL is unset).
ENTRYPOINT ["node", "/app/data-migration-import-aws.mjs"]
