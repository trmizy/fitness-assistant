---
name: gymini-parallel-agent-safety
description: The working tree is dirty, Codex or another agent is mentioned, a large multi-service change is requested, or git history shows recent unfamiliar commits/merges. Load before editing any file you didn't just create, to avoid stepping on concurrent work.
---

# Gymini Parallel Agent Safety

Claude Code and Codex (or other agents) may be actively working in this
exact working tree at the same time. This repo's own history has real
merge commits combining both agents' work — this is a normal, expected
workflow here, not an anomaly.

## Procedure before any edit

```
git status
git branch --show-current
git diff
git log --oneline -15
```

Classify every changed/untracked file you're about to touch:

- **OURS** — you created it this session, or it's squarely inside the
  task you were explicitly asked to do.
- **OTHER_AGENT** — modified/created recently, in a domain you know is
  someone else's active focus (check `docs/*_AUDIT.md`/
  `*_IMPLEMENTATION_REPORT.md` dates and content — e.g. Canonical
  Exercise Identity / AI Workout Grounding / Exercise Catalog /
  Equipment / Substitution / AWS Lambda migration files
  (`lambda.ts`, `migrate-lambda.ts`, `jobs-lambda.ts`, `config/
  lambda-runtime.ts`) have all been real, large, concurrent workstreams
  in this repo).
- **UNKNOWN** — modified, but you can't tell whose work it is or why.

Avoid writing to OTHER_AGENT/UNKNOWN files. If a shared file genuinely
must change (e.g. a missing gateway proxy route blocking your own
task), make the smallest possible, clearly-commented, additive edit —
never revert or rewrite a section you didn't add, and re-read the full
diff of that file afterward to confirm you only touched what you meant
to.

## Never

- `git reset --hard`
- `git clean -fd`
- `git checkout --` / `git restore` on a file you didn't just break
  yourself
- force-push
- rewrite history (`rebase -i`, amend a commit that isn't the one you
  just made)
- commit another agent's files as part of "cleaning up" unless the user
  explicitly asked for exactly that scope

## Commits and pushes

Never commit unless explicitly requested. When a push is requested and
the working tree contains a large amount of clearly-unfamiliar
concurrent work, **ask the user for the intended scope** before staging
broadly (push everything vs. push only your own files) — don't assume
either answer. Once the user picks a scope, follow it exactly: `git add
-A` is fine for "push everything," but review `git status`/the diff for
anything that looks like a secret (even in a file whose name looks
innocuous) before committing either way.

## At finish

```
git diff -- <the specific paths you own>
git status
```

Report any real conflict with another agent's work honestly — don't
paper over it, and don't silently resolve it in your own favor.

## Definition of correct behavior

At the end of a session, `git status` shows exactly the files you meant
to touch changed, nothing you didn't intend to touch was reverted or
rewritten, and any shared-file edit you made is minimal and clearly
commented as to why.

## Common failure modes

- Assuming a dirty working tree means something is broken, and
  "cleaning it up" (reverting/staging away another agent's in-progress
  work).
- Editing a shared config/route file broadly instead of making the
  smallest additive change.
- Committing/pushing a large unfamiliar diff without checking whether
  it's actually meant to go out yet (an in-progress Lambda migration,
  for instance, might not be ready to ship).
