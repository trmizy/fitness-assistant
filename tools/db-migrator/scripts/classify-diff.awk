# classify-diff.awk
#
# Splits a `prisma migrate diff --script` output file into blocks. Each block
# starts with a "-- <ActionName>" comment (Prisma's own generated-migration
# convention: CreateTable, AlterTable, CreateIndex, CreateEnum, DropTable, ...)
# and routes it to either the idempotent-safe prepatch or the
# needs-manual-review bucket:
#
#   - CreateTable   -> always safe: CREATE TABLE IF NOT EXISTS is all-or-nothing,
#                      so a pre-existing table is skipped whole, never partially.
#   - CreateIndex   -> always safe: CREATE [UNIQUE] INDEX IF NOT EXISTS.
#   - CreateEnum    -> always safe: wrapped in a duplicate_object-guarded DO block
#                      (Postgres has no CREATE TYPE IF NOT EXISTS).
#   - AlterEnum     -> safe ONLY if every line is `ALTER TYPE "..." ADD VALUE '...';`
#                      (rewritten `ADD VALUE IF NOT EXISTS`, supported since PG 12 —
#                      Aurora here runs PG 17). Any other enum change (rename a
#                      value, Prisma's drop-and-recreate dance for a removed
#                      value, ...) fails the whitelist and stays manual review.
#   - AlterTable    -> safe ONLY if every line in the block is a full, single-line
#                      `ALTER TABLE "..." ADD COLUMN "..." ...;` statement. Any
#                      other shape (DROP COLUMN, ALTER COLUMN, RENAME, multi-line
#                      constructs, ...) fails the whitelist and the WHOLE block
#                      is treated as unsafe. This fails closed on purpose: we
#                      never guess at an unfamiliar shape.
#   - anything else (DropTable, DropColumn, DropIndex, AlterColumn, RenameTable,
#     RenameColumn, AddForeignKey, DropForeignKey, RedefineTables, AlterEnum, ...)
#     -> always unsafe / needs manual review.
#
# Usage: awk -f classify-diff.awk -v db=<dbname> -v safe_out=FILE -v unsafe_out=FILE infile
# safe_out/unsafe_out are truncated by the caller before invocation; this script
# only appends.

function flush_block() {
  # Nothing accumulated yet (e.g. we're still inside a multi-line Prisma
  # comment, before any SQL line has appeared) — leave `tag` alone so a
  # later explanatory comment line can't overwrite the real action tag set
  # by the first "-- " line of the block.
  if (nlines == 0) { return }

  is_safe = 0
  body = ""
  for (i = 1; i <= nlines; i++) body = body lines[i] "\n"
  rewritten = body

  if (tag == "CreateTable") {
    is_safe = 1
    gsub(/CREATE TABLE "/, "CREATE TABLE IF NOT EXISTS \"", rewritten)
  } else if (tag == "CreateIndex") {
    is_safe = 1
    gsub(/CREATE UNIQUE INDEX "/, "CREATE UNIQUE INDEX IF NOT EXISTS \"", rewritten)
    gsub(/CREATE INDEX "/, "CREATE INDEX IF NOT EXISTS \"", rewritten)
  } else if (tag == "CreateEnum") {
    is_safe = 1
    rewritten = "DO $$ BEGIN\n" body "EXCEPTION WHEN duplicate_object THEN NULL; END $$;\n"
  } else if (tag == "AlterEnum") {
    all_add_value = 1
    for (i = 1; i <= nlines; i++) {
      if (lines[i] !~ /^ALTER TYPE "[^"]+" ADD VALUE '([^']|'')*';[[:space:]]*$/) {
        all_add_value = 0
      }
    }
    if (all_add_value) {
      is_safe = 1
      gsub(/ADD VALUE '/, "ADD VALUE IF NOT EXISTS '", rewritten)
    }
  } else if (tag == "AlterTable") {
    # Prisma renders a multi-column ADD COLUMN as one statement spanning
    # several lines: `ALTER TABLE "x" ADD COLUMN "a" T,\nADD COLUMN "b" T;`.
    # Line 1 must start the ALTER TABLE and end in "," or ";"; every
    # continuation line must itself be a bare ADD COLUMN clause; whichever
    # line is last must end the statement with ";". Any line failing this —
    # DROP COLUMN, ALTER COLUMN, a stray unrelated statement, anything — fails
    # the whole block closed. Pure syntactic recognition of Prisma's own
    # output shape; every type still comes straight from Prisma, never guessed.
    all_add_column = 1
    for (i = 1; i <= nlines; i++) {
      line = lines[i]
      if (i == 1) {
        if (line !~ /^ALTER TABLE "[^"]+"(\."[^"]+")? ADD COLUMN[[:space:]]+"[^"]+".*[,;][[:space:]]*$/) {
          all_add_column = 0
        }
      } else {
        if (line !~ /^ADD COLUMN[[:space:]]+"[^"]+".*[,;][[:space:]]*$/) {
          all_add_column = 0
        }
      }
      if (i == nlines && line !~ /;[[:space:]]*$/) {
        all_add_column = 0
      }
    }
    if (all_add_column) {
      is_safe = 1
      gsub(/ADD COLUMN[[:space:]]+"/, "ADD COLUMN IF NOT EXISTS \"", rewritten)
    }
  }

  target = is_safe ? safe_out : unsafe_out
  print "-- [" db "] " tag (is_safe ? "" : "  *** NEEDS MANUAL REVIEW ***") >> target
  printf "%s", rewritten >> target
  print "" >> target

  nlines = 0
  tag = ""
}

BEGIN { nlines = 0; tag = "" }

/^-- / {
  flush_block()
  # Prisma sometimes follows the action-tag comment with extra explanatory
  # comment lines (e.g. AlterEnum's multi-value-add warning) before the SQL
  # starts. Only the FIRST comment line of a block is the real tag; keep it.
  if (tag == "") {
    tag = $0
    sub(/^-- /, "", tag)
  }
  next
}

/^[[:space:]]*$/ { next }

{
  nlines++
  lines[nlines] = $0
}

END { flush_block() }
