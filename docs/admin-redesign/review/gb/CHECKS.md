# Group B Phase 3 Verification Matrix & Accessibility Audit

**Audit Date:** 2026-11-07  
**Environment:** Mock browser harness (Chromium headless), Vite dev server (port 5928)  
**Rule:** PASS = axe (serious/critical) == 0 AND horizontal overflow == false AND all assertions == true  
**Total Checks:** 61  
**Passed:** 58  
**Failed:** 3 (all 3 due to pre-existing product defects in source files, recorded without mutation per brief)

---

## Executive Summary

| Total Checks | Passed | Failed | Horizontal Overflow Detected | Target Screens Verified |
| :---: | :---: | :---: | :---: | :---: |
| **61** | **58** | **3** | **0 (None)** | **10 / 10 Screens & Forms** |

### Product Defects Identified During Audit
1. **`DeadlinesTable.tsx:44` (Screen 6 - DeadlinesTable at 360px):**
   - **Violation:** Axe `scrollable-region-focusable` (impact: serious).
   - **Detail:** Table wrapper with `overflow-x-auto` becomes horizontally scrollable on mobile viewports (<390px) but lacks `tabIndex={0}` or an accessible label to allow keyboard-only users to navigate the scrollable region.
2. **`HeldMoneyReviewSection.tsx:231` (Screen 7 - HeldMoneyReviewSection decide modal):**
   - **Violation:** Dialog focus trap & Escape handling missing.
   - **Detail:** The decide confirmation modal lacks `useModalA11y` keyboard trapping. Focus does not move into the dialog, the Escape key does not dismiss it, and focus does not return to the trigger button.
3. **`PartyAgreementPanel.tsx:153` (Screen 9 - PartyAgreementPanel confirm agreement modal):**
   - **Violation:** Dialog focus trap & Escape handling missing.
   - **Detail:** The inline confirm modal has `role="dialog"` and `aria-modal="true"` but no Escape key handler or Tab focus trapping. Focus remains in the background document.

---

## Comprehensive Verification Results Table

| # | Screen / Component | State / Flow | Width | Theme | Result | Axe | Overflow | Assertions & Defects | Screenshot |
|---|--------------------|--------------|:-----:|:-----:|:------:|:---:|:--------:|----------------------|------------|
| 1 | Admin Dispute Workspace — Tab "Xem xét lại" (AppealTab) | `appeal_tab_layout` | 360px | light | **PASS** | 0 | None | `appeal_tab_visible`: OK<br>`appeal_item_visible`: OK<br>`decide_appeal_section_present`: OK<br>`close_executed_section_present`: OK | [`s1-appeal_tab_layout-360-light.png`](./s1-appeal_tab_layout-360-light.png) |
| 2 | Admin Dispute Workspace — Tab "Xem xét lại" (AppealTab) | `appeal_tab_layout` | 390px | light | **PASS** | 0 | None | `appeal_tab_visible`: OK<br>`appeal_item_visible`: OK<br>`decide_appeal_section_present`: OK<br>`close_executed_section_present`: OK | [`s1-appeal_tab_layout-390-light.png`](./s1-appeal_tab_layout-390-light.png) |
| 3 | Admin Dispute Workspace — Tab "Xem xét lại" (AppealTab) | `appeal_tab_layout` | 1440px | light | **PASS** | 0 | None | `appeal_tab_visible`: OK<br>`appeal_item_visible`: OK<br>`decide_appeal_section_present`: OK<br>`close_executed_section_present`: OK | [`s1-appeal_tab_layout-1440-light.png`](./s1-appeal_tab_layout-1440-light.png) |
| 4 | Admin Dispute Workspace — Tab "Xem xét lại" (AppealTab) | `appeal_tab_layout` | 1440px | dark | **PASS** | 0 | None | `appeal_tab_visible`: OK<br>`appeal_item_visible`: OK<br>`decide_appeal_section_present`: OK<br>`close_executed_section_present`: OK | [`s1-appeal_tab_layout-1440-dark.png`](./s1-appeal_tab_layout-1440-dark.png) |
| 5 | Admin Dispute Workspace — Tab "Xem xét lại" (AppealTab) | `dialog_decide_appeal_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s1-dialog_decide_appeal_a11y-1440-light.png`](./s1-dialog_decide_appeal_a11y-1440-light.png) |
| 6 | Admin Dispute Workspace — Tab "Xem xét lại" (AppealTab) | `dialog_close_executed_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s1-dialog_close_executed_a11y-1440-light.png`](./s1-dialog_close_executed_a11y-1440-light.png) |
| 7 | Admin Dispute Workspace — Tab "Xem xét lại" (AppealTab) | `appeal_tab_forbidden_hidden` | 1440px | light | **PASS** | 0 | None | `appeals_write_hidden_when_capability_off`: OK<br>`close_executed_hidden_when_not_allowed`: OK<br>`retry_obligation_hidden_when_not_allowed`: OK | [`s1-appeal_tab_forbidden_hidden-1440-light.png`](./s1-appeal_tab_forbidden_hidden-1440-light.png) |
| 8 | Admin Dispute Workspace — Tab "Phê duyệt" (ReplacementPanel) | `replacement_panel_layout` | 360px | light | **PASS** | 0 | None | `replacement_panel_visible`: OK<br>`replacement_item_visible`: OK<br>`decide_replacement_controls_visible`: OK | [`s2-replacement_panel_layout-360-light.png`](./s2-replacement_panel_layout-360-light.png) |
| 9 | Admin Dispute Workspace — Tab "Phê duyệt" (ReplacementPanel) | `replacement_panel_layout` | 390px | light | **PASS** | 0 | None | `replacement_panel_visible`: OK<br>`replacement_item_visible`: OK<br>`decide_replacement_controls_visible`: OK | [`s2-replacement_panel_layout-390-light.png`](./s2-replacement_panel_layout-390-light.png) |
| 10 | Admin Dispute Workspace — Tab "Phê duyệt" (ReplacementPanel) | `replacement_panel_layout` | 1440px | light | **PASS** | 0 | None | `replacement_panel_visible`: OK<br>`replacement_item_visible`: OK<br>`decide_replacement_controls_visible`: OK | [`s2-replacement_panel_layout-1440-light.png`](./s2-replacement_panel_layout-1440-light.png) |
| 11 | Admin Dispute Workspace — Tab "Phê duyệt" (ReplacementPanel) | `replacement_panel_layout` | 1440px | dark | **PASS** | 0 | None | `replacement_panel_visible`: OK<br>`replacement_item_visible`: OK<br>`decide_replacement_controls_visible`: OK | [`s2-replacement_panel_layout-1440-dark.png`](./s2-replacement_panel_layout-1440-dark.png) |
| 12 | Admin Dispute Workspace — Tab "Phê duyệt" (ReplacementPanel) | `dialog_propose_replacement_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s2-dialog_propose_replacement_a11y-1440-light.png`](./s2-dialog_propose_replacement_a11y-1440-light.png) |
| 13 | Admin Dispute Workspace — Tab "Phê duyệt" (ReplacementPanel) | `dialog_decide_replacement_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s2-dialog_decide_replacement_a11y-1440-light.png`](./s2-dialog_decide_replacement_a11y-1440-light.png) |
| 14 | Admin Dispute Workspace — Tab "Phê duyệt" (ReplacementPanel) | `replacement_panel_forbidden_hidden` | 1440px | light | **PASS** | 0 | None | `replacement_panel_hidden_when_not_decision_approved`: OK | [`s2-replacement_panel_forbidden_hidden-1440-light.png`](./s2-replacement_panel_forbidden_hidden-1440-light.png) |
| 15 | FindingsTab — AgreementPanel | `agreement_panel_layout` | 360px | light | **PASS** | 0 | None | `agreement_panel_visible`: OK<br>`agreement_item_visible`: OK<br>`propose_agreement_form_visible`: OK | [`s3-agreement_panel_layout-360-light.png`](./s3-agreement_panel_layout-360-light.png) |
| 16 | FindingsTab — AgreementPanel | `agreement_panel_layout` | 390px | light | **PASS** | 0 | None | `agreement_panel_visible`: OK<br>`agreement_item_visible`: OK<br>`propose_agreement_form_visible`: OK | [`s3-agreement_panel_layout-390-light.png`](./s3-agreement_panel_layout-390-light.png) |
| 17 | FindingsTab — AgreementPanel | `agreement_panel_layout` | 1440px | light | **PASS** | 0 | None | `agreement_panel_visible`: OK<br>`agreement_item_visible`: OK<br>`propose_agreement_form_visible`: OK | [`s3-agreement_panel_layout-1440-light.png`](./s3-agreement_panel_layout-1440-light.png) |
| 18 | FindingsTab — AgreementPanel | `agreement_panel_layout` | 1440px | dark | **PASS** | 0 | None | `agreement_panel_visible`: OK<br>`agreement_item_visible`: OK<br>`propose_agreement_form_visible`: OK | [`s3-agreement_panel_layout-1440-dark.png`](./s3-agreement_panel_layout-1440-dark.png) |
| 19 | FindingsTab — AgreementPanel | `dialog_propose_agreement_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s3-dialog_propose_agreement_a11y-1440-light.png`](./s3-dialog_propose_agreement_a11y-1440-light.png) |
| 20 | FindingsTab — AgreementPanel | `dialog_withdraw_agreement_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s3-dialog_withdraw_agreement_a11y-1440-light.png`](./s3-dialog_withdraw_agreement_a11y-1440-light.png) |
| 21 | FindingsTab — AgreementPanel | `agreement_panel_forbidden_hidden` | 1440px | light | **PASS** | 0 | None | `agreement_propose_hidden_when_capability_off`: OK | [`s3-agreement_panel_forbidden_hidden-1440-light.png`](./s3-agreement_panel_forbidden_hidden-1440-light.png) |
| 22 | AppealTab — QuotaCorrectionCard | `quota_card_layout` | 360px | light | **PASS** | 0 | None | `quota_card_visible`: OK<br>`quota_pending_row_visible`: OK | [`s4-quota_card_layout-360-light.png`](./s4-quota_card_layout-360-light.png) |
| 23 | AppealTab — QuotaCorrectionCard | `quota_card_layout` | 390px | light | **PASS** | 0 | None | `quota_card_visible`: OK<br>`quota_pending_row_visible`: OK | [`s4-quota_card_layout-390-light.png`](./s4-quota_card_layout-390-light.png) |
| 24 | AppealTab — QuotaCorrectionCard | `quota_card_layout` | 1440px | light | **PASS** | 0 | None | `quota_card_visible`: OK<br>`quota_pending_row_visible`: OK | [`s4-quota_card_layout-1440-light.png`](./s4-quota_card_layout-1440-light.png) |
| 25 | AppealTab — QuotaCorrectionCard | `quota_card_layout` | 1440px | dark | **PASS** | 0 | None | `quota_card_visible`: OK<br>`quota_pending_row_visible`: OK | [`s4-quota_card_layout-1440-dark.png`](./s4-quota_card_layout-1440-dark.png) |
| 26 | AppealTab — QuotaCorrectionCard | `dialog_propose_quota_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s4-dialog_propose_quota_a11y-1440-light.png`](./s4-dialog_propose_quota_a11y-1440-light.png) |
| 27 | AppealTab — QuotaCorrectionCard | `dialog_approve_quota_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s4-dialog_approve_quota_a11y-1440-light.png`](./s4-dialog_approve_quota_a11y-1440-light.png) |
| 28 | AppealTab — QuotaCorrectionCard | `quota_card_forbidden_hidden` | 1440px | light | **PASS** | 0 | None | `quota_approve_hidden_for_proposer`: OK | [`s4-quota_card_forbidden_hidden-1440-light.png`](./s4-quota_card_forbidden_hidden-1440-light.png) |
| 29 | Queue View — StuckList (/admin/disputes?view=stuck) | `stuck_list_layout` | 360px | light | **PASS** | 0 | None | `stuck_list_visible`: OK<br>`stuck_row_1_visible`: OK<br>`stuck_row_2_visible`: OK<br>`stuck_kind_filter_visible`: OK | [`s5-stuck_list_layout-360-light.png`](./s5-stuck_list_layout-360-light.png) |
| 30 | Queue View — StuckList (/admin/disputes?view=stuck) | `stuck_list_layout` | 390px | light | **PASS** | 0 | None | `stuck_list_visible`: OK<br>`stuck_row_1_visible`: OK<br>`stuck_row_2_visible`: OK<br>`stuck_kind_filter_visible`: OK | [`s5-stuck_list_layout-390-light.png`](./s5-stuck_list_layout-390-light.png) |
| 31 | Queue View — StuckList (/admin/disputes?view=stuck) | `stuck_list_layout` | 1440px | light | **PASS** | 0 | None | `stuck_list_visible`: OK<br>`stuck_row_1_visible`: OK<br>`stuck_row_2_visible`: OK<br>`stuck_kind_filter_visible`: OK | [`s5-stuck_list_layout-1440-light.png`](./s5-stuck_list_layout-1440-light.png) |
| 32 | Queue View — StuckList (/admin/disputes?view=stuck) | `stuck_list_layout` | 1440px | dark | **PASS** | 0 | None | `stuck_list_visible`: OK<br>`stuck_row_1_visible`: OK<br>`stuck_row_2_visible`: OK<br>`stuck_kind_filter_visible`: OK | [`s5-stuck_list_layout-1440-dark.png`](./s5-stuck_list_layout-1440-dark.png) |
| 33 | Queue View — StuckList (/admin/disputes?view=stuck) | `stuck_list_filter_labels` | 1440px | light | **PASS** | 0 | None | `stuck_policy_pending_label_present`: OK<br>`stuck_needs_human_label_present`: OK<br>`stuck_unassigned_owner_label_present`: OK<br>`stuck_filter_has_all_option`: OK | [`s5-stuck_list_filter_labels-1440-light.png`](./s5-stuck_list_filter_labels-1440-light.png) |
| 34 | OverviewTab — DeadlinesTable (/admin/disputes/:caseId?tab=overview) | `deadlines_table_layout` | 360px | light | **FAIL** | ⚠️ 1 (scrollable-region-focusable) | None | `deadlines_section_visible`: OK<br>`deadline_row_1_visible`: OK<br>`deadline_row_2_visible`: OK<br>`deadline_paused_text_present`: OK<br>`deadline_notice_present`: OK | [`s6-deadlines_table_layout-360-light.png`](./s6-deadlines_table_layout-360-light.png) |
| 35 | OverviewTab — DeadlinesTable (/admin/disputes/:caseId?tab=overview) | `deadlines_table_layout` | 390px | light | **PASS** | 0 | None | `deadlines_section_visible`: OK<br>`deadline_row_1_visible`: OK<br>`deadline_row_2_visible`: OK<br>`deadline_paused_text_present`: OK<br>`deadline_notice_present`: OK | [`s6-deadlines_table_layout-390-light.png`](./s6-deadlines_table_layout-390-light.png) |
| 36 | OverviewTab — DeadlinesTable (/admin/disputes/:caseId?tab=overview) | `deadlines_table_layout` | 1440px | light | **PASS** | 0 | None | `deadlines_section_visible`: OK<br>`deadline_row_1_visible`: OK<br>`deadline_row_2_visible`: OK<br>`deadline_paused_text_present`: OK<br>`deadline_notice_present`: OK | [`s6-deadlines_table_layout-1440-light.png`](./s6-deadlines_table_layout-1440-light.png) |
| 37 | OverviewTab — DeadlinesTable (/admin/disputes/:caseId?tab=overview) | `deadlines_table_layout` | 1440px | dark | **PASS** | 0 | None | `deadlines_section_visible`: OK<br>`deadline_row_1_visible`: OK<br>`deadline_row_2_visible`: OK<br>`deadline_paused_text_present`: OK<br>`deadline_notice_present`: OK | [`s6-deadlines_table_layout-1440-dark.png`](./s6-deadlines_table_layout-1440-dark.png) |
| 38 | Finance Reconciliation — HeldMoneyReviewSection (/admin/finance/reconciliation?view=held-no-show) | `held_money_review_layout` | 360px | light | **PASS** | 0 | None | `held_money_section_visible`: OK<br>`held_money_table_visible`: OK<br>`held_money_row_visible`: OK<br>`held_money_decide_button_visible`: OK | [`s7-held_money_review_layout-360-light.png`](./s7-held_money_review_layout-360-light.png) |
| 39 | Finance Reconciliation — HeldMoneyReviewSection (/admin/finance/reconciliation?view=held-no-show) | `held_money_review_layout` | 390px | light | **PASS** | 0 | None | `held_money_section_visible`: OK<br>`held_money_table_visible`: OK<br>`held_money_row_visible`: OK<br>`held_money_decide_button_visible`: OK | [`s7-held_money_review_layout-390-light.png`](./s7-held_money_review_layout-390-light.png) |
| 40 | Finance Reconciliation — HeldMoneyReviewSection (/admin/finance/reconciliation?view=held-no-show) | `held_money_review_layout` | 1440px | light | **PASS** | 0 | None | `held_money_section_visible`: OK<br>`held_money_table_visible`: OK<br>`held_money_row_visible`: OK<br>`held_money_decide_button_visible`: OK | [`s7-held_money_review_layout-1440-light.png`](./s7-held_money_review_layout-1440-light.png) |
| 41 | Finance Reconciliation — HeldMoneyReviewSection (/admin/finance/reconciliation?view=held-no-show) | `held_money_review_layout` | 1440px | dark | **PASS** | 0 | None | `held_money_section_visible`: OK<br>`held_money_table_visible`: OK<br>`held_money_row_visible`: OK<br>`held_money_decide_button_visible`: OK | [`s7-held_money_review_layout-1440-dark.png`](./s7-held_money_review_layout-1440-dark.png) |
| 42 | Finance Reconciliation — HeldMoneyReviewSection (/admin/finance/reconciliation?view=held-no-show) | `held_money_0_candidates` | 1440px | light | **PASS** | 0 | None | `held_money_exit_radio_disabled_when_no_candidates`: OK<br>`held_money_no_candidates_notice_present`: OK | [`s7-held_money_0_candidates-1440-light.png`](./s7-held_money_0_candidates-1440-light.png) |
| 43 | Finance Reconciliation — HeldMoneyReviewSection (/admin/finance/reconciliation?view=held-no-show) | `dialog_held_money_decide_a11y` | 1440px | light | **FAIL** | 0 | None | **FAIL** `dialog_focus_moves_inside` (HeldMoneyReviewSection.tsx:231 - Focus did not move into dialog on open)<br>`dialog_tab_stays_inside`: OK<br>**FAIL** `dialog_esc_closes` (HeldMoneyReviewSection.tsx:231 - Escape key did not close dialog)<br>**FAIL** `dialog_focus_returns_to_opener` (HeldMoneyReviewSection.tsx:231 - Focus did not return to opener button after Esc) | [`s7-dialog_held_money_decide_a11y-1440-light.png`](./s7-dialog_held_money_decide_a11y-1440-light.png) |
| 44 | Gym Complaint Workspace — GymAppealReviewerPanel & GymDecisionReplacementPanel | `gym_panels_layout` | 360px | light | **PASS** | 0 | None | `gym_replacement_panel_visible`: OK<br>`gym_appeal_reviewer_panel_visible`: OK | [`s8-gym_panels_layout-360-light.png`](./s8-gym_panels_layout-360-light.png) |
| 45 | Gym Complaint Workspace — GymAppealReviewerPanel & GymDecisionReplacementPanel | `gym_panels_layout` | 390px | light | **PASS** | 0 | None | `gym_replacement_panel_visible`: OK<br>`gym_appeal_reviewer_panel_visible`: OK | [`s8-gym_panels_layout-390-light.png`](./s8-gym_panels_layout-390-light.png) |
| 46 | Gym Complaint Workspace — GymAppealReviewerPanel & GymDecisionReplacementPanel | `gym_panels_layout` | 1440px | light | **PASS** | 0 | None | `gym_replacement_panel_visible`: OK<br>`gym_appeal_reviewer_panel_visible`: OK | [`s8-gym_panels_layout-1440-light.png`](./s8-gym_panels_layout-1440-light.png) |
| 47 | Gym Complaint Workspace — GymAppealReviewerPanel & GymDecisionReplacementPanel | `gym_panels_layout` | 1440px | dark | **PASS** | 0 | None | `gym_replacement_panel_visible`: OK<br>`gym_appeal_reviewer_panel_visible`: OK | [`s8-gym_panels_layout-1440-dark.png`](./s8-gym_panels_layout-1440-dark.png) |
| 48 | Gym Complaint Workspace — GymAppealReviewerPanel & GymDecisionReplacementPanel | `dialog_gym_propose_replacement_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s8-dialog_gym_propose_replacement_a11y-1440-light.png`](./s8-dialog_gym_propose_replacement_a11y-1440-light.png) |
| 49 | Gym Complaint Workspace — GymAppealReviewerPanel & GymDecisionReplacementPanel | `dialog_gym_decide_replacement_a11y` | 1440px | light | **PASS** | 0 | None | `dialog_focus_moves_inside`: OK<br>`dialog_tab_stays_inside`: OK<br>`dialog_esc_closes`: OK<br>`dialog_focus_returns_to_opener`: OK | [`s8-dialog_gym_decide_replacement_a11y-1440-light.png`](./s8-dialog_gym_decide_replacement_a11y-1440-light.png) |
| 50 | Gym Complaint Workspace — GymAppealReviewerPanel & GymDecisionReplacementPanel | `gym_replacement_forbidden_hidden` | 1440px | light | **PASS** | 0 | None | `gym_replacement_panel_hidden_when_not_allowed`: OK | [`s8-gym_replacement_forbidden_hidden-1440-light.png`](./s8-gym_replacement_forbidden_hidden-1440-light.png) |
| 51 | Party Dispute Case — PartyAppealForm & PartyAgreementPanel (/disputes/:caseId) | `party_forms_layout` | 360px | light | **PASS** | 0 | None | `party_appeal_form_visible`: OK<br>`party_agreements_panel_visible`: OK<br>`party_confirm_agreement_button_visible`: OK | [`s9-party_forms_layout-360-light.png`](./s9-party_forms_layout-360-light.png) |
| 52 | Party Dispute Case — PartyAppealForm & PartyAgreementPanel (/disputes/:caseId) | `party_forms_layout` | 390px | light | **PASS** | 0 | None | `party_appeal_form_visible`: OK<br>`party_agreements_panel_visible`: OK<br>`party_confirm_agreement_button_visible`: OK | [`s9-party_forms_layout-390-light.png`](./s9-party_forms_layout-390-light.png) |
| 53 | Party Dispute Case — PartyAppealForm & PartyAgreementPanel (/disputes/:caseId) | `party_forms_layout` | 1440px | light | **PASS** | 0 | None | `party_appeal_form_visible`: OK<br>`party_agreements_panel_visible`: OK<br>`party_confirm_agreement_button_visible`: OK | [`s9-party_forms_layout-1440-light.png`](./s9-party_forms_layout-1440-light.png) |
| 54 | Party Dispute Case — PartyAppealForm & PartyAgreementPanel (/disputes/:caseId) | `party_forms_layout` | 1440px | dark | **PASS** | 0 | None | `party_appeal_form_visible`: OK<br>`party_agreements_panel_visible`: OK<br>`party_confirm_agreement_button_visible`: OK | [`s9-party_forms_layout-1440-dark.png`](./s9-party_forms_layout-1440-dark.png) |
| 55 | Party Dispute Case — PartyAppealForm & PartyAgreementPanel (/disputes/:caseId) | `dialog_party_agreement_confirm_a11y` | 1440px | light | **FAIL** | 0 | None | **FAIL** `dialog_focus_moves_inside` (PartyAgreementPanel.tsx:153 - Focus did not move into dialog on open)<br>**FAIL** `dialog_tab_stays_inside` (PartyAgreementPanel.tsx:153 - Tab key navigated outside dialog)<br>**FAIL** `dialog_esc_closes` (PartyAgreementPanel.tsx:153 - Escape key did not close dialog)<br>**FAIL** `dialog_focus_returns_to_opener` (PartyAgreementPanel.tsx:153 - Focus did not return to opener button after Esc) | [`s9-dialog_party_agreement_confirm_a11y-1440-light.png`](./s9-dialog_party_agreement_confirm_a11y-1440-light.png) |
| 56 | Party Dispute Case — PartyAppealForm & PartyAgreementPanel (/disputes/:caseId) | `party_appeal_forbidden_hidden` | 1440px | light | **PASS** | 0 | None | `party_appeal_form_hidden_when_can_file_false`: OK<br>`party_agreements_panel_hidden_when_agreements_empty`: OK | [`s9-party_appeal_forbidden_hidden-1440-light.png`](./s9-party_appeal_forbidden_hidden-1440-light.png) |
| 57 | Gym Member Complaint — GymMemberAppealForm (/complaint-cases/:caseId) | `gym_member_appeal_layout` | 360px | light | **PASS** | 0 | None | `gym_member_detail_page_visible`: OK<br>`gym_member_appeal_heading_visible`: OK<br>`gym_member_appeal_reason_field_visible`: OK | [`s10-gym_member_appeal_layout-360-light.png`](./s10-gym_member_appeal_layout-360-light.png) |
| 58 | Gym Member Complaint — GymMemberAppealForm (/complaint-cases/:caseId) | `gym_member_appeal_layout` | 390px | light | **PASS** | 0 | None | `gym_member_detail_page_visible`: OK<br>`gym_member_appeal_heading_visible`: OK<br>`gym_member_appeal_reason_field_visible`: OK | [`s10-gym_member_appeal_layout-390-light.png`](./s10-gym_member_appeal_layout-390-light.png) |
| 59 | Gym Member Complaint — GymMemberAppealForm (/complaint-cases/:caseId) | `gym_member_appeal_layout` | 1440px | light | **PASS** | 0 | None | `gym_member_detail_page_visible`: OK<br>`gym_member_appeal_heading_visible`: OK<br>`gym_member_appeal_reason_field_visible`: OK | [`s10-gym_member_appeal_layout-1440-light.png`](./s10-gym_member_appeal_layout-1440-light.png) |
| 60 | Gym Member Complaint — GymMemberAppealForm (/complaint-cases/:caseId) | `gym_member_appeal_layout` | 1440px | dark | **PASS** | 0 | None | `gym_member_detail_page_visible`: OK<br>`gym_member_appeal_heading_visible`: OK<br>`gym_member_appeal_reason_field_visible`: OK | [`s10-gym_member_appeal_layout-1440-dark.png`](./s10-gym_member_appeal_layout-1440-dark.png) |
| 61 | Gym Member Complaint — GymMemberAppealForm (/complaint-cases/:caseId) | `gym_member_appeal_forbidden_hidden` | 1440px | light | **PASS** | 0 | None | `gym_member_appeal_hidden_when_can_file_false`: OK | [`s10-gym_member_appeal_forbidden_hidden-1440-light.png`](./s10-gym_member_appeal_forbidden_hidden-1440-light.png) |

---

## Dialog Accessibility Deep Dive

Every dialog/modal tested under reduced Phase 3 scope evaluated 4 core criteria:
1. **Focus moves inside:** Focus automatically shifts to the dialog container or first focusable element upon trigger click.
2. **Tab stays inside:** Tab and Shift+Tab cycles focus exclusively within the modal while open.
3. **Esc closes:** Pressing the `Escape` key immediately closes/dismisses the modal.
4. **Focus returns to opener:** Upon modal dismissal, focus is restored to the triggering element.

### Dialog Audit Summary

| Component | Dialog / Modal Tested | File & Line | Focus Inside | Tab Trap | Esc Closes | Focus Return | Status |
|-----------|-----------------------|-------------|:------------:|:--------:|:----------:|:------------:|:------:|
| `AppealTab` | Decide Modal | `AppealTab.tsx:187` | PASS | PASS | PASS | PASS | **PASS** |
| `AppealTab` | Close Executed Modal | `AppealTab.tsx:210` | PASS | PASS | PASS | PASS | **PASS** |
| `ReplacementPanel` | Propose Replacement Modal | `ReplacementPanel.tsx:206` | PASS | PASS | PASS | PASS | **PASS** |
| `ReplacementPanel` | Approve Replacement Modal | `ReplacementPanel.tsx:220` | PASS | PASS | PASS | PASS | **PASS** |
| `AgreementPanel` | Propose Agreement Modal | `AgreementPanel.tsx:165` | PASS | PASS | PASS | PASS | **PASS** |
| `AgreementPanel` | Withdraw Agreement Modal | `AgreementPanel.tsx:184` | PASS | PASS | PASS | PASS | **PASS** |
| `QuotaCorrectionCard` | Propose Quota Modal | `QuotaCorrectionCard.tsx:156` | PASS | PASS | PASS | PASS | **PASS** |
| `QuotaCorrectionCard` | Approve Quota Modal | `QuotaCorrectionCard.tsx:177` | PASS | PASS | PASS | PASS | **PASS** |
| `HeldMoneyReviewSection` | Decide Held Money Modal | `HeldMoneyReviewSection.tsx:231` | FAIL | PASS | FAIL | FAIL | **FAIL (Product Defect)** |
| `GymDecisionReplacementPanel` | Propose Replacement Modal | `GymDecisionReplacementPanel.tsx:327` | PASS | PASS | PASS | PASS | **PASS** |
| `GymDecisionReplacementPanel` | Decide Replacement Modal | `GymDecisionReplacementPanel.tsx:340` | PASS | PASS | PASS | PASS | **PASS** |
| `PartyAgreementPanel` | Confirm Agreement Modal | `PartyAgreementPanel.tsx:153` | FAIL | FAIL | FAIL | FAIL | **FAIL (Product Defect)** |

---

## Permission Gating / Hidden Forbidden Actions

Every screen verified that when permissions, allowed actions, or backend capabilities are off / forbidden:
- **AppealTab:** When `allowedActions` omit `DECIDE_APPEAL` and `CLOSE_EXECUTED_APPEAL`, action buttons and forms are completely hidden (`ok: true`).
- **ReplacementPanel:** When replacement permissions are false, replacement forms and action triggers are completely hidden (`ok: true`).
- **AgreementPanel:** When agreement propose/withdraw permissions are false, all agreement actions are completely hidden (`ok: true`).
- **QuotaCorrectionCard:** When user is proposer or lacking approval permission, approval actions are hidden (`ok: true`).
- **HeldMoneyReviewSection:** When proposal count is 0, selection radio buttons are disabled and informational note is shown (`ok: true`).
- **GymDecisionReplacementPanel:** When replacement action permissions are false and case is not decided, replacement panel is completely hidden (`ok: true`).
- **PartyAppealForm:** When `appeal.canFile` is false, appeal submission form is completely hidden (`ok: true`).
- **GymMemberAppealForm:** When `appeal.canFile` is false, gym member appeal form is completely hidden (`ok: true`).

---
*Generated by Antigravity Phase 3 Reduced Scope Verification Engine.*
