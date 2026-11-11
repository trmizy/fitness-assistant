# Gymini Word Workshop — Final Audit (READ-ONLY)

Audit mode: READ-ONLY. No DOCX was edited, saved, replaced, or uploaded. All work was done on copies in a scratch audit area.

## Sources

| Role | File | Size (bytes) | Modified | SHA-256 (first 16) |
|---|---|---|---|---|
| Original (A) | `Downloads/deploy aws.docx` | 54,391,453 | 2026-10-02 01:59 | 375d47b39bbc77e9 |
| Original (B) | `OneDrive/Tài liệu/deploy aws.docx` | 54,391,464 | 2026-10-02 20:21 | 2c4ed398f7a2c059 |
| Workshop (C) | `OneDrive/deploy aws - workshop.docx` | 35,277,463 | 2026-10-02 03:11 | e49357db2bcb66784 |
| Workshop (D) | `OneDrive/deploy aws - workshop W1 backup.docx` | 35,277,463 | 2026-10-02 07:25 | e49357db2bcb66784 |

Notes on source selection:
- No file named `deploy aws - workshop FINAL.docx` exists. Candidate workshop = newest file, **D** (`W1 backup`). **C and D are byte-identical** (same SHA-256), so the choice has no effect on results.
- Two originals exist with different hashes. Their `word/document.xml` is byte-identical (MD5 `2af4257c…`). They differ only in `docProps`, `settings.xml`, `footnotes.xml`, `endnotes.xml`. Audit baseline = **B** (newest). Results were checked against **A** too; image results are identical for both.

## Summary results

| Check | Result |
|---|---|
| ZIP integrity (A, B, C/D) | VALID, VALID, VALID (`unzip -t`) |
| Broken relationships | **0** (379 rels, 365 r:id references, 0 unresolved, 0 missing targets) |
| ORIGINAL_DISPLAYED_IMAGE_COUNT | **358** (358 `w:drawing`, 358 `a:blip`, 358 `r:embed`) |
| WORKSHOP_DISPLAYED_IMAGE_COUNT | **358** |
| EXPECTED_IMAGE_COUNT | 358 |
| IMAGE_COUNT_CHECK | **PASS** |
| MISSING_IMAGE_COUNT | **0** |
| MOVED_IMAGE_COUNT | **0** (every occurrence stays at the same document index) |
| SANITIZED_REPLACEMENT_COUNT | **0** (no media hash differs from the original) |
| UNCHANGED_IMAGE_COUNT | **358** (by SHA-256) |
| UNEXPLAINED_DUPLICATE_COUNT | **0** |
| ACCIDENTAL_DUPLICATE_IMAGE_OCCURRENCES | **0** (358 distinct media for 358 occurrences; no media reused) |
| BROKEN_IMAGES | **0** (every image relationship resolves to a media part that parses as PNG/JPEG) |
| Legacy image forms (`v:imagedata`, `w:object`) | 0 |
| Images in headers/footers/footnotes/comments | 0 |
| Text boxes (`txbxContent`) | 0 |
| OPEN_SECRET_SCREENSHOTS | **NOT CERTIFIED — see §4** |
| UNSAFE_ORIGINAL_SECRET_MEDIA_REMAINING | **NOT CERTIFIED — see §4** |
| TEXT_SECRET_EXPOSURES | **0** (19 hits were AWS Secrets Manager ARNs; 1 DB-URL hit used a placeholder password) |
| COMMAND_BLOCKS (command-like lines) | 125 original / 125 workshop |
| COMMANDS_CHANGED | **0** |
| COMMANDS_MISSING | **0** |
| CRITICAL_TECHNICAL_FACTS_LOST | **0** (identifier sets equal; see §5) |
| TECHNICAL_FACTS_SUSPECTED_LOST | 0 |
| UNSUPPORTED_NEW_DEPLOYMENT_HISTORY | **0** (none of the Phase-O terms appear only in the workshop) |
| STATUS_TABLE_ROW_COUNT | 12 table rows incl. header = **11 data rows** (brief expects 12 — owner to confirm) |
| SECRET_REGISTER_ROW_COUNT | 11 table rows incl. header = **10 data rows** |
| Secret rows leaked into status table | **No** |
| TABLE_COUNT (orig / workshop) | 5 / 5, identical headers and row counts |
| TOC | **TOC_MISSING** (no `TOC \o` field in either file; not added) |
| DOCX_OPENS_SUCCESSFULLY | **NOT VERIFIED** — structural checks pass (tag-balanced XML, valid ZIP, resolved rels), but no Word or LibreOffice is available in this environment to open/convert the file |

## 1. Package integrity (Phase B)

- All three ZIPs pass `unzip -t`.
- Parts in both files: `document.xml`, `styles.xml`, `numbering.xml`, `settings.xml`, `_rels/document.xml.rels`, `header1-3.xml`, `footer1-3.xml`, `footnotes.xml`, `endnotes.xml`, `comments*.xml`, `people.xml`, `webextensions/`, `theme/`, 358 media parts.
- Tag-balance (structural XML) passes for `document.xml`, `styles.xml`, `numbering.xml`, `settings.xml`, `[Content_Types].xml`, `document.xml.rels`, `header1.xml`, `footer1.xml` in both files. This is not a schema validation.
- `document.xml` in the workshop differs from the original (2,572,006 vs 2,569,603 bytes). The text changes are listed in §5.

## 2. Image forensics (Phases C–F)

- Occurrence inventory built from `word/document.xml` in document order: `w:drawing` → `a:blip r:embed` → relationship → media part → SHA-256, pixel dimensions, nearest preceding heading, neighbouring text.
- Original occurrence *i* and workshop occurrence *i* have the **same SHA-256 at the same index in all 358 cases**.
- The set of media hashes is identical. The total media bytes are identical (54,054,466).
- Mapping result: UNCHANGED 358 / MOVED 0 / SANITIZED_REPLACEMENT 0 / MISSING 0 / UNEXPLAINED_DUPLICATE 0.
- Near-duplicate sizes: 11 pairs share pixel dimensions and near-equal byte size. Spot-checked pairs are unrelated screens (e.g. an S3 policy vs an SQS console), not before/after copies. No accidental duplication.
- Mapping rows: `docs/audit/GYMINI_WORD_WORKSHOP_IMAGE_MAP.csv` (358 rows).

## 3. Size explanation (Phase T)

- Original: all 358 media entries are **Stored** (uncompressed) in the ZIP — 54.3 MB of media data in a 54.4 MB file.
- Workshop: all 358 media entries are **Deflated** — 35.2 MB in a 35.3 MB file.
- Decompressed media bytes and every media SHA-256 are identical, so the 35% size reduction is ZIP container compression only. **No image was recompressed or lost.**
- IMAGE_QUALITY_DEGRADED_COUNT = **0** (no re-encoding; media bytes identical).

## 4. Secret-redaction forensics (Phase G) — **the main open issue**

The workshop's "Secret Redaction Register" (and the original's) says: 9 flagged screenshots were "pixel-level opaque rectangle burned into the raster; sanitized PNG replaced the original in place (Phase 4E)", with "None — unsafe original no longer embedded" for 8 rows.

Findings:

1. **The "sanitized PNG replaced the original" claim is not reflected in the file.** Every workshop media part is byte-identical to the original. Replacement would have produced different bytes for the flagged images; none exist. The only way the register's claim could be true is if the original media already contained the masked images — which is the case for the screenshots I checked (see 2).
2. **The document contradicts itself.** The same original contains status lines saying "Pixel-level redaction: still not achievable … All 9 flagged screenshots remain OPEN" (and "Open exposures remain 9"), alongside the register saying REDACTED. The workshop repeats both statements.
3. **Visual spot-check (raster level, categories only, no values reproduced):**
   - Black-boxed over a secret value (raster): media `image114` (Gym Lambda env vars — INTERNAL_SERVICE_SECRET and CHECKIN_TOKEN_SECRET), `image83` and `image39` (INTERNAL_SERVICE_SECRET, Lambda env edit), `image18` and `image104` (Aurora master password, Secrets Manager "Store a new secret").
   - Sensitive field empty (no value to expose): `image190`, `image206`, `image148`.
   - Only a secret *name* or non-sensitive env values visible: `image70`, `image72`, `image297`, `image256`, `image236`.
   - **No unmasked secret value found in any of the 16 secret-adjacent screenshots checked.**
4. **Overlay check:** the 76 `w:pict` elements are grey horizontal-rule separators (`v:rect fillcolor="#a0a0a0"`). There are no black overlay shapes in `document.xml`, so the boxes visible in the workshop are in the PNG raster, not Word overlays.
5. **Coverage gap:** the register does not map its 9 flagged rows to media parts, and there is no OCR. I could not confirm all 9 flagged images individually, nor scan all 52 secret-adjacent candidates. Scope of checked images: 16 of 52 candidates plus the 9 flagged categories by name.

Consequence: OPEN_SECRET_SCREENSHOTS and UNSAFE_ORIGINAL_SECRET_MEDIA_REMAINING **cannot be certified as 0** from this audit. The register's text is not evidence-backed (it describes a replacement that did not happen in this package), and the status text says the opposite. Under the brief's rule, a security PASS needs a per-image mapping from the register rows to media parts, plus an unmasked-value check of each flagged part. That work is not done.

## 5. Content preservation (Phases I, J)

- Identifier sets are identical between original and workshop (no loss, no addition):
  ARNs 36/36, VPC IDs 1/1, subnet IDs 2/2, security-group IDs 2/2, ECR URIs 5/5, S3 URIs 12/12, `fitness-assistant-dev-*` resource names 105/105, ECS-related names 9/9, API route paths 98/98, env-var-style names 124/124, SQL statements 3/3.
- Command-like lines (aws, npx, pnpm, docker, psql, curl, node, git, eb, sam, ecr, powershell, SQL keywords): 125 in each file, 0 changed, 0 missing.
- Paragraph-level diff (non-empty lines): 18 lines removed and 37 added. Removed lines are original headings (renamed or moved, see §6). Added lines are new headings, a short introduction, four workshop objectives, a roadmap list, and the conversion note. The "Architecture Summary" content survives under `1.5 Solution Architecture` (with `1.5.1–1.5.3` sub-sections). "Current Deployment Next Steps" content survives under `1.6 Current Scope and Known Limitations`.
- Incident headings: 2 "Incident" H2 headings in each file (preserved).
- Lost facts: none found. Suspected lost: none found.

## 6. Structure and headings (Phases K, Q)

Workshop H1 sequence: `1. Introduction` → `Documentation Security Review — Secret Redaction Register` → `2. Preparation` → `3. Deploy Auth Service` → … → `9. Deploy Chat Service` → `10. Database Migration & Restore`.

Issues:
- **The Secret Redaction Register sits as H1 #2, inside the Introduction, before any deployment content.** The workshop's own conversion note says it is "intentionally retained in its current position during Phase W1". Internal audit material in the body of a workshop is a presentation problem.
- **Internal process history remains in the body** (Phase 4B/4D/4E, "Phase W1", "the Word add-in sandbox", review logs). Present in the original too, but not appropriate for a workshop.
- `1.3 Workshop Roadmap` is a list of chapter names (correct), but the roadmap omits the register and the 1.4–1.6 sections.
- Heading style counts (original → workshop): Heading1 13 → 11; Heading2 45 → 48; Heading3 145 → 148; Heading4 505 → 505; ListBullet 94 → 107. Body text is not styled as Heading in the sampled paragraphs.
- Duplicate chapter numbers: none. Orphan headings: none found (every H2 is followed by body text or a list).
- HEADING_HIERARCHY: **PARTIAL** (numbering coherent; register placement and unnumbered H1 break the flow).

## 7. Service workshop format (Phase L) — heuristic keyword scan

Each service chapter was scanned for: overview, prerequisites, configuration, steps, expected result, verification, troubleshooting, summary. Heuristic only; a human read is still needed.

| Service | Lines | Sections detected | Rating |
|---|---|---|---|
| Auth | 333 | overview, prereq, config, steps, expected, verify, trouble | PARTIAL (no summary) |
| User | 838 | all 8 | PASS (heuristic) |
| Fitness | 587 | 7 (no summary) | PARTIAL |
| Gym | 358 | 6 (no prereq marker, no summary) | PARTIAL |
| Payment | 896 | 7 (no summary) | PARTIAL |
| AI | 2,104 | 7 (no summary) | PARTIAL |
| Chat | 1,400 | 7 (no summary) | PARTIAL |

Values: AUTH_WORKSHOP_FORMAT PARTIAL, USER_WORKSHOP_FORMAT PASS, FITNESS_WORKSHOP_FORMAT PARTIAL, GYM_WORKSHOP_FORMAT PARTIAL, PAYMENT_WORKSHOP_FORMAT PARTIAL, AI_WORKSHOP_FORMAT PARTIAL, CHAT_WORKSHOP_FORMAT PARTIAL.

## 8. Screenshot alignment (Phase M)

- Image order is unchanged from the original (358/358 at the same index), so **no screenshot moved** relative to its original text.
- Alignment vs. original is therefore preserved by construction. A full semantic audit of all 358 (action ↔ screenshot) was not performed. What was checked: for the secret-adjacent candidates (52), the nearest heading and neighbouring text were read from the inventory (e.g. Lambda env-var screens sit under the matching "Environment variables" step; Secrets Manager screens under the matching "Store a new secret" step). IAM, API Gateway, SQS, ECS, and Bedrock placements were not individually verified.
- SCREENSHOT_ALIGNMENT: **PARTIAL** (no regression; full semantic check not done).

## 9. Table integrity (Phase P)

- 5 tables in each file, identical headers and row counts.
- Deployment Status Summary: 12 table rows incl. header (11 data rows). The brief states 12 intended rows — **owner to confirm which row is missing or whether the brief count includes a header**.
- Secret Redaction Register: 11 table rows incl. header (10 data rows).
- Secret-register rows did not leak into the status table (status table contains no "REDACTED" / "SECRET" text).
- TABLE_CORRUPTION: none found. TABLE_ROW_MISPLACEMENT: none found.
- TABLE_INTEGRITY: **PASS** (structure), with the row-count question above.

## 10. Historical failure preservation (Phase N)

- Both incident H2 headings are present in both files.
- Incident text, verification results, and troubleshooting prose are retained (no loss found by identifier and command comparison).
- Spot-checked incident: "stale DB credential after Secrets Manager password rotation" — evidence screenshots (media 1–6) are unchanged and adjacent.

## 11. Unsupported new history (Phase O)

Searched both files for: NAT on-demand, on-demand (Chat), VPCE lifecycle, Secrets VPCE, Aurora lifecycle automation, cost baseline, Bedrock authorization, AI E2E results. Counts identical in original and workshop; the workshop adds no such claim. Newly added prose (introduction, objectives, roadmap) makes no deployment-state claim. **UNSUPPORTED_NEW_DEPLOYMENT_HISTORY = 0.**

## 12. Secret text scan (Phase H)

- Searched for AWS access key IDs, JWTs, DB URLs with credentials, private key blocks, bearer values, and assigned secret values.
- 19 "assigned secret" hits: all are AWS Secrets Manager resource ARNs (`arn:aws:secretsmanager:…:secret:…`), which are not credentials.
- 1 DB-URL hit (both files): the user is `postgres`; the password matches a common placeholder word. Not a credential exposure (hygiene note only — replace with an obvious placeholder token).
- TEXT_SECRET_EXPOSURES: **0**. No real values were printed in this report.

## 13. Layout, render, and openability (Phases R, U)

- **Not performed.** No LibreOffice, no Word, no PDF renderer, no Python (only Node) is available in this environment. Consequently: no page render, no contact sheets, no visual layout QA (overlap, cropping, stretch, blank pages, table overflow, orphan captions).
- DOCX_OPENS_SUCCESSFULLY: **NOT VERIFIED**. Structural evidence only (valid ZIP, tag-balanced XML, all relationships resolve, all media decodable by header).
- LAYOUT_QA: **NOT RUN** (report as not performed, not as PASS).

## 14. Verdict

Security and readiness conditions not met:

- Secret-redaction claim is unverified and internally contradictory (§4). The register's "replacement" did not happen in this package; the status text says the screenshots are still open. Per-image verification is incomplete.
- Document opens (Word/LibreOffice) and page layout were not verified (§13).
- Register sits inside the Introduction and internal process history remains in the body (§6).
- No TOC (TOC_MISSING).
- Status table row count differs from the brief's 12 (owner to confirm).

What is confirmed: image preservation is complete and exact (358/358 by hash, same order, no duplicates, no media loss); command blocks and identifiers are preserved; no unsupported new deployment history; no secret text exposure in editable text.

FINAL_WORKSHOP_STATUS: **FAIL_REQUIRES_FIXES**
SAFE_TO_CONTINUE_EDITING: **NO** — resolve the secret-screenshot status first, so further edits do not build on an unverified redaction claim.
SAFE_TO_REPLACE_ORIGINAL: **NO** — the workshop copy has not passed; and the original is the only file that matches the historical baseline.

No fixes were applied in this audit.
