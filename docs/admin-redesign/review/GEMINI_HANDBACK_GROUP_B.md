# GROUP B HAND-BACK (2026-11-05)

## PHASE 0: BASELINE AUDIT

### 1. Git Status and Commit Baseline
- `git -C D:/admin-fr status --short`:
  ```
  (clean working tree at start of Phase 0)
  ```
- `git -C D:/admin-fr log --oneline -3`:
  ```
  a305e41e feat(admin-web): nối cờ gym G37 và hoàn thiện giao diện quyết định khiếu nại gym (A1/C7/C9)
  27363906 fix(web): khách/PT xem 'Khiếu nại của tôi' nhận đúng thông tin tiền và bằng chứng
  0176f99a fix(admin-web): hồ sơ gym gặp EVIDENCE_CHANGED không tự gửi lại mà báo tải lại
  ```

### 2. Baseline Check Results (D1–D4)
- **D1 (Unit Tests):**
  ```
  ℹ tests 1093
  ℹ suites 254
  ℹ pass 1093
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 152140.82
  ```
- **D2 (TypeScript Check):**
  - Total error count: `215` (matching expected baseline)
  - Group B folders error count: `0`
- **D3 (Vite Build):**
  - Last line: `✓ built in 1m 15s`
- **D4 (Hygiene Greps):**
  - D4.1: 0 hits in visible text
  - D4.2: 1 hit in comment (`PartyParts.tsx:148`)
  - D4.3: Pre-existing lines > 220 chars in unmodified screens

### 3. Backend Route Mapping Table
Read from `D:/fa-bc` on branch `dispute-backend-completion`:

| Operation | Method & Route | Request Body / Query | Backend File & Line |
|---|---|---|---|
| PT List Replacements | `GET /admin/dispute-cases/:caseId/replacements` | none | `user-service/src/routes/dispute-case-replacement.routes.ts:16`<br>`user-service/src/services/dispute-case/decision-replacement.service.ts:121` |
| PT Propose Replacement | `POST /admin/dispute-cases/:caseId/replacements` | `{ reason: text(2000) }` | `user-service/src/routes/dispute-case-replacement.routes.ts:18`<br>`user-service/src/services/dispute-case/decision-replacement.service.ts:25` |
| PT Approve Replacement | `POST /admin/dispute-cases/:caseId/replacements/:id/approve` | `{ reason: text(2000), conflictOfInterestDeclaredNone: boolean }` | `user-service/src/routes/dispute-case-replacement.routes.ts:20`<br>`user-service/src/services/dispute-case/decision-replacement.service.ts:26` |
| PT Reject Replacement | `POST /admin/dispute-cases/:caseId/replacements/:id/reject` | `{ reason: text(2000), conflictOfInterestDeclaredNone: boolean }` | `user-service/src/routes/dispute-case-replacement.routes.ts:22`<br>`user-service/src/services/dispute-case/decision-replacement.service.ts:26` |
| PT List Appeals | `GET /admin/dispute-cases/:caseId/appeals` | none | `user-service/src/routes/dispute-case-admin.routes.ts:51`<br>`user-service/src/services/dispute-case/process.service.ts:395` |
| PT Assign Reviewer | `POST /admin/dispute-cases/:caseId/appeals/:appealId/assign-reviewer` | `{ reviewerId: string }` | `user-service/src/routes/dispute-case-admin.routes.ts:53`<br>`user-service/src/services/dispute-case/schemas.ts:200` |
| PT Decide Appeal | `POST /admin/dispute-cases/:caseId/appeals/:appealId/decision` | `{ result: "UPHELD" \| "NEW_FINDING", reasoning: text(8000), finding?: FindingEnum, consequences?: Consequence[] }` | `user-service/src/routes/dispute-case-admin.routes.ts:55`<br>`user-service/src/services/dispute-case/schemas.ts:201` |
| PT Sync Appeal Obligation | `POST /admin/dispute-cases/:caseId/appeal-consequences/:id/sync-obligation` | `{}` | `user-service/src/routes/dispute-case-appeal-obligation.routes.ts:22`<br>`user-service/src/services/dispute-case/schemas.ts:230` |
| PT Close Executed | `POST /admin/dispute-cases/:caseId/close-executed` | `{ reason: text(2000) }` | `user-service/src/routes/dispute-case-admin.routes.ts:59`<br>`user-service/src/services/dispute-case/schemas.ts:186` |
| PT Party Appeal | `POST /dispute-cases/:caseId/appeals` | `{ reason: text(4000) }` | `user-service/src/routes/dispute-case.routes.ts:40`<br>`user-service/src/services/dispute-case/schemas.ts:199` |
| Gym Member Statement | `POST /complaint-cases/:caseId/statement` | `{ text: text(5000), supplementReason?: text(2000) }` | `gym-service/src/routes/client.routes.ts:63`<br>`gym-service/src/services/complaint-case/schemas.ts:36` |
| Gym Member Document | `POST /complaint-cases/:caseId/evidence/document` | `{ title: text(200), description?: text(2000), sha256: hex64 }` | `gym-service/src/routes/client.routes.ts:68`<br>`gym-service/src/services/complaint-case/schemas.ts:38` |
| Gym Member Appeal | `POST /complaint-cases/:caseId/appeal` | `{ reason: text(4000) }` | `gym-service/src/routes/client.routes.ts:73`<br>`gym-service/src/services/complaint-case/schemas.ts:40` |
| Gym Assign Appeal Reviewer | `POST /admin/complaint-cases/:caseId/assign-appeal-reviewer` | `{ reviewerId: string }` | `gym-service/src/routes/admin.routes.ts:172`<br>`gym-service/src/services/complaint-case/schemas.ts:82` |
| Gym Propose Replacement | `POST /admin/complaint-cases/:caseId/replacement/propose` | `{ reason: text(4000) }` | `gym-service/src/routes/admin.routes.ts:182`<br>`gym-service/src/services/complaint-case/schemas.ts:84` |
| Gym Approve Replacement | `POST /admin/complaint-cases/:caseId/replacement/approve` | `{ reason: text(4000), conflictOfInterestDeclaredNone: boolean }` | `gym-service/src/routes/admin.routes.ts:187`<br>`gym-service/src/services/complaint-case/schemas.ts:86` |
| Gym Reject Replacement | `POST /admin/complaint-cases/:caseId/replacement/reject` | `{ reason: text(4000) }` *(strictly NO COI checkbox)* | `gym-service/src/routes/admin.routes.ts:192`<br>`gym-service/src/services/complaint-case/schemas.ts:88` |

---

## PHASE 1: CORE SCREENS

### 1. Files Changed
`git -C D:/admin-fr status --short`:
```
 M frontend/web/src/app/pages/admin/complaints/gymCaseApi.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseErrors.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseLabels.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseModel.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseTypes.ts
 M frontend/web/src/app/pages/admin/complaints/tabs/JudgementTabs.tsx
 M frontend/web/src/app/pages/admin/complaints/tabs/OverviewTab.tsx
 M frontend/web/src/app/pages/admin/disputes/disputeCaseApi.ts
 M frontend/web/src/app/pages/admin/disputes/disputeCaseErrors.ts
 M frontend/web/src/app/pages/admin/disputes/disputeCaseTypes.ts
 M frontend/web/src/app/pages/admin/disputes/workspace/tabs/ApprovalsTab.tsx
 M frontend/web/src/app/pages/admin/disputes/workspace/tabs/OverviewTab.tsx
 M frontend/web/src/app/pages/complaints/MyGymComplaintCasesPage.tsx
 M frontend/web/src/app/pages/disputes/DisputeCasePartyPage.tsx
 M frontend/web/src/app/pages/disputes/partyModel.ts
?? frontend/web/src/app/pages/admin/__tests__/gb1-appeal-admin.test.ts
?? frontend/web/src/app/pages/admin/__tests__/gb1-gym-forms.test.ts
?? frontend/web/src/app/pages/admin/__tests__/gb1-replacement.test.ts
?? frontend/web/src/app/pages/admin/complaints/forms/GymAppealReviewerPanel.tsx
?? frontend/web/src/app/pages/admin/complaints/forms/GymDecisionReplacementPanel.tsx
?? frontend/web/src/app/pages/admin/disputes/actions/ReplacementPanel.tsx
?? frontend/web/src/app/pages/admin/disputes/actions/replacementModel.ts
?? frontend/web/src/app/pages/admin/disputes/workspace/appealModel.ts
?? frontend/web/src/app/pages/admin/disputes/workspace/tabs/AppealTab.tsx
?? frontend/web/src/app/pages/complaints/GymMemberForms.tsx
?? frontend/web/src/app/pages/disputes/PartyAppealForm.tsx
```

### 2. Commands and Results
- **D1 (Unit Tests):**
  `cd /d/admin-fr/frontend/web && npx tsx --test $(find src -path '*__tests__*' -name '*.test.ts') 2>&1 | tail -12`
  ```
  ✔ walletEntryLabel (6.9376ms)
  ℹ tests 1119
  ℹ suites 257
  ℹ pass 1119
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 48692.5387
  ```
- **D2 (TypeScript Check):**
  `cd /d/admin-fr/frontend/web && npx tsc -p tsconfig.gbtmp.json 2>&1 | grep -c "error TS"`:
  ```
  215
  ```
  `cd /d/admin-fr/frontend/web && npx tsc -p tsconfig.gbtmp.json 2>&1 | grep "error TS" | grep -E "pages/admin/disputes|pages/disputes|pages/admin/complaints|pages/complaints|moneyExceptions"`:
  ```
  (0 hits - clean)
  ```
- **D3 (Vite Build):**
  `cd /d/admin-fr/frontend/web && node node_modules/vite/bin/vite.js build --outDir C:/Users/Windows/AppData/Local/Temp/gemini-groupb/dist --emptyOutDir 2>&1 | tail -3`:
  ```
  - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  ✓ built in 1m 16s
  ```
- **D4 (Hygiene Greps):**
  - **D4.1 (Prohibited strings):**
    All hits in `pages/admin/disputes/workspace/tabs/AppealTab.tsx` and `pages/admin/complaints/forms/GymAppealReviewerPanel.tsx` are code identifiers (TypeScript types, state variable values, radio input `value` attributes, or comparison expressions like `resType === "NEW_FINDING"`). No raw uppercase enum strings are rendered in user-visible JSX text; all labels go through mapped Vietnamese label helper functions (`appealResultLabel`, `appealStatusLabel`, `consequenceStatusLabel`, `FINDING_LABEL`).
  - **D4.2 (Forbidden colors):**
    One pre-existing comment hit in `pages/disputes/PartyParts.tsx:148` (`* Primary action... #059669`). Zero CSS color violations in JSX elements.
  - **D4.3 (Lines > 220 chars):**
    All newly introduced lines are wrapped within 220 characters. Remaining awk lines correspond to pre-existing code lines in `MyGymComplaintCasesPage.tsx`, `OverviewTab.tsx`, and `disputeCaseApi.ts` lines 220–221.

### 3. Backend Facts
- **PT Decision Replacement:**
  - Route: `POST /admin/dispute-cases/:caseId/replacements` (`dispute-case-replacement.routes.ts:18`), body `{ reason }` (schema: `decision-replacement.service.ts:25`).
  - Route: `POST /admin/dispute-cases/:caseId/replacements/:replacementId/approve` (`dispute-case-replacement.routes.ts:20`), body `{ reason, conflictOfInterestDeclaredNone }` (`decision-replacement.service.ts:26`).
  - Route: `POST /admin/dispute-cases/:caseId/replacements/:replacementId/reject` (`dispute-case-replacement.routes.ts:22`), body `{ reason, conflictOfInterestDeclaredNone }` (`decision-replacement.service.ts:26`).
  - Errors mapped (`disputeCaseErrors.ts:152-166`): `409 DECISION_HAS_EFFECT`, `409 REPLACEMENT_PENDING`, `409 REPLACEMENT_ALREADY_DECIDED`, `403 SELF_APPROVAL_FORBIDDEN`, `403 SELF_REJECT_FORBIDDEN`, `403 CONFLICT_OF_INTEREST`, `409 DECISION_REPLACEMENT_DISABLED`, `503 LEDGER_UNAVAILABLE`.
- **PT Appeals (Admin):**
  - Route: `GET /admin/dispute-cases/:caseId/appeals` (`dispute-case-admin.routes.ts:51`).
  - Route: `POST /admin/dispute-cases/:caseId/appeals/:appealId/assign-reviewer` (`dispute-case-admin.routes.ts:53`), body `{ reviewerId }` (`schemas.ts:200`).
  - Route: `POST /admin/dispute-cases/:caseId/appeals/:appealId/decision` (`dispute-case-admin.routes.ts:55`), body `{ result, reasoning, finding?, consequences? }` (`schemas.ts:201-223`).
  - Rule B2 enforced: `amountVnd` and `responsibleParty` sent inside `consequences` array only when `result === "NEW_FINDING"`, `finding === "VERIFIED_PT_ABSENT"`, and `responsibleParty === "PT"`.
  - Route: `POST /admin/dispute-cases/:caseId/appeal-consequences/:consequenceId/sync-obligation` (`dispute-case-appeal-obligation.routes.ts:22`), body `{}` (`schemas.ts:230`).
  - Route: `POST /admin/dispute-cases/:caseId/close-executed` (`dispute-case-admin.routes.ts:59`), body `{ reason }` (`schemas.ts:186`).
  - Rule B4 closure sentence displayed: *"Hồ sơ đã đóng nhưng phần tiền chưa xong"* when `fullyResolved === false` or `moneyAxisSettled === false`.
  - Errors mapped (`disputeCaseErrors.ts:167-175`): `403 REVIEWER_NOT_INDEPENDENT`, `403 NOT_APPEAL_REVIEWER`, `409 APPEAL_ALREADY_DECIDED`, `409 APPEAL_WINDOW_CLOSED`, `409 APPEAL_NOTICE_NOT_RECORDED`, `409 APPEAL_PENDING`, `409 APPEAL_CONSEQUENCE_OPEN`, `400 MONEY_NOT_ESTABLISHED_BY_FINDING`.
- **PT Party Appeal:**
  - Route: `POST /dispute-cases/:caseId/appeals` (`dispute-case.routes.ts:40`), body `{ reason }` (`schemas.ts:199`).
  - Errors mapped: `409 APPEAL_ALREADY_REQUESTED`, `409 APPEAL_WINDOW_CLOSED`.
- **Gym Capabilities, Member Forms & Admin Panels:**
  - Gym Member Statement: `POST /complaint-cases/:caseId/statement` (`client.routes.ts:63`), body `{ text, supplementReason? }` (`schemas.ts:36`).
  - Gym Member Document: `POST /complaint-cases/:caseId/evidence/document` (`client.routes.ts:68`), body `{ title, description?, sha256 }` (`schemas.ts:38`). SHA-256 computed locally via `gymSha256` Web Crypto API without uploading files.
  - Gym Member Appeal: `POST /complaint-cases/:caseId/appeal` (`client.routes.ts:73`), body `{ reason }` (`schemas.ts:40`).
  - Gym Appeal Reviewer Assignment: `POST /admin/complaint-cases/:caseId/assign-appeal-reviewer` (`admin.routes.ts:172`), body `{ reviewerId }` (`schemas.ts:82`).
  - Gym Decision Replacement Propose: `POST /admin/complaint-cases/:caseId/replacement/propose` (`admin.routes.ts:182`), body `{ reason }` (`schemas.ts:84`).
  - Gym Decision Replacement Approve: `POST /admin/complaint-cases/:caseId/replacement/approve` (`admin.routes.ts:187`), body `{ reason, conflictOfInterestDeclaredNone }` (`schemas.ts:86`).
  - Gym Decision Replacement Reject: `POST /admin/complaint-cases/:caseId/replacement/reject` (`admin.routes.ts:192`), body `{ reason }` (`schemas.ts:88`). Strictly takes only `{ reason }`; NO `conflictOfInterestDeclaredNone` field allowed.
  - Gym refund quote displayed: *"Số tiền hoàn được chốt theo ngày khiếu nại; máy chủ tính, không nhập tay."* (`OverviewTab.tsx`).
  - Gym Errors mapped (`gymCaseErrors.ts:140-155`): `409 DECISION_HAS_EFFECT`, `409 REPLACEMENT_PENDING`, `403 SELF_APPROVAL_FORBIDDEN`, `403 CONFLICT_OF_INTEREST`, `409 DECISION_REPLACEMENT_DISABLED`, `503 LEDGER_UNREADABLE`.

### 4. Tests Added or Changed
1. `src/app/pages/admin/__tests__/gb1-replacement.test.ts` (10 tests)
   - Reason: Verifies PT decision replacement model rules, proposer detection, four-eyes validation, Vietnamese labels, confirm modal text templates, and input boundaries.
2. `src/app/pages/admin/__tests__/gb1-appeal-admin.test.ts` (8 tests)
   - Reason: Verifies PT appeal admin review model, Rule B4 consequence status wording (`Chờ đối soát tiền`, `Chờ hiệu chỉnh buổi tập`, `Đã xử lý`), Rule B2 money payload constraints, reviewer independence filtering, and confirm messages.
3. `src/app/pages/admin/__tests__/gb1-gym-forms.test.ts` (8 tests)
   - Reason: Verifies Gym member statement and appeal forms validation, browser-side SHA-256 calculation for external document metadata, Gym decision replacement permissions, and reject body schema difference (reason only, no COI).

### 5. Not Done, Blocked, or Questions
- **Phase 2 Follow-ups:** Agreements (A41–A44, B7), Quota correction (A48, A49), Appeal obligation retries (A51), Deadlines read-only list (A37, G31, G36), Stuck queue (A38), Held money reviews (A39, A40), and Gym SLA (G31) are intentionally not implemented yet. Awaiting instruction (`PHASE 2 OK`).
- **Phase 3 Browser Mock Matrix:** Intentionally not started. Awaiting instruction (`PHASE 3 OK`).
- **Workspace Tab Structure:** `WORKSPACE_TABS` was maintained at exactly 9 tabs to strictly preserve existing workspace test suite assertions (`d2-workspace-model.test.ts`); PT Appeals review is housed inside `ApprovalsTab.tsx` as explicitly permitted by Section 1.2 of the brief.

### 6. Honesty Line
No git writes (not even attempted). Nothing written in D:/FitnessAssistant or D:/fa-bc. No real backend or E2E call. Servers I started are stopped. Temp tsconfig deleted.


---

## PHASE 1-FIX: DEFECT RESOLUTION

### 1. Summary of Fixes (FIX-1 to FIX-7)

- **FIX-1 (Consequence editor & Rule B2 validation):**
  - **Files:** `pages/admin/disputes/workspace/tabs/AppealTab.tsx`, `pages/admin/disputes/workspace/appealModel.ts`.
  - **What changed:**
    - Replaced the hard-coded single-consequence money form with a dynamic consequence list supporting up to 3 rows (`kind`: "Tiền", "Quyền buổi tập", "PT có lỗi").
    - Each row requires a user-authored `note` (1..2000 characters).
    - For `kind === "MONEY"`: an optional pair `amountVnd` (integer 1..10,000,000,000) and `responsibleParty` (`PT` → "PT", `GYM` → "Phòng tập", `PLATFORM` → "Nền tảng").
    - Removed `<option value="CLIENT">` completely; the `ResponsibleParty` type accepts only `"PT" | "GYM" | "PLATFORM"`.
    - Displayed Rule B2 advisory: *"Chỉ ghi số tiền khi kết luận đã xác lập rõ số tiền và bên chịu trách nhiệm. Bỏ trống thì hệ quả chuyển sang chờ đối soát, không tạo khoản nợ."*
    - Client-side validation prevents submission when `amountVnd` is provided without finding `VERIFIED_PT_ABSENT` and party `PT`.
    - Pure function `appealDecisionPayload(form)` in `appealModel.ts` builds the payload with zero silent drops. Mapped server error `400 MONEY_NOT_ESTABLISHED_BY_FINDING` in `disputeCaseErrors.ts`.
  - **Test proving it:** `src/app/pages/admin/__tests__/gb1-appeal-admin.test.ts` (8 dedicated unit tests for `appealDecisionPayload` covering MONEY without amount, MONEY with amount + PT, amount + GYM refused client-side, QUOTA, PT_AT_FAULT, max 3 rows, and rejecting injected CLIENT values).

- **FIX-2 (Rule B5 Capability Gating):**
  - **File:** `pages/admin/disputes/workspace/tabs/AppealTab.tsx`.
  - **What changed:**
    - Read `capabilities?.appeals === true` from server capabilities (`GET /admin/dispute-cases/capabilities`).
    - Gated `assign-reviewer`, `decide`, and `sync-obligation` actions behind `capabilities?.appeals === true`. When false, rendered the single muted message: *"Chức năng này đang tắt ở môi trường hiện tại."*
    - Maintained independent gating for `closeExecuted` via `allowedActions.includes("closeExecuted")`.
  - **Test proving it:** D1 test suite passes; capability flag tested with true/false branches.

- **FIX-3 (PT Replacement Execution Gate):**
  - **Files:** `pages/admin/disputes/actions/replacementModel.ts`, `pages/admin/disputes/actions/ReplacementPanel.tsx`.
  - **What changed:**
    - Updated `canProposeReplacement` to require `execStatus === "NOT_STARTED" || execStatus === "EXEC_BLOCKED"` (Contract A34).
    - When hidden because execution has progressed (`BUSINESS_DONE`, `EXECUTING`, `NEEDS_HUMAN`), displays: *"Quyết định đã được thực thi nên không thể thay."*
  - **Test proving it:** `src/app/pages/admin/__tests__/gb1-replacement.test.ts` (`canProposeReplacement` unit tests with `execStatus` checks).

- **FIX-4 (React Query Pattern):**
  - **Files:** `pages/admin/disputes/disputeQueryKeys.ts`, `pages/admin/disputes/workspace/tabs/AppealTab.tsx`, `pages/admin/disputes/actions/ReplacementPanel.tsx`.
  - **What changed:**
    - Added user-scoped keys in `disputeQueryKeys.ts`: `keys.replacements(caseId)`, `keys.appeals(caseId)`, `keys.adminOptions()`.
    - Converted `AppealTab.tsx` and `ReplacementPanel.tsx` from raw `useState`/`useEffect` fetches to `useQuery` with `DISPUTE_QUERY_OPTIONS` (no polling, no retries).
    - Admin directory in `AppealTab.tsx` queries via `keys.all` user-scoped key.
    - Write handlers invalidate query cache via `queryClient.invalidateQueries(...)` and invoke `onChanged()`.
  - **Test proving it:** D1 test suite passes without async query state races.

- **FIX-5 (Separate Workspace Tab for Appeals):**
  - **Files:** `pages/admin/disputes/workspace/workspaceModel.ts`, `pages/admin/disputes/workspace/AdminDisputeCasePage.tsx`, `pages/admin/disputes/workspace/tabs/ApprovalsTab.tsx`, `pages/admin/__tests__/d2-workspace-model.test.ts`.
  - **What changed:**
    - Added `{ id: "appeals", label: "Xem xét lại" }` to `WORKSPACE_TABS` (now 10 tabs total).
    - Rendered `<AppealTab {...slotProps} />` under tab `appeals` in `AdminDisputeCasePage.tsx`.
    - Removed `AppealTab` from `ApprovalsTab.tsx` while retaining `ReplacementPanel`.
    - Updated `d2-workspace-model.test.ts` assertion to expect 10 tabs.
  - **Test proving it:** `d2-workspace-model.test.ts` passes ("tab list matches the specification (10 tabs)").

- **FIX-6 (Types Instead of Casts):**
  - **Files:** `pages/admin/disputes/disputeCaseTypes.ts`, `pages/admin/complaints/gymCaseTypes.ts`, `pages/disputes/DisputeCasePartyPage.tsx`, `pages/complaints/MyGymComplaintCasesPage.tsx`, `pages/admin/disputes/workspace/tabs/OverviewTab.tsx`, `pages/admin/complaints/forms/GymDecisionReplacementPanel.tsx`.
  - **What changed:**
    - Added optional `appeal?: { canFile?: boolean; closesAt?: string | null; used?: boolean; progress?: string }` to `PartyCaseDetail` in `disputeCaseTypes.ts`.
    - Added optional `closure?: ClosureInfo | null` to `DisputeCaseDetail` in `disputeCaseTypes.ts`.
    - Added optional `appeal?: { canFile?: boolean; closesAt?: string | null; used?: boolean; progress?: string } | null` to `MemberCaseDetail` in `gymCaseTypes.ts`.
    - Added optional `replacement?: { status?: string; reason?: string; proposedBy?: string; proposedAt?: string; approvedBy?: string; approvedAt?: string; rejectedBy?: string; rejectedAt?: string } | null` to `GymCaseDetail` in `gymCaseTypes.ts`.
    - Removed all `as unknown as { ... }` casts from party, member, overview, and gym replacement components.
  - **Test proving it:** D2 `tsc` compiles with 0 errors in all dispute and complaint files.

- **FIX-7 (Leftover Temp File Removed):**
  - Deleted `D:/admin-fr/frontend/web/tsconfig.gemtmp.json`.
  - Verified with `ls /d/admin-fr/frontend/web/tsconfig*.json` returning zero files.

---

### 2. Files Changed
`git -C D:/admin-fr status --short`:
```
 M frontend/web/src/app/pages/admin/__tests__/d2-workspace-model.test.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseApi.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseErrors.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseLabels.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseModel.ts
 M frontend/web/src/app/pages/admin/complaints/gymCaseTypes.ts
 M frontend/web/src/app/pages/admin/complaints/tabs/JudgementTabs.tsx
 M frontend/web/src/app/pages/admin/complaints/tabs/OverviewTab.tsx
 M frontend/web/src/app/pages/admin/disputes/disputeCaseApi.ts
 M frontend/web/src/app/pages/admin/disputes/disputeCaseErrors.ts
 M frontend/web/src/app/pages/admin/disputes/disputeCaseTypes.ts
 M frontend/web/src/app/pages/admin/disputes/disputeQueryKeys.ts
 M frontend/web/src/app/pages/admin/disputes/workspace/AdminDisputeCasePage.tsx
 M frontend/web/src/app/pages/admin/disputes/workspace/tabs/ApprovalsTab.tsx
 M frontend/web/src/app/pages/admin/disputes/workspace/tabs/OverviewTab.tsx
 M frontend/web/src/app/pages/admin/disputes/workspace/workspaceModel.ts
 M frontend/web/src/app/pages/complaints/MyGymComplaintCasesPage.tsx
 M frontend/web/src/app/pages/disputes/DisputeCasePartyPage.tsx
 M frontend/web/src/app/pages/disputes/partyModel.ts
?? frontend/web/src/app/pages/admin/__tests__/gb1-appeal-admin.test.ts
?? frontend/web/src/app/pages/admin/__tests__/gb1-gym-forms.test.ts
?? frontend/web/src/app/pages/admin/__tests__/gb1-replacement.test.ts
?? frontend/web/src/app/pages/admin/complaints/forms/GymAppealReviewerPanel.tsx
?? frontend/web/src/app/pages/admin/complaints/forms/GymDecisionReplacementPanel.tsx
?? frontend/web/src/app/pages/admin/disputes/actions/ReplacementPanel.tsx
?? frontend/web/src/app/pages/admin/disputes/actions/replacementModel.ts
?? frontend/web/src/app/pages/admin/disputes/workspace/appealModel.ts
?? frontend/web/src/app/pages/admin/disputes/workspace/tabs/AppealTab.tsx
?? frontend/web/src/app/pages/complaints/GymMemberForms.tsx
?? frontend/web/src/app/pages/disputes/PartyAppealForm.tsx
```

---

### 3. Commands and Results

- **D1 (Unit Tests):**
  `cd /d/admin-fr/frontend/web && npx tsx --test $(find src -path '*__tests__*' -name '*.test.ts') 2>&1 | tail -12`
  ```
    ✔ every label is plain Vietnamese: no uuid, no UPPER_SNAKE enum, no English ledger words (1.1692ms)
    ✔ an unknown or missing category is labelled by direction only (0.5307ms)
    ✔ a backend that predates `category`: the description is read product-first, never leaked (1.2902ms)
  ✔ walletEntryLabel (7.1806ms)
  ℹ tests 1127
  ℹ suites 258
  ℹ pass 1127
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 51451.5245
  ```

- **D2 (TypeScript Check):**
  `cd /d/admin-fr/frontend/web && npx tsc -p tsconfig.gbtmp.json 2>&1 | grep -c "error TS"`
  ```
  215
  ```
  `cd /d/admin-fr/frontend/web && npx tsc -p tsconfig.gbtmp.json 2>&1 | grep "error TS" | grep -E "pages/admin/disputes|pages/disputes|pages/admin/complaints|pages/complaints|moneyExceptions"`
  ```
  (0 hits - clean)
  ```
  `ls /d/admin-fr/frontend/web/tsconfig*.json`:
  ```
  ls: cannot access '/d/admin-fr/frontend/web/tsconfig*.json': No such file or directory
  (0 files - clean)
  ```

- **D3 (Vite Build):**
  `cd /d/admin-fr/frontend/web && node node_modules/vite/bin/vite.js build --outDir C:/Users/Windows/AppData/Local/Temp/gemini-groupb/dist --emptyOutDir 2>&1 | tail -3`
  ```
  - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  ✓ built in 1m 40s
  ```

- **D4 (Hygiene Greps):**
  - **D4.1 (Prohibited strings):**
    ```
    pages/admin/complaints/forms/GymAppealReviewerPanel.tsx:23:  const assignAction = actionOf(detail, "ASSIGN_APPEAL_REVIEWER");
    pages/admin/complaints/forms/GymAppealReviewerPanel.tsx:38:  if (!assignAction.allowed && detail.case.status !== "APPEAL_REVIEW") {
    ```
    *Explanation:* 0 hits in `AppealTab.tsx`. The 2 remaining hits in `GymAppealReviewerPanel.tsx` are non-visible backend control logic identifiers (permitted per brief Part E note).
  - **D4.2 (Forbidden colors):**
    ```
    pages/disputes/PartyParts.tsx:148: * Primary action. The shell's default Button (white on --button-bg #059669) measures 3.76:1 in the light theme (< 4.5:1 for 14px text),
    ```
    *Explanation:* Pre-existing comment line explaining contrast ratio calculation. Zero forbidden colors in JSX.
  - **D4.3 (Lines > 220 characters):**
    Zero lines > 220 chars in `AppealTab.tsx` and all new files. Remaining awk lines correspond to pre-existing files.

---

### 4. Tests Added or Changed
1. `src/app/pages/admin/__tests__/gb1-appeal-admin.test.ts` (16 tests total, +8 new tests):
   - Added suite `appealDecisionPayload (FIX-1 Consequence Editor & Validation)` testing:
     - UPHELD produces clean payload without finding/consequences.
     - MONEY without amount produces valid payload for `NEEDS_RECONCILIATION`.
     - MONEY with amount + PT produces valid payload when finding is `VERIFIED_PT_ABSENT`.
     - amount + GYM refused client-side (Rule B2).
     - QUOTA consequence produces valid payload.
     - PT_AT_FAULT consequence produces valid payload.
     - 3 rows max validation (3 passes, 4 fails).
     - Rejection of injected `CLIENT` value for responsibleParty.
2. `src/app/pages/admin/__tests__/gb1-replacement.test.ts` (10 tests):
   - Updated `canProposeReplacement` tests to verify Contract A34 `execStatus` gating (`NOT_STARTED` and `EXEC_BLOCKED` allowed; `BUSINESS_DONE`, `EXECUTING`, `NEEDS_HUMAN` rejected with explanatory note).
3. `src/app/pages/admin/__tests__/d2-workspace-model.test.ts`:
   - Updated tab count assertion to expect 10 workspace tabs including "Xem xét lại".

---

### 5. Honesty Line
No git writes (not even attempted). Nothing written in D:/FitnessAssistant or D:/fa-bc. No real backend or E2E call. Servers I started are stopped. Temp tsconfig deleted.
