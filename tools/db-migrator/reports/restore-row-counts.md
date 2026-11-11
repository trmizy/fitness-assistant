# Restore Row Counts

Generated (UTC): 2026-09-23T14:25:05Z

"MISSING" = the table is present in the source dump but does not exist in Aurora.
"EMPTY" = the table exists in Aurora with 0 rows. Both are reported explicitly
so an empty-but-present table is never confused with a table that never restored.

## fitness_assistant (auth-service)

| Table | Rows | Status |
|---|---|---|
| _prisma_migrations | 7 | OK |
| audit_logs | 21308 | OK |
| email_verifications | 7 | OK |
| partner_application_tokens | 0 | EMPTY |
| password_reset_tokens | 0 | EMPTY |
| pt_deactivation_calls | 0 | EMPTY |
| refresh_tokens | 1671 | OK |
| users | 164 | OK |

## fitness_assistant_user (user-service)

| Table | Rows | Status |
|---|---|---|
| UserPreference | 1 | OK |
| _prisma_migrations | 26 | OK |
| agent_contract_drafts | 0 | EMPTY |
| audit_logs | 98 | OK |
| client_journeys | 331 | OK |
| client_reviews | 0 | EMPTY |
| contracts | 1574 | OK |
| inbody_entries | 5387 | OK |
| notification_preferences | 0 | EMPTY |
| notifications | 9386 | OK |
| pt_application_certificates | 35 | OK |
| pt_application_media | 0 | EMPTY |
| pt_applications | 102 | OK |
| pt_availability | 721 | OK |
| pt_schedule_exceptions | 0 | EMPTY |
| pt_service_packages | 96 | OK |
| pt_training_locations | 0 | EMPTY |
| session_reschedule_requests | 1 | OK |
| session_reviews | 3103 | OK |
| session_settlements | 119 | OK |
| sessions | 7151 | OK |
| user_profiles | 562 | OK |
| vietnam_provinces | 34 | OK |
| vietnam_wards | 3321 | OK |

## fitness_assistant_fitness (fitness-service)

| Table | Rows | Status |
|---|---|---|
| _prisma_migrations | 48 | OK |
| body_metrics | 30556 | OK |
| coach_client_action_audits | 47 | OK |
| cycle_assessments | 32 | OK |
| cycle_feedback_analysis_audits | 0 | EMPTY |
| cycle_feedback_summaries | 14 | OK |
| cycle_inbody_links | 14 | OK |
| cycle_session_feedback | 32 | OK |
| equipment | 46 | OK |
| exercise_aliases | 147 | OK |
| exercise_equipment | 1113 | OK |
| exercise_muscles | 2996 | OK |
| exercise_review_decisions | 0 | EMPTY |
| exercise_session_feedback | 1 | OK |
| exercise_sources | 1035 | OK |
| exercises | 1027 | OK |
| fitness_roadmaps | 21 | OK |
| food_aliases | 2200 | OK |
| food_sources | 0 | EMPTY |
| foods | 13159 | OK |
| import_batches | 61 | OK |
| import_records | 42780 | OK |
| muscles | 29 | OK |
| nutrition_goals | 20 | OK |
| nutrition_logs | 299057 | OK |
| nutrition_meal_completions | 0 | EMPTY |
| nutrition_program_days | 43 | OK |
| nutrition_program_meal_items | 359 | OK |
| nutrition_program_meals | 128 | OK |
| nutrition_programs | 7 | OK |
| plan_generation_audits | 0 | EMPTY |
| recipe_ingredients | 77 | OK |
| recipes | 15 | OK |
| recommendation_audits | 40 | OK |
| roadmap_phases | 26 | OK |
| training_cycles | 45 | OK |
| user_equipment | 157 | OK |
| workout_exercises | 165900 | OK |
| workout_import_batches | 0 | EMPTY |
| workout_mutation_events | 3 | OK |
| workout_program_days | 24321 | OK |
| workout_program_exercise_group_members | 4 | OK |
| workout_program_exercise_groups | 2 | OK |
| workout_program_exercise_set_prescriptions | 266631 | OK |
| workout_program_exercises | 85080 | OK |
| workout_program_templates | 1 | OK |
| workout_programs | 5570 | OK |
| workout_schedules | 37901 | OK |
| workout_set_segments | 0 | EMPTY |
| workout_sets | 662655 | OK |
| workouts | 41607 | OK |

## fitness_assistant_gym (gym-service)

| Table | Rows | Status |
|---|---|---|
| _prisma_migrations | 9 | OK |
| gym_branch_documents | 0 | EMPTY |
| gym_branch_review_issues | 0 | EMPTY |
| gym_brands | 1 | OK |
| gym_check_ins | 0 | EMPTY |
| gym_complaints | 0 | EMPTY |
| gym_membership_contracts | 14 | OK |
| gym_membership_plans | 8 | OK |
| gym_membership_referrals | 0 | EMPTY |
| gym_operating_hours | 0 | EMPTY |
| gym_partner_accounts | 1 | OK |
| gym_partner_contact_logs | 0 | EMPTY |
| gym_partner_document_files | 0 | EMPTY |
| gym_partner_documents | 0 | EMPTY |
| gym_partner_review_issues | 0 | EMPTY |
| gym_partners | 1 | OK |
| gym_photos | 0 | EMPTY |
| gym_pt_collaborations | 4 | OK |
| gym_reviews | 0 | EMPTY |
| gym_trainer_affiliations | 1 | OK |
| gyms | 12 | OK |
| partner_audit_logs | 0 | EMPTY |
| partner_internal_notes | 0 | EMPTY |
| partner_invitations | 0 | EMPTY |
| partner_upload_intents | 0 | EMPTY |
| platform_commission_rates | 1 | OK |

## fitness_assistant_payment (payment-service)

| Table | Rows | Status |
|---|---|---|
| _prisma_migrations | 11 | OK |
| ledger_operations | 10 | OK |
| partner_receivables | 0 | EMPTY |
| payment_transactions | 141 | OK |
| payment_webhook_events | 63 | OK |
| platform_commissions | 46 | OK |
| wallet_ledger_entries | 406 | OK |
| wallets | 379 | OK |
| withdrawal_requests | 0 | EMPTY |

## fitness_assistant_chat (chat-service)

| Table | Rows | Status |
|---|---|---|
| _prisma_migrations | 3 | OK |
| call_sessions | 18 | OK |
| conversation_participants | 2950 | OK |
| conversations | 1475 | OK |
| messages | 10318 | OK |

## fitness_assistant_ai (ai-service)

| Table | Rows | Status |
|---|---|---|
| _prisma_migrations | 22 | OK |
| agent_workflow_sessions | 2 | OK |
| chat_sessions | 256 | OK |
| conversations | 30645 | OK |
| fitness_agent_actions | 76 | OK |
| fitness_recommendations | 30 | OK |
| knowledge_chunks | 129 | OK |
| knowledge_documents | 166 | OK |
| knowledge_pipeline_runs | 110 | OK |
| knowledge_review_queue | 69 | OK |
| knowledge_sources | 7 | OK |
| nutrition_plans | 45 | OK |
| personalized_service_checkins | 241 | OK |
| personalized_service_orders | 3663 | OK |
| personalized_service_plan_versions | 2662 | OK |
| personalized_service_reviews | 157 | OK |
| personalized_service_revision_requests | 762 | OK |
| personalized_services | 3836 | OK |
| plan_adoptions | 76 | OK |
| plan_improvement_suggestions | 89 | OK |
| plan_moderation_analyses | 1057 | OK |
| plan_reviews | 83 | OK |
| published_plans | 2168 | OK |
| training_package_purchases | 1 | OK |
| training_packages | 165 | OK |
| user_memories | 0 | EMPTY |
| workout_plans | 10578 | OK |

