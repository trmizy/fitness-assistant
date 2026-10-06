# Gymini Word Workshop — Issues (from READ-ONLY audit)

No fixes applied. Each item lists evidence and what a fix would need. Ordered by severity.

## Critical

### 1. Secret-redaction claim is unverified and contradicts the document (security)
- **Evidence:** Workshop and original both say the 9 flagged screenshots were "pixel-level opaque rectangle burned into the raster; sanitized PNG replaced the original in place (Phase 4E)" and "None — unsafe original no longer embedded". But every media part is byte-identical to the original (358/358 SHA-256), so no replacement exists in the package. The same document also says "pixel redaction … not achievable … all 9 flagged screenshots remain OPEN".
- **Partial visual evidence:** 5 of the secret-adjacent screenshots checked (`image114`, `image83`, `image39`, `image18`, `image104`) have opaque black boxes in the raster over the secret values. 11 others show no unmasked secret value. The register does not map its 9 rows to media parts, so the 9 cannot be checked one by one.
- **Fix needed:** (a) map each register row to its media part; (b) confirm each flagged part is opaque-masked in the raster, with no unmasked copy elsewhere in `word/media`; (c) rewrite the register and status text to match the verified state, removing both the "replaced" claim and the "remain OPEN" claim unless true.
- **Gate:** SECURITY AUDIT cannot pass until this is done.

## Major

### 2. Word openability and page layout not verified
- **Evidence:** No LibreOffice, Word, or PDF renderer in this environment. Structure checks pass (valid ZIP, tag-balanced XML, 0 broken relationships), but layout (overlap, crop, stretch, blank pages, table overflow, orphan captions) was not reviewed.
- **Fix needed:** open the file in Word or convert with LibreOffice headless on a machine that has it, record exit code and page count, then render key pages (chapter starts, AI and Chat sections, Database Migration, appendices).

### 3. Secret Redaction Register sits inside the Introduction (structure)
- **Evidence:** H1 #2 is "Documentation Security Review — Secret Redaction Register", placed before "2. Preparation". The conversion note says it is "intentionally retained in its current position during Phase W1".
- **Fix needed:** move to an appendix (or a separate audit file) at final presentation cleanup. Do not move during this read-only audit.

### 4. Internal process history in the workshop body (presentation)
- **Evidence:** Phase 4B/4D/4E logs, "Phase W1", "Word add-in sandbox", and review-pass narratives appear in body sections. Present in the original too.
- **Fix needed:** keep the operational facts; move the process narrative to an appendix or delete it at cleanup.

### 5. No table of contents (TOC_MISSING)
- **Evidence:** No `TOC \o` field in either file.
- **Fix needed:** add a TOC field after the title page when editing starts (not added in this audit).

### 6. Status table row count differs from the brief (needs owner confirmation)
- **Evidence:** Deployment Status Summary has 12 table rows including header (11 data rows). The brief states 12 intended rows.
- **Fix needed:** owner to check which row is missing (or confirm the header count) — do not add a row without a source.

## Minor

### 7. Inconsistent service sections
- **Evidence (heuristic):** Auth, Fitness, Gym, Payment, AI, Chat have no "Summary" section; Gym has no explicit prerequisites marker.
- **Fix needed:** add short summaries per service during editing; confirm prerequisites for Gym against the original.

### 8. Placeholder DB URL with placeholder password in editable text
- **Evidence:** one DB-URL-shaped string with a placeholder-word password (both files). Not a real credential.
- **Fix needed:** replace with an obvious placeholder token (e.g. `<DB_PASSWORD>`) to avoid scanner noise.

### 9. Full semantic screenshot-alignment check not done
- **Evidence:** image order unchanged vs original (358/358 at the same index). Only the secret-adjacent candidates were read in context.
- **Fix needed:** a per-screenshot action-to-image review, in a follow-up pass.

## Not issues (checked and clean)

- Image count: 358 = 358, same order, same bytes, 0 missing, 0 duplicates.
- Identifiers and commands: no loss, no change (125 command lines each).
- Unsupported new history: none found.
- Size difference (−35%): container compression only (media stored vs deflated); decompressed bytes identical.
- Relationships: 0 broken.
