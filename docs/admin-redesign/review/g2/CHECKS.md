# Phase 2-REDO Mock Browser Test Matrix Results (CHECKS.md)

Evidence Label: `MOCK BROWSER TEST`

All claims in this report are backed by explicit assertions that ran and held during browser execution.

- **Pass Rule:** `pass = axeOK (0) && noOverflow && assertionsOK`
- **Total Checks Executed:** 86
- **Passed:** 86
- **Failed:** 0
- **Axe Serious/Critical Violations:** 0
- **Horizontal Overflows:** 0

## S1: /admin/disputes queue (Hàng đợi khiếu nại)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `queue_default` | 360px | light | **PASS** | 0 | NO | • `queue_page_visible`: **OK**<br>• `disputed_rows_present`: **OK**<br>• `pt_no_show_rows_present`: **OK**<br>• `contract_policy_link_present`: **OK**<br>• `pagination_total_51`: **OK** | `s1-queue_default-360-light.png` |
| `queue_default` | 375px | light | **PASS** | 0 | NO | • `queue_page_visible`: **OK**<br>• `disputed_rows_present`: **OK**<br>• `pt_no_show_rows_present`: **OK**<br>• `contract_policy_link_present`: **OK**<br>• `pagination_total_51`: **OK** | `s1-queue_default-375-light.png` |
| `queue_default` | 390px | light | **PASS** | 0 | NO | • `queue_page_visible`: **OK**<br>• `disputed_rows_present`: **OK**<br>• `pt_no_show_rows_present`: **OK**<br>• `contract_policy_link_present`: **OK**<br>• `pagination_total_51`: **OK** | `s1-queue_default-390-light.png` |
| `queue_default` | 412px | light | **PASS** | 0 | NO | • `queue_page_visible`: **OK**<br>• `disputed_rows_present`: **OK**<br>• `pt_no_show_rows_present`: **OK**<br>• `contract_policy_link_present`: **OK**<br>• `pagination_total_51`: **OK** | `s1-queue_default-412-light.png` |
| `queue_default` | 1440px | light | **PASS** | 0 | NO | • `queue_page_visible`: **OK**<br>• `disputed_rows_present`: **OK**<br>• `pt_no_show_rows_present`: **OK**<br>• `contract_policy_link_present`: **OK**<br>• `pagination_total_51`: **OK** | `s1-queue_default-1440-light.png` |
| `queue_default` | 1440px | dark | **PASS** | 0 | NO | • `queue_page_visible`: **OK**<br>• `disputed_rows_present`: **OK**<br>• `pt_no_show_rows_present`: **OK**<br>• `contract_policy_link_present`: **OK**<br>• `pagination_total_51`: **OK** | `s1-queue_default-1440-dark.png` |
| `open-case-idempotency` | 1440px | light | **PASS** | 0 | NO | • `exactly_one_post_on_dblclick`: **OK**<br>• `has_idempotency_key_header`: **OK**<br>• `body_keys_strictly_sessionId`: **OK** | `s1-open-case-idempotency.png` |
| `case_exists` | 1440px | light | **PASS** | 0 | NO | • `case_exists_link_visible`: **OK**<br>• `case_exists_link_target_correct`: **OK** | `s1-case_exists-1440-light.png` |

## S2: /admin/disputes/:caseId (Hồ sơ vụ việc & Rà soát chính sách hợp đồng)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `workspace_default` | 360px | light | **PASS** | 0 | NO | • `workspace_page_visible`: **OK**<br>• `case_header_visible`: **OK** | `s2-workspace_default-360-light.png` |
| `workspace_default` | 375px | light | **PASS** | 0 | NO | • `workspace_page_visible`: **OK**<br>• `case_header_visible`: **OK** | `s2-workspace_default-375-light.png` |
| `workspace_default` | 390px | light | **PASS** | 0 | NO | • `workspace_page_visible`: **OK**<br>• `case_header_visible`: **OK** | `s2-workspace_default-390-light.png` |
| `workspace_default` | 412px | light | **PASS** | 0 | NO | • `workspace_page_visible`: **OK**<br>• `case_header_visible`: **OK** | `s2-workspace_default-412-light.png` |
| `workspace_default` | 1440px | light | **PASS** | 0 | NO | • `workspace_page_visible`: **OK**<br>• `case_header_visible`: **OK** | `s2-workspace_default-1440-light.png` |
| `workspace_default` | 1440px | dark | **PASS** | 0 | NO | • `workspace_page_visible`: **OK**<br>• `case_header_visible`: **OK** | `s2-workspace_default-1440-dark.png` |
| `each_tab_verified` | 1440px | light | **PASS** | 0 | NO | • `tab_overview_visible_and_has_unique_text`: **OK**<br>• `tab_statements_visible_and_has_unique_text`: **OK**<br>• `tab_evidence_visible_and_has_unique_text`: **OK**<br>• `tab_assessments_visible_and_has_unique_text`: **OK**<br>• `tab_findings_visible_and_has_unique_text`: **OK**<br>• `tab_approvals_visible_and_has_unique_text`: **OK**<br>• `tab_money_visible_and_has_unique_text`: **OK**<br>• `tab_execution_visible_and_has_unique_text`: **OK**<br>• `tab_history_visible_and_has_unique_text`: **OK** | `s2-each_tab_verified-1440-light.png` |
| `execution_states_verified` | 1440px | light | **PASS** | 0 | NO | • `exec_status_NOT_STARTED_vietnamese_text`: **OK**<br>• `exec_status_EXECUTING_vietnamese_text`: **OK**<br>• `exec_status_EXEC_BLOCKED_vietnamese_text`: **OK**<br>• `exec_status_BUSINESS_DONE_vietnamese_text`: **OK**<br>• `exec_status_NEEDS_HUMAN_vietnamese_text`: **OK**<br>• `execution_capability_false_no_execute_button`: **OK** | `s2-execution_states_verified-1440-light.png` |
| `money_states_verified` | 1440px | light | **PASS** | 0 | NO | • `money_unavailable_shows_chua_doc_duoc_so_cai`: **OK**<br>• `money_unavailable_does_not_contain_zero_vnd`: **OK**<br>• `money_paid_via_ledger_shows_vi_gymini`: **OK**<br>• `money_waived_no_da_hoan`: **OK** | `s2-money_states_verified-1440-light.png` |
| `contract_policy_panel_interactions` | 1440px | light | **PASS** | 0 | NO | • `contract_policy_reference_note_visible`: **OK**<br>• `contract_policy_vietnamese_kind_label`: **OK**<br>• `contract_policy_approve_coi_body_valid`: **OK** | `s2-contract_policy_panel_interactions-1440-light.png` |

## S3: S2 form errors (Xử lý lỗi biểu mẫu hồ sơ)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `error_case_version_conflict` | 1440px | light | **PASS** | 0 | NO | • `reload_button_visible_on_version_conflict`: **OK**<br>• `no_second_post_within_2s`: **OK** | `s3-error_case_version_conflict-1440-light.png` |
| `error_evidence_source_unavailable` | 1440px | light | **PASS** | 0 | NO | • `retry_button_visible_on_source_unavailable`: **OK**<br>• `retry_sends_second_post_with_same_idempotency_key`: **OK** | `s3-error_evidence_source_unavailable-1440-light.png` |
| `error_invalid_input_1440` | 1440px | light | **PASS** | 0 | NO | • `field_error_message_visible_beneath_field_1440`: **OK**<br>• `textarea_aria_describedby_points_to_error_1440`: **OK** | `s3-error_invalid_input_1440-1440-light.png` |
| `error_invalid_input_360` | 360px | light | **PASS** | 0 | NO | • `field_error_message_visible_beneath_field_360`: **OK**<br>• `textarea_aria_describedby_points_to_error_360`: **OK** | `s3-error_invalid_input_360-360-light.png` |
| `error_network_failure` | 1440px | light | **PASS** | 0 | NO | • `outcome_unknown_reload_text_visible_on_network_failure`: **OK**<br>• `reload_button_visible_on_network_failure`: **OK** | `s3-error_network_failure-1440-light.png` |

## S4: Finance → Reconciliation → Held Money / D65-B (Khoản giữ buổi PT vắng)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `d65b_default` | 360px | light | **PASS** | 0 | NO | • `held_no_show_view_visible`: **OK** | `s4-d65b_default-360-light.png` |
| `d65b_default` | 375px | light | **PASS** | 0 | NO | • `held_no_show_view_visible`: **OK** | `s4-d65b_default-375-light.png` |
| `d65b_default` | 390px | light | **PASS** | 0 | NO | • `held_no_show_view_visible`: **OK** | `s4-d65b_default-390-light.png` |
| `d65b_default` | 412px | light | **PASS** | 0 | NO | • `held_no_show_view_visible`: **OK** | `s4-d65b_default-412-light.png` |
| `d65b_default` | 1440px | light | **PASS** | 0 | NO | • `held_no_show_view_visible`: **OK** | `s4-d65b_default-1440-light.png` |
| `d65b_default` | 1440px | dark | **PASS** | 0 | NO | • `held_no_show_view_visible`: **OK** | `s4-d65b_default-1440-dark.png` |
| `d65b_propose_verified` | 1440px | light | **PASS** | 0 | NO | • `d65b_propose_exactly_one_post_on_dblclick`: **OK**<br>• `d65b_propose_has_idempotency_key`: **OK**<br>• `d65b_propose_body_keys_exact`: **OK** | `s4-d65b_propose_verified-1440-light.png` |
| `d65b_approve_200_verified` | 1440px | light | **PASS** | 0 | NO | • `d65b_approve_200_exactly_one_post_on_dblclick`: **OK**<br>• `d65b_approve_200_has_idempotency_key`: **OK**<br>• `d65b_approve_200_body_keys_exact`: **OK** | `s4-d65b_approve_200_verified-1440-light.png` |
| `d65b_approve_202_verified` | 1440px | light | **PASS** | 0 | NO | • `d65b_202_page_does_not_contain_da_hoan`: **OK** | `s4-d65b_approve_202_verified-1440-light.png` |
| `d65b_reject_verified` | 1440px | light | **PASS** | 0 | NO | • `d65b_reject_exactly_one_post_on_dblclick`: **OK**<br>• `d65b_reject_has_idempotency_key`: **OK**<br>• `d65b_reject_body_keys_exact`: **OK** | `s4-d65b_reject_verified-1440-light.png` |
| `d65b_handover_verified` | 1440px | light | **PASS** | 0 | NO | • `d65b_handover_exactly_one_post_on_dblclick`: **OK**<br>• `d65b_handover_has_idempotency_key`: **OK**<br>• `d65b_handover_body_keys_exact`: **OK** | `s4-d65b_handover_verified-1440-light.png` |
| `dialog_at_360` | 360px | light | **PASS** | 0 | NO | • `d65b_dialog_visible_at_360`: **OK** | `s4-dialog_at_360-360-light.png` |
| `d65b_flag_off_no_write_controls` | 1440px | light | **PASS** | 0 | NO | • `d65b_flag_off_no_write_buttons`: **OK** | `s4-d65b_flag_off_no_write_controls-1440-light.png` |

## S5: Finance → Reconciliation → Late Compensation (Bồi thường đến muộn)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `late_open_default` | 360px | light | **PASS** | 0 | NO | • `late_open_view_visible`: **OK** | `s5-late_open_default-360-light.png` |
| `late_open_default` | 375px | light | **PASS** | 0 | NO | • `late_open_view_visible`: **OK** | `s5-late_open_default-375-light.png` |
| `late_open_default` | 390px | light | **PASS** | 0 | NO | • `late_open_view_visible`: **OK** | `s5-late_open_default-390-light.png` |
| `late_open_default` | 412px | light | **PASS** | 0 | NO | • `late_open_view_visible`: **OK** | `s5-late_open_default-412-light.png` |
| `late_open_default` | 1440px | light | **PASS** | 0 | NO | • `late_open_view_visible`: **OK** | `s5-late_open_default-1440-light.png` |
| `late_open_default` | 1440px | dark | **PASS** | 0 | NO | • `late_open_view_visible`: **OK** | `s5-late_open_default-1440-dark.png` |
| `late_claim_verified` | 1440px | light | **PASS** | 0 | NO | • `late_claim_exactly_one_post`: **OK**<br>• `late_claim_body_keys_empty_object`: **OK** | `s5-late_claim_verified-1440-light.png` |
| `late_handover_verified` | 1440px | light | **PASS** | 0 | NO | • `late_handover_exactly_one_post`: **OK**<br>• `late_handover_body_keys_exact`: **OK** | `s5-late_handover_verified-1440-light.png` |
| `late_propose_verified` | 1440px | light | **PASS** | 0 | NO | • `late_propose_exactly_one_post`: **OK**<br>• `late_propose_body_keys_exact`: **OK** | `s5-late_propose_verified-1440-light.png` |
| `late_approve_verified` | 1440px | light | **PASS** | 0 | NO | • `late_approve_exactly_one_post`: **OK**<br>• `late_approve_body_keys_exact`: **OK** | `s5-late_approve_verified-1440-light.png` |
| `late_reject_verified` | 1440px | light | **PASS** | 0 | NO | • `late_reject_exactly_one_post`: **OK**<br>• `late_reject_body_keys_exact`: **OK** | `s5-late_reject_verified-1440-light.png` |
| `late_retry_verified` | 1440px | light | **PASS** | 0 | NO | • `late_retry_exactly_one_post`: **OK**<br>• `late_retry_body_keys_empty_object`: **OK**<br>• `credited_text_absent_on_execution_failed`: **OK** | `s5-late_retry_verified-1440-light.png` |
| `late_recovery_open_verified` | 1440px | light | **PASS** | 0 | NO | • `late_open_recovery_exactly_one_post`: **OK**<br>• `late_open_recovery_body_keys_exact`: **OK** | `s5-late_recovery_open_verified-1440-light.png` |
| `late_flag_off_no_write_controls` | 1440px | light | **PASS** | 0 | NO | • `late_flag_off_no_write_buttons`: **OK** | `s5-late_flag_off_no_write_controls-1440-light.png` |

## S6: /admin/complaints legacy page (Trang khiếu nại phòng tập cũ)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `complaints_default` | 360px | light | **PASS** | 0 | NO | • `complaints_page_visible`: **OK** | `s6-complaints_default-360-light.png` |
| `complaints_default` | 375px | light | **PASS** | 0 | NO | • `complaints_page_visible`: **OK** | `s6-complaints_default-375-light.png` |
| `complaints_default` | 390px | light | **PASS** | 0 | NO | • `complaints_page_visible`: **OK** | `s6-complaints_default-390-light.png` |
| `complaints_default` | 412px | light | **PASS** | 0 | NO | • `complaints_page_visible`: **OK** | `s6-complaints_default-412-light.png` |
| `complaints_default` | 1440px | light | **PASS** | 0 | NO | • `complaints_page_visible`: **OK** | `s6-complaints_default-1440-light.png` |
| `complaints_default` | 1440px | dark | **PASS** | 0 | NO | • `complaints_page_visible`: **OK** | `s6-complaints_default-1440-dark.png` |
| `resolve_case_required_verified` | 1440px | light | **PASS** | 0 | NO | • `no_auto_refund_sentence_present`: **OK**<br>• `case_required_error_alert_visible`: **OK**<br>• `link_to_gym_case_visible`: **OK** | `s6-resolve_case_required_verified-1440-light.png` |

## S7: Gym case workspace (Hồ sơ khiếu nại phòng tập admin 4 mắt)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `gym_case_default` | 360px | light | **PASS** | 0 | NO | • `gym_case_page_visible`: **OK** | `s7-gym_case_default-360-light.png` |
| `gym_case_default` | 375px | light | **PASS** | 0 | NO | • `gym_case_page_visible`: **OK** | `s7-gym_case_default-375-light.png` |
| `gym_case_default` | 390px | light | **PASS** | 0 | NO | • `gym_case_page_visible`: **OK** | `s7-gym_case_default-390-light.png` |
| `gym_case_default` | 412px | light | **PASS** | 0 | NO | • `gym_case_page_visible`: **OK** | `s7-gym_case_default-412-light.png` |
| `gym_case_default` | 1440px | light | **PASS** | 0 | NO | • `gym_case_page_visible`: **OK** | `s7-gym_case_default-1440-light.png` |
| `gym_case_default` | 1440px | dark | **PASS** | 0 | NO | • `gym_case_page_visible`: **OK** | `s7-gym_case_default-1440-dark.png` |
| `step1_assign` | 1440px | light | **PASS** | 0 | NO | • `gym_case_assign_exactly_one_post`: **OK**<br>• `gym_case_assign_body_valid`: **OK** | `s7-step1_assign-1440-light.png` |
| `step2_finding` | 1440px | light | **PASS** | 0 | NO | • `gym_case_finding_exactly_one_post`: **OK**<br>• `gym_case_finding_body_keys_exact`: **OK** | `s7-step2_finding-1440-light.png` |
| `step3_proposal` | 1440px | light | **PASS** | 0 | NO | • `gym_case_proposal_exactly_one_post`: **OK**<br>• `gym_case_proposal_body_keys_exact`: **OK** | `s7-step3_proposal-1440-light.png` |
| `step4_decision` | 1440px | light | **PASS** | 0 | NO | • `gym_case_decision_second_admin_exactly_one_post`: **OK**<br>• `gym_case_decision_body_keys_exact`: **OK** | `s7-step4_decision-1440-light.png` |
| `step5_execute` | 1440px | light | **PASS** | 0 | NO | • `gym_case_execute_exactly_one_post`: **OK**<br>• `gym_case_execute_result_note_visible`: **OK** | `s7-step5_execute-1440-light.png` |
| `gym_case_disabled_no_write_controls` | 1440px | light | **PASS** | 0 | NO | • `gym_case_disabled_no_write_buttons`: **OK**<br>• `gym_case_disabled_write_off_note_visible`: **OK** | `s7-gym_case_disabled_no_write_controls-1440-light.png` |

## S8: Member gym complaints (Khiếu nại phòng tập phía hội viên)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `member_cases_list_default` | 360px | light | **PASS** | 0 | NO | • `member_cases_list_visible`: **OK** | `s8-member_cases_list_default-360-light.png` |
| `member_cases_list_default` | 375px | light | **PASS** | 0 | NO | • `member_cases_list_visible`: **OK** | `s8-member_cases_list_default-375-light.png` |
| `member_cases_list_default` | 390px | light | **PASS** | 0 | NO | • `member_cases_list_visible`: **OK** | `s8-member_cases_list_default-390-light.png` |
| `member_cases_list_default` | 412px | light | **PASS** | 0 | NO | • `member_cases_list_visible`: **OK** | `s8-member_cases_list_default-412-light.png` |
| `member_cases_list_default` | 1440px | light | **PASS** | 0 | NO | • `member_cases_list_visible`: **OK** | `s8-member_cases_list_default-1440-light.png` |
| `member_cases_list_default` | 1440px | dark | **PASS** | 0 | NO | • `member_cases_list_visible`: **OK** | `s8-member_cases_list_default-1440-dark.png` |
| `member_case_detail_write_forms_stay_hidden` | 1440px | light | **PASS** | 0 | NO | • `member_case_detail_visible`: **OK**<br>• `member_case_write_forms_hidden_notice_visible`: **OK**<br>• `member_case_zero_input_forms`: **OK** | `s8-member_case_detail_write_forms_stay_hidden-1440-light.png` |

## S9: Party dispute page (Khiếu nại phía đương sự khách/PT)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `party_dispute_list_default` | 360px | light | **PASS** | 0 | NO | • `party_list_visible`: **OK**<br>• `party_list_no_admin_internal_data`: **OK** | `s9-party_dispute_list_default-360-light.png` |
| `party_dispute_list_default` | 375px | light | **PASS** | 0 | NO | • `party_list_visible`: **OK**<br>• `party_list_no_admin_internal_data`: **OK** | `s9-party_dispute_list_default-375-light.png` |
| `party_dispute_list_default` | 390px | light | **PASS** | 0 | NO | • `party_list_visible`: **OK**<br>• `party_list_no_admin_internal_data`: **OK** | `s9-party_dispute_list_default-390-light.png` |
| `party_dispute_list_default` | 412px | light | **PASS** | 0 | NO | • `party_list_visible`: **OK**<br>• `party_list_no_admin_internal_data`: **OK** | `s9-party_dispute_list_default-412-light.png` |
| `party_dispute_list_default` | 1440px | light | **PASS** | 0 | NO | • `party_list_visible`: **OK**<br>• `party_list_no_admin_internal_data`: **OK** | `s9-party_dispute_list_default-1440-light.png` |
| `party_dispute_list_default` | 1440px | dark | **PASS** | 0 | NO | • `party_list_visible`: **OK**<br>• `party_list_no_admin_internal_data`: **OK** | `s9-party_dispute_list_default-1440-dark.png` |
| `party_statement_v1_verified` | 1440px | light | **PASS** | 0 | NO | • `party_statement_v1_exactly_one_post_on_dblclick`: **OK**<br>• `party_statement_v1_has_idempotency_key`: **OK**<br>• `party_statement_v1_body_keys_exact`: **OK** | `s9-party_statement_v1_verified-1440-light.png` |
| `party_statement_v2_verified` | 1440px | light | **PASS** | 0 | NO | • `party_statement_v2_exactly_one_post`: **OK**<br>• `party_statement_v2_has_idempotency_key`: **OK**<br>• `party_statement_v2_body_keys_exact`: **OK** | `s9-party_statement_v2_verified-1440-light.png` |
| `party_document_and_money_verified` | 1440px | light | **PASS** | 0 | NO | • `party_document_exactly_one_post`: **OK**<br>• `party_document_has_idempotency_key`: **OK**<br>• `party_document_body_keys_exact`: **OK**<br>• `party_money_shows_no_monetary_amount`: **OK** | `s9-party_document_and_money_verified-1440-light.png` |

## S10: Account switch isolation (Cách ly chuyển đổi tài khoản nghiêm ngặt)

| State | Width | Theme | Result | Axe (Serious/Critical) | Overflow | Assertions (Names, OK/FAIL) | Screenshot |
|---|---|---|---|---|---|---|---|
| `account_switch_real_logout_login_verified` | 1440px | light | **PASS** | 0 | NO | • `real_logout_redirects_to_login`: **OK**<br>• `client_page_has_no_admin_data_or_name`: **OK**<br>• `repeat_login_as_admin2_shows_admin2_identity`: **OK** | `s10-account_switch_real_logout_login_verified-1440-light.png` |

