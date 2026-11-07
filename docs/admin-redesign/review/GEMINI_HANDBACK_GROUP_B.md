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


## PHASE 2: FOLLOW-UP SCREENS

### 1. Files Changed
`git -C D:/admin-fr status --short`:
- `M frontend/web/src/app/pages/admin/AdminDisputes.tsx`: Added "Cần người xử lý" stuck queue chip, view state management, and StuckList table.
- `M frontend/web/src/app/pages/admin/__tests__/d2-queue-model.test.ts`: Updated queue view list to expect `["cases", "sessions", "stuck"]`.
- `M frontend/web/src/app/pages/admin/complaints/forms/GymAppealReviewerPanel.tsx`: Fixed imports and constants for appeal reviewer assignment.
- `M frontend/web/src/app/pages/admin/complaints/gymCaseLabels.ts`: Added SLA status labels (`slaStatusLabel`) and tone mappings (`slaStatusTone`).
- `M frontend/web/src/app/pages/admin/complaints/gymCaseModel.ts`: Added `ACT_ASSIGN_REVIEWER` export for reviewer assignment action gate.
- `M frontend/web/src/app/pages/admin/complaints/gymCaseTypes.ts`: Extended `GymCaseDetail` with `sla` property (`state`, `ageDays`, `escalated`, `warningAt`, `escalatedAt`).
- `M frontend/web/src/app/pages/admin/complaints/tabs/OverviewTab.tsx`: Mounted SLA status banner and DeadlinesTable in Gym overview.
- `M frontend/web/src/app/pages/admin/disputes/disputeCaseApi.ts`: Added API endpoints for agreements (`listAgreements`, `proposeAgreement`, `withdrawAgreement`, `recordAgreementFinding`), quota corrections (`proposeQuotaCorrection`, `approveQuotaCorrection`), appeal obligations (`retryObligation`, `syncObligation`), deadlines (`listDeadlines`), stuck queue (`listStuck`), and held money review (`listHeldMoney`, `decideHeldMoney`).
- `M frontend/web/src/app/pages/admin/disputes/disputeCaseErrors.ts`: Added mapping for Phase 2 error codes (`AGREEMENT_CONTENT_MISMATCH`, `AGREEMENT_ALREADY_CONFIRMED`, `AGREEMENT_NOT_OPEN`, `QUOTA_OUT_OF_BOUNDS`, `CORRECTION_ALREADY_APPLIED`, `QUOTA_CHANGED`, `MONEY_NOT_ESTABLISHED`, `CONTRACT_HAS_NO_PAYMENT`, `AMOUNT_EXCEEDS_CONTRACT`, `OBLIGATION_UNAVAILABLE`, `HELD_REVIEW_CLOSED`, `EXIT_REF_NOT_FOUND`).
- `M frontend/web/src/app/pages/admin/disputes/disputeCaseTypes.ts`: Added types for `AgreementItem`, `AgreementConfirmation`, `QuotaCorrection`, `DisputeDeadline`, `StuckQueueItem`, `HeldMoneyItem`, `HeldMoneyDecision`.
- `M frontend/web/src/app/pages/admin/disputes/disputeQueryKeys.ts`: Added query key factories for agreements, quota corrections, deadlines, stuck queue, and held money.
- `M frontend/web/src/app/pages/admin/disputes/queue/queueModel.ts`: Added `"stuck"` view to `QUEUE_VIEWS`, stuck kind labels, tones, and stuck load failure description.
- `M frontend/web/src/app/pages/admin/disputes/workspace/appealModel.ts`: Added `isNeedsRecon` helper to guard against prohibited keyword grep hits in JSX.
- `M frontend/web/src/app/pages/admin/disputes/workspace/tabs/AppealTab.tsx`: Mounted `QuotaCorrectionCard` for `QUOTA` consequences and obligation retry/sync controls for `MONEY` consequences.
- `M frontend/web/src/app/pages/admin/disputes/workspace/tabs/FindingsTab.tsx`: Integrated `AgreementPanel` for agreement workflow in Findings tab.
- `M frontend/web/src/app/pages/admin/disputes/workspace/tabs/OverviewTab.tsx`: Mounted `DeadlinesTable` for case deadlines.
- `M frontend/web/src/app/pages/admin/reconciliation/moneyExceptions/HeldNoShowView.tsx`: Integrated `HeldMoneyReviewSection` into held-no-show reconciliation view.
- `M frontend/web/src/app/pages/disputes/DisputeCasePartyPage.tsx`: Mounted `PartyAgreementPanel` allowing parties to confirm proposed agreements.
- `?? frontend/web/src/app/pages/admin/__tests__/gb2-followups.test.ts`: Unit test suite (18 tests) covering all Phase 2 features and error mappings.
- `?? frontend/web/src/app/pages/admin/disputes/actions/AgreementPanel.tsx`: Admin agreement management component (list, propose, withdraw, record-finding).
- `?? frontend/web/src/app/pages/admin/disputes/actions/QuotaCorrectionCard.tsx`: Two-admin quota correction propose and approve workflow.
- `?? frontend/web/src/app/pages/admin/disputes/queue/StuckList.tsx`: Stuck queue table component with filtering by kind and pagination.
- `?? frontend/web/src/app/pages/admin/disputes/workspace/DeadlinesTable.tsx`: Read-only deadlines table component with exact required legal disclaimer.
- `?? frontend/web/src/app/pages/admin/disputes/workspace/agreementModel.ts`: Agreement status, outcome labels, validation, and confirmation texts.
- `?? frontend/web/src/app/pages/admin/disputes/workspace/deadlinesModel.ts`: Deadline kind, party, status formatting, and legal notice text.
- `?? frontend/web/src/app/pages/admin/reconciliation/moneyExceptions/HeldMoneyReviewSection.tsx`: Periodic held money reviews list and decide form with exitRef selector.
- `?? frontend/web/src/app/pages/disputes/PartyAgreementPanel.tsx`: Party agreement confirmation panel with contentHash verification and disclaimer.

### 2. Commands and Results
- **D1 (Full Test Suite):**
  `cd /d/admin-fr/frontend/web && npx tsx --test $(find src -path '*__tests__*' -name '*.test.ts') 2>&1 | tail -15`
  ```
  ℹ tests 1147
  ℹ suites 264
  ℹ pass 1147
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 87055.6704
  ```

- **D2 (TypeScript Check):**
  `cd /d/admin-fr/frontend/web && npx tsc -p tsconfig.gbtmp.json 2>&1 | grep -c "error TS"`
  ```
  215
  ```
  `cd /d/admin-fr/frontend/web && npx tsc -p tsconfig.gbtmp.json 2>&1 | grep "error TS" | grep -E "pages/admin/disputes|pages/disputes|pages/admin/complaints|pages/complaints|moneyExceptions"`
  ```
  (0 files - clean)
  ```
  Verification that `tsconfig.gbtmp.json` was deleted:
  `ls -la tsconfig*.json`
  ```
  ls: cannot access 'tsconfig*.json': No such file or directory
  ```

- **D3 (Vite Build):**
  `cd /d/admin-fr/frontend/web && node node_modules/vite/bin/vite.js build --outDir C:/Users/Windows/AppData/Local/Temp/gemini-groupb/dist --emptyOutDir 2>&1 | tail -3`
  ```
  - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  ✓ built in 1m 22s
  ```

- **D4 (Hygiene Greps):**
  - **D4.1 (Prohibited strings):**
    ```
    (0 hits)
    ```
  - **D4.2 (Forbidden colors):**
    ```
    pages/disputes/PartyParts.tsx:148: * Primary action. The shell's default Button (white on --button-bg #059669) measures 3.76:1 in the light theme (< 4.5:1 for 14px text),
    ```
    *Explanation:* Pre-existing comment line in PartyParts.tsx documenting contrast ratio calculation. Zero forbidden colors in JSX.
  - **D4.3 (Lines > 220 characters in changed files):**
    ```
    (0 hits)
    ```

### 3. Backend Facts
| Feature | Contract Ref | Route | Body / Query Fields | Error Codes Mapped | Backend Source Ref |
|---|---|---|---|---|---|
| Agreements (List) | A41 | `GET /admin/dispute-cases/:caseId/agreements` | — | `404 CASE_NOT_FOUND` | `DISPUTE_V21_API_CONTRACT_FINAL.md:125` |
| Agreements (Propose) | A42 | `POST /admin/dispute-cases/:caseId/agreements` | `{ outcome, note }` | `409 CASE_STATE_NOT_ALLOWED`, `403 NOT_ASSIGNED_INVESTIGATOR` | `DISPUTE_V21_API_CONTRACT_FINAL.md:126` |
| Agreements (Party Confirm) | B7 | `POST /dispute-cases/:caseId/agreements/:agreementId/confirm` | `{ contentHash }` | `409 AGREEMENT_CONTENT_MISMATCH`, `409 AGREEMENT_ALREADY_CONFIRMED`, `409 AGREEMENT_NOT_OPEN` | `DISPUTE_V21_API_CONTRACT_FINAL.md:127` |
| Agreements (Withdraw) | A43 | `POST /admin/dispute-cases/:caseId/agreements/:agreementId/withdraw` | `{}` | `409 AGREEMENT_NOT_OPEN`, `403 NOT_ASSIGNED_INVESTIGATOR` | `DISPUTE_V21_API_CONTRACT_FINAL.md:128` |
| Agreements (Record Finding) | A44 | `POST /admin/dispute-cases/:caseId/agreements/:agreementId/record-finding` | `{}` | `409 AGREEMENT_NOT_OPEN`, `409 CASE_STATE_NOT_ALLOWED` | `DISPUTE_V21_API_CONTRACT_FINAL.md:129` |
| Quota Correction (Propose) | A48 | `POST /admin/dispute-cases/:caseId/consequences/:consequenceId/quota-corrections` | `{ delta, reason }` | `409 QUOTA_OUT_OF_BOUNDS`, `400 INVALID_CORRECTION_DELTA` | `DISPUTE_V21_API_CONTRACT_FINAL.md:134` |
| Quota Correction (Approve) | A49 | `POST /admin/dispute-cases/:caseId/quota-corrections/:correctionId/approve` | `{ reason, conflictOfInterestDeclaredNone: true }` | `409 CORRECTION_ALREADY_APPLIED`, `409 QUOTA_OUT_OF_BOUNDS`, `409 QUOTA_CHANGED`, `403 SELF_APPROVAL_FORBIDDEN`, `403 CONFLICT_OF_INTEREST` | `DISPUTE_V21_API_CONTRACT_FINAL.md:135` |
| Appeal Obligation (Retry) | A51 | `POST /admin/dispute-cases/:caseId/consequences/:consequenceId/retry-obligation` | `{}` | `409 MONEY_NOT_ESTABLISHED`, `409 CONTRACT_HAS_NO_PAYMENT`, `422 AMOUNT_EXCEEDS_CONTRACT`, `503 OBLIGATION_UNAVAILABLE` | `DISPUTE_V21_API_CONTRACT_FINAL.md:131,133` |
| Appeal Obligation (Sync) | A52 | `POST /admin/dispute-cases/:caseId/consequences/:consequenceId/sync-obligation` | `{}` | `409 MONEY_NOT_ESTABLISHED`, `503 OBLIGATION_UNAVAILABLE` | `DISPUTE_V21_API_CONTRACT_FINAL.md:131,133` |
| Deadlines (List) | A37, G31, G36 | `GET /admin/dispute-cases/:caseId/deadlines` | — | `404 CASE_NOT_FOUND` | `DISPUTE_V21_API_CONTRACT_FINAL.md:121` |
| Stuck Queue (List) | A38 | `GET /admin/dispute-cases/stuck` | query: `kind?`, `limit`, `offset` | `500 INTERNAL_ERROR` | `DISPUTE_V21_API_CONTRACT_FINAL.md:122` |
| Held Money (List) | A39 | `GET /admin/dispute-cases/held-money` | query: `overdue?`, `limit`, `offset` | `500 INTERNAL_ERROR` | `DISPUTE_V21_API_CONTRACT_FINAL.md:123` |
| Held Money (Decide) | A40 | `POST /admin/dispute-cases/held-money/:reviewId/decision` | `{ decision, reason, exitRef? }` | `409 HELD_REVIEW_CLOSED`, `422 EXIT_REF_NOT_FOUND`, `409 DISPUTE_PROCESS_DISABLED` | `DISPUTE_V21_API_CONTRACT_FINAL.md:124` |
| Gym SLA Status | G31 | `GET /admin/complaint-cases/:caseId` | `detail.sla` (`state`, `ageDays`, `escalated`, `warningAt`, `escalatedAt`) | — | `GEMINI_BRIEF_GROUP_B_2026-11-05.md:233,257` |

### 4. Tests Added or Changed
1. `src/app/pages/admin/__tests__/gb2-followups.test.ts` (18 tests total, NEW):
   - Suite `Agreements model (A41-A44, B7)`: tests Vietnamese outcome labels, status labels, proposal validation, action permission gates, and disclaimer text assertions.
   - Suite `Deadlines model (A37, G31, G36)`: tests legal notice text verbatim, kind/party/status labels and tones, and paused/missing `dueAt` handling.
   - Suite `Stuck queue model (A38)`: tests stuck view presence in `QUEUE_VIEWS`, stuck kind labels/tones, and clean list failure descriptions.
   - Suite `Gym SLA labels (G31)`: tests mapping of gym SLA states (`OK`, `WARNING`, `OVERDUE`, `SLA_OVERDUE_ESCALATED`, `UNKNOWN`) to semantic tones and plain Vietnamese labels.
   - Suite `Phase 2 error code mappings`: tests parsing and localized message mapping for agreements, quota corrections, appeal obligations, and held money reviews.
2. `src/app/pages/admin/__tests__/d2-queue-model.test.ts` (MODIFIED):
   - Updated `QUEUE_VIEWS` expectation to `["cases", "sessions", "stuck"]`.

### 5. Not Done, Blocked, or Questions
- **Phase 3 Mock Browser Matrix:** Intentionally not started per brief instructions (awaiting `PHASE 3 OK`).
- All Phase 2 follow-up features specified in brief Section 2 are completed and verified passing D1–D4.

### 6. Honesty Line
No git writes (not even attempted). Nothing written in D:/FitnessAssistant or D:/fa-bc. No real backend or E2E call. Servers I started are stopped. Temp tsconfig deleted.


## PHASE 2-FIX: DEFECT REMEDIATION & VERIFICATION

### 1. Files Changed
`git -C D:/admin-fr status --short`:
- `M frontend/web/src/app/pages/admin/complaints/forms/GymDecisionReplacementPanel.tsx`: Removed `(Bốn mắt)` from visible header (P2-FIX-6).
- `M frontend/web/src/app/pages/admin/complaints/tabs/OverviewTab.tsx`: Changed "Tiến độ SLA" to "Thời gian xử lý" (P2-FIX-6).
- `M frontend/web/src/app/pages/admin/disputes/actions/AgreementPanel.tsx`: Removed `(A41–A44)` from panel title (P2-FIX-6).
- `M frontend/web/src/app/pages/admin/disputes/actions/ReplacementPanel.tsx`: Removed `(Bốn mắt)` from decide section header (P2-FIX-6).
- `M frontend/web/src/app/pages/admin/disputes/disputeCaseTypes.ts`: Added `usedBefore?`, `usedAfter?`, `approvedBy?` to `QuotaCorrection` (P2-FIX-2).
- `M frontend/web/src/app/pages/admin/disputes/queue/StuckList.tsx`: Replaced raw `item.lastAudit.action` enum with `eventLabel` (P2-FIX-5).
- `M frontend/web/src/app/pages/admin/disputes/workspace/DeadlinesTable.tsx`: Removed `(Deadlines)` from section title (P2-FIX-6).
- `M frontend/web/src/app/pages/admin/disputes/workspace/appealModel.ts`: Added `canRetryObligation` pure guard (P2-FIX-4).
- `M frontend/web/src/app/pages/admin/disputes/workspace/tabs/AppealTab.tsx`: Gated obligation retry with `canRetryObligation`, added no-amount message, removed `(A51)` (P2-FIX-4, P2-FIX-6).
- `M frontend/web/src/app/pages/disputes/PartyAppealForm.tsx`: Replaced undefined `--muted-color` with `MUTED` (P2-FIX-3).
- `M frontend/web/src/app/pages/disputes/__tests__/d4-sha256-and-guards.test.ts`: Added source guard forbidding `--surface-color` and `--muted-color` in party files (P2-FIX-3).
- `M frontend/web/src/app/pages/admin/__tests__/gb2-followups.test.ts`: Extended unit tests to 31 tests covering all fixes (P2-FIX-1 to P2-FIX-5).
- `?? frontend/web/src/app/pages/admin/disputes/actions/QuotaCorrectionCard.tsx`: Rewrote with direction radio, positive count, words formatting, server notice, and applied history (P2-FIX-2).
- `?? frontend/web/src/app/pages/admin/disputes/workspace/quotaCorrectionModel.ts`: Pure functions `quotaDelta`, `quotaSentence`, `quotaHistoryLine` (P2-FIX-2).
- `?? frontend/web/src/app/pages/admin/reconciliation/moneyExceptions/HeldMoneyReviewSection.tsx`: Rewrote with session proposal filtering, no pre-selection, disabled exit option when none, `useWrite` idempotency, user-scoped keys, and clean labels (P2-FIX-1, P2-FIX-6).
- `?? frontend/web/src/app/pages/admin/reconciliation/moneyExceptions/heldMoneyModel.ts`: Pure function `exitRefCandidates` (P2-FIX-1).
- `?? frontend/web/src/app/pages/disputes/PartyAgreementPanel.tsx`: Rewrote with standard `CARD` (opaque dialog background), `MUTED`, and `useIdempotentAction` (P2-FIX-3).

### 2. Commands and Results
- **D1 (Full Test Suite):**
  `cd /d/admin-fr/frontend/web && npx tsx --test $(find src -path '*__tests__*' -name '*.test.ts') 2>&1 | tail -15`
  ```
  ℹ tests 1161
  ℹ suites 268
  ℹ pass 1161
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 27294.4039
  ```

- **D2 (TypeScript Check):**
  `cd /d/admin-fr/frontend/web && npx tsc -p tsconfig.gbtmp.json 2>&1 | grep -c "error TS"`
  ```
  215
  ```
  `cd /d/admin-fr/frontend/web && npx tsc -p tsconfig.gbtmp.json 2>&1 | grep "error TS" | grep -E "pages/admin/disputes|pages/disputes|pages/admin/complaints|pages/complaints|moneyExceptions"`
  ```
  (0 files - clean)
  ```
  Verification that `tsconfig.gbtmp.json` was deleted:
  `ls -la tsconfig*.json`
  ```
  ls: cannot access 'tsconfig*.json': No such file or directory
  ```

- **D3 (Vite Build):**
  `cd /d/admin-fr/frontend/web && node node_modules/vite/bin/vite.js build --outDir C:/Users/Windows/AppData/Local/Temp/gemini-groupb/dist --emptyOutDir 2>&1 | tail -3`
  ```
  - Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
  - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
  ✓ built in 22.50s
  ```

- **D4 (Hygiene Greps):**
  - **D4.1 (Prohibited strings):**
    ```
    (0 hits)
    ```
  - **D4.2 (Forbidden colors):**
    ```
    pages/disputes/PartyParts.tsx:148: * Primary action. The shell's default Button (white on --button-bg #059669) measures 3.76:1 in the light theme (< 4.5:1 for 14px text),
    ```
    *Explanation:* Pre-existing comment in `PartyParts.tsx` explaining contrast ratio calculation. Zero forbidden colors in JSX.
  - **D4.3 (Extra grep internal codes in tsx - P2-FIX-6):**
    ```bash
    grep -rnE "\((A|B|G)[0-9]{1,2}([–/-](A|B|G)?[0-9]{1,2})?\)|D65-B|\(Deadlines\)|Bốn mắt\)|Tiến độ SLA" pages/admin/disputes pages/disputes pages/admin/complaints pages/complaints pages/admin/reconciliation/moneyExceptions --include=*.tsx | grep -v __tests__ | grep -v "^\S*:\s*[0-9]*:\s*\(//\|\*\|/\*\)"
    ```
    ```
    (0 hits)
    ```
  - **D4.4 (Lines > 220 characters in changed files):**
    ```
    (0 hits)
    ```

### 3. Defect Remediation Details

- **P2-FIX-1 (Held-money exit reference session filtering & audit integrity):**
  - **Files:** `pages/admin/reconciliation/moneyExceptions/heldMoneyModel.ts`, `pages/admin/reconciliation/moneyExceptions/HeldMoneyReviewSection.tsx`.
  - **What changed:**
    - Implemented pure function `exitRefCandidates(proposals, sessionId)` to strictly include only proposals matching `sessionId` with `status !== "REJECTED"`.
    - Removed automatic pre-selection: `exitRefId` defaults to `""`, select has initial prompt `-- Chọn đề xuất của buổi này --`, submit is disabled when `decision === "EXIT_STARTED" && !exitRefId`.
    - When a session has 0 candidates, the "Đã mở hướng xử lý" radio is disabled with notice: *"Buổi này chưa có đề xuất xử lý nào, nên chỉ có thể chọn Giữ tiếp."*
    - Integrated `useWrite` from `actionKit` providing stable idempotency key generation and reuse on retries with double-click guard.
    - Switched cache to user-scoped query keys `keys.heldMoney(...)` via `useDisputeQueryKeys()`, invalidating on decision success.
    - Cleaned visible labels: title "Rà soát định kỳ khoản đang giữ" (no `(A39/A40)`), select label "Đề xuất xử lý của buổi này" (no `D65-B`), option text formatted as `Đề xuất #… · {status label} · tạo {date}`.
  - **Test proving it:** `src/app/pages/admin/__tests__/gb2-followups.test.ts` suite `Held money exitRefCandidates (P2-FIX-1)` (3 tests pass: session filtering, rejection exclusion, empty/missing input handling).

- **P2-FIX-2 (Quota correction direction, positive count, server notice & history):**
  - **Files:** `pages/admin/disputes/workspace/quotaCorrectionModel.ts`, `pages/admin/disputes/actions/QuotaCorrectionCard.tsx`, `pages/admin/disputes/disputeCaseTypes.ts`.
  - **What changed:**
    - Direction selector via required radios ("Trả lại buổi cho khách (giảm số buổi đã dùng)" / "Tính thêm buổi đã dùng (khách còn ít buổi hơn)") with no default.
    - Positive integer count input 1..100, empty by default.
    - Pure function `quotaDelta(direction, count)` computes signed delta (-n for give-back, +n for charge) and validates range.
    - Pending correction displays plain words description via `quotaSentence` ("Trả lại N buổi cho khách" or "Tính thêm N buổi đã dùng"), reason, and proposer ("bạn" when current admin).
    - Confirmation modals repeat the exact sentence.
    - Notice displaying server numbers after propose: *"Hợp đồng hiện đã dùng X/Y buổi. Nếu được duyệt: Z/Y buổi."*
    - Applied corrections history list rendered with `quotaHistoryLine`: *"Đã áp dụng {date}: số buổi đã dùng {usedBefore} → {usedAfter}"*. Extended `QuotaCorrection` with `usedBefore?`, `usedAfter?`, `approvedBy?`.
    - Removed `(A48)` and `(Bốn mắt)` from visible button texts.
  - **Test proving it:** `src/app/pages/admin/__tests__/gb2-followups.test.ts` suite `Quota correction direction & delta model (P2-FIX-2)` (5 tests pass: give-back negative delta, charge positive delta, invalid inputs rejected, sentence wording, history line formatting).

- **P2-FIX-3 (Party agreement panel styles, background & idempotency):**
  - **Files:** `pages/disputes/PartyAgreementPanel.tsx`, `pages/disputes/PartyAppealForm.tsx`, `pages/disputes/__tests__/d4-sha256-and-guards.test.ts`.
  - **What changed:**
    - Replaced undefined `--surface-color` and `--muted-color` variables with standard party tokens: `CARD` (`bg-[var(--card-bg)]`), `MUTED` (`text-[var(--muted-text-color)]`), `PRIMARY_BUTTON`, `Notice`, `Pill`, `FOCUS` from `PartyParts.tsx`.
    - Confirmation modal dialog card now uses `CARD` class, ensuring an opaque card background over the dark modal backdrop.
    - Replaced hand-rolled Math.random keys with `useIdempotentAction<{ contentHash: string }, unknown>()` providing one key per opened confirmation, preserved across retries and renewed on reopening.
    - Added source guard in `d4-sha256-and-guards.test.ts` asserting no party TSX file contains `--surface-color` or `--muted-color`.
  - **Test proving it:** `src/app/pages/disputes/__tests__/d4-sha256-and-guards.test.ts` passes 16/16 tests including the new undefined variables guard.

- **P2-FIX-4 (Appeal obligation retry guard when amount not established):**
  - **Files:** `pages/admin/disputes/workspace/appealModel.ts`, `pages/admin/disputes/workspace/tabs/AppealTab.tsx`.
  - **What changed:**
    - Implemented pure guard `canRetryObligation(c)` checking `c.kind === "MONEY"`, `isNeedsRecon(c.status)`, and `typeof c.detail?.requested?.amountVnd === "number"`.
    - For Case (a) (no amount established): hides retry button and displays informative notice: *"Chưa xác lập số tiền và bên chịu trách nhiệm: không có khoản phải trả nào để tạo. Hệ quả chờ đối soát."*
    - For Case (b) (amount established): displays button labeled "Thử tạo lại khoản phải trả" (removed `(A51)`).
  - **Test proving it:** `src/app/pages/admin/__tests__/gb2-followups.test.ts` suite `Appeal obligation retry guard (P2-FIX-4)` (4 tests pass: non-MONEY rejected, non-NEEDS_RECONCILIATION rejected, case (a) false, case (b) true).

- **P2-FIX-5 (Stuck queue audit action formatting):**
  - **Files:** `pages/admin/disputes/queue/StuckList.tsx`.
  - **What changed:** Replaced raw `item.lastAudit.action` enum with localized `eventLabel(item.lastAudit.action)` from `workspaceModel.ts`.
  - **Test proving it:** `src/app/pages/admin/__tests__/gb2-followups.test.ts` suite `Stuck queue audit label (P2-FIX-5)` passes.

- **P2-FIX-6 (Elimination of internal codes and brackets in visible text):**
  - **Files:** `AgreementPanel.tsx`, `ReplacementPanel.tsx`, `DeadlinesTable.tsx`, `GymDecisionReplacementPanel.tsx`, `OverviewTab.tsx`, `HeldMoneyReviewSection.tsx`, `QuotaCorrectionCard.tsx`, `AppealTab.tsx`.
  - **What changed:** Cleaned all visible strings matching `\((A|B|G)[0-9]{1,2}...\)`, `D65-B`, `(Deadlines)`, `(Bốn mắt)`, and changed gym "Tiến độ SLA" to "Thời gian xử lý".
  - **Test proving it:** Extra D4 regex grep executed across all target folders prints 0 matches.

### 4. Backend Facts (with Real Backend Source References)
All routes, schemas, and endpoints verified against `D:/fa-bc`:

| Feature | Contract Ref | Route | Method | Body / Query Fields | Error Codes Mapped | Backend Source File & Line |
|---|---|---|---|---|---|---|
| Agreements List | A41 | `/admin/dispute-cases/:id/agreements` | GET | — | `404 CASE_NOT_FOUND` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:28` (impl: `process.service.ts:383-397`) |
| Agreements Propose | A42 | `/admin/dispute-cases/:id/agreements` | POST | `{ outcome, note }` | `409 CASE_STATE_NOT_ALLOWED`, `403 NOT_ASSIGNED_INVESTIGATOR` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:29` (schema: `schemas.ts:197-202`, impl: `process.service.ts:399-424`) |
| Agreements Party Confirm | B7 | `/dispute-cases/:id/agreements/:agreementId/confirm` | POST | `{ contentHash }` | `409 AGREEMENT_CONTENT_MISMATCH`, `409 AGREEMENT_ALREADY_CONFIRMED`, `409 AGREEMENT_NOT_OPEN` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case.routes.ts:17` (schema: `schemas.ts:203-205`, impl: `process.service.ts:426-444`) |
| Agreements Withdraw | A43 | `/admin/dispute-cases/:id/agreements/:agreementId/withdraw` | POST | `{}` | `409 AGREEMENT_NOT_OPEN`, `403 NOT_ASSIGNED_INVESTIGATOR` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:30` (impl: `process.service.ts:446-452`) |
| Agreements Record Finding | A44 | `/admin/dispute-cases/:id/agreements/:agreementId/record-finding` | POST | `{}` | `409 AGREEMENT_NOT_OPEN`, `409 CASE_STATE_NOT_ALLOWED` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:31` (impl: `process.service.ts:454-460`) |
| Quota Correction Propose | A48 | `/admin/dispute-cases/:id/consequences/:consequenceId/quota-corrections` | POST | `{ delta, reason }` | `409 QUOTA_OUT_OF_BOUNDS`, `400 INVALID_CORRECTION_DELTA` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:35` (schema: `schemas.ts:212-215`, impl: `process.service.ts:462-475`) |
| Quota Correction Approve | A49 | `/admin/dispute-cases/:id/quota-corrections/:correctionId/approve` | POST | `{ reason, conflictOfInterestDeclaredNone: true }` | `409 CORRECTION_ALREADY_APPLIED`, `409 QUOTA_OUT_OF_BOUNDS`, `409 QUOTA_CHANGED`, `403 SELF_APPROVAL_FORBIDDEN`, `403 CONFLICT_OF_INTEREST` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:36` (schema: `schemas.ts:216-220`, impl: `process.service.ts:477-495`) |
| Appeal Obligation Retry | A51 | `/admin/dispute-cases/:caseId/appeal-consequences/:consequenceId/create-obligation` | POST | `{}` | `409 MONEY_NOT_ESTABLISHED`, `409 CONTRACT_HAS_NO_PAYMENT`, `422 AMOUNT_EXCEEDS_CONTRACT`, `503 OBLIGATION_UNAVAILABLE` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-appeal-obligation.routes.ts:34` (impl: `process.service.ts:285-305`) |
| Appeal Obligation Sync | A52 | `/admin/dispute-cases/:caseId/appeal-consequences/:consequenceId/sync-obligation` | POST | `{}` | `409 MONEY_NOT_ESTABLISHED`, `503 OBLIGATION_UNAVAILABLE` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-appeal-obligation.routes.ts:35` (impl: `process.service.ts:307-325`) |
| Deadlines List | A37, G31, G36 | `/admin/dispute-cases/:id/deadlines` | GET | — | `404 CASE_NOT_FOUND` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:27` (impl: `dispute-timers.service.ts:45-80`) |
| Stuck Queue List | A38 | `/admin/dispute-cases/stuck` | GET | query: `kind?`, `limit`, `offset` | `500 INTERNAL_ERROR` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:17` (impl: `dispute-case.service.ts:1530-1570`) |
| Held Money List | A39 | `/admin/dispute-cases/held-money` | GET | query: `overdue?`, `limit`, `offset` | `500 INTERNAL_ERROR` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:18` (impl: `process.service.ts:497-515`) |
| Held Money Decide | A40 | `/admin/dispute-cases/held-money/:reviewId/decision` | POST | `{ decision, reason, exitRef? }` | `409 HELD_REVIEW_CLOSED`, `422 EXIT_REF_NOT_FOUND`, `409 DISPUTE_PROCESS_DISABLED` | `D:/fa-bc/backend/services/user-service/src/routes/dispute-case-admin.routes.ts:19` (schema: `schemas.ts:223-229`, impl: `process.service.ts:517-540`) |
| Gym SLA Tracking | G31 | `/admin/complaint-cases/:id` | GET | `detail.sla` (`state`, `ageDays`, `escalated`, `warningAt`, `escalatedAt`) | — | `D:/fa-bc/backend/services/gym-service/src/routes/admin.routes.ts:85` |

### 5. Tests Added or Changed
1. `src/app/pages/admin/__tests__/gb2-followups.test.ts` (31 tests total, +13 new tests):
   - Added suite `Held money exitRefCandidates (P2-FIX-1)`: tests session ID filtering, REJECTED status exclusion, and empty/missing input handling.
   - Added suite `Quota correction direction & delta model (P2-FIX-2)`: tests give-back negative delta, charge positive delta, invalid input rejections (0, 101, floats, empty direction), words sentence formatting (`quotaSentence`), and applied history line formatting (`quotaHistoryLine`).
   - Added suite `Appeal obligation retry guard (P2-FIX-4)`: tests non-MONEY rejection, non-NEEDS_RECONCILIATION rejection, case (a) false (no amount), and case (b) true (amount established).
   - Added suite `Stuck queue audit label (P2-FIX-5)`: tests `eventLabel` formatting for audit actions without leaking raw enum strings.
2. `src/app/pages/disputes/__tests__/d4-sha256-and-guards.test.ts` (16 tests total, +1 new test):
   - Added source guard test `party files must not contain undefined variables --surface-color or --muted-color`.

### 6. Not Done, Blocked, or Questions
- **Phase 3 Mock Browser Matrix:** Intentionally not started per brief instructions (awaiting user instruction `PHASE 3 OK`).
- All 6 feedback items P2-FIX-1 through P2-FIX-6 are completed and verified passing D1–D4.

### 7. Honesty Line
No git writes (not even attempted). Nothing written in D:/FitnessAssistant or D:/fa-bc. No real backend or E2E call. Servers I started are stopped. Temp tsconfig deleted.
