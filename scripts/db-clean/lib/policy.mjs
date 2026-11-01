/**
 * db-clean - WHICH rows survive a cleanup (plan 8.1, 9, 12.13 item 8). One rule per table, as a SQL "keep" predicate.
 *
 * Rows to DELETE = rows for which the keep predicate is not TRUE. Everything is expressed against three parameters that every
 * query receives:
 *   $1 text[]  the user ids of the APPROVED preserved accounts (resolved from auth.users by e-mail)
 *   $2 text[]  their e-mails (lower case)
 *   $3 text[]  the ids of the gyms that survive in gym-service (cross-database reference used by payment-service wallets)
 *
 * Semantics (decisions are listed as QUESTIONS in the Phase G report, they are not silent):
 *   PRESERVE  catalogue / reference / system / evidence tables - never touched (also checked by row counts at commit time).
 *   ownAll(c1, c2, ...)  a row that names user accounts is kept only if AT LEAST ONE of the columns is set and EVERY column that is set
 *             is a preserved account. A contract between a preserved account and a deleted one is therefore deleted (it would
 *             otherwise point at an account that no longer exists). This is the "drop mixed rows" default; the audit counts them.
 *   childOf(parent, [fk, ref]...)  a child row is kept only if its parent row is kept (so an FK can never end up dangling).
 *   Owner-side objects (gym brands, gyms, partners, listings, services) are kept iff their owner is preserved; everything below them
 *   follows through childOf / ownAll.
 *
 * Tables that exist in a database but have no rule here are reported as UNCLASSIFIED and block `clean` - the tool never guesses.
 */
export const preserve = (why) => ({ kind: 'PRESERVE', why });

const inP = (a, c) => `${a}."${c}" = ANY($1::text[])`;

export function ownAll(...cols) {
  return {
    kind: 'KEEP',
    owners: cols,
    note: cols.length > 1 ? 'mixed rows (one preserved + one deleted account) are deleted' : undefined,
    sql: (a) => {
      if (cols.length === 1) return inP(a, cols[0]);
      const anySet = cols.map((c) => `${a}."${c}" IS NOT NULL`).join(' OR ');
      const allOk = cols.map((c) => `(${a}."${c}" IS NULL OR ${inP(a, c)})`).join(' AND ');
      return `(${anySet}) AND ${allOk}`;
    },
  };
}
/** Optional counterpart column(s): every non-null value must be a preserved account; null is fine. */
export function ownOpt(...cols) {
  return {
    kind: 'KEEP',
    owners: cols,
    sql: (a) => cols.map((c) => `(${a}."${c}" IS NULL OR ${inP(a, c)})`).join(' AND '),
  };
}
export function childOf(parent, ...pairs) {
  return {
    kind: 'KEEP',
    covers: [{ parent, pairs }],
    sql: (a, h) => {
      const p = h.uid();
      return `EXISTS (SELECT 1 FROM "${parent}" ${p} WHERE ${pairs.map(([f, r]) => `${p}."${r}" = ${a}."${f}"`).join(' AND ')} AND ${h.K(parent, p)})`;
    },
  };
}
/** Like childOf but a NULL foreign key is fine (the FK is nullable and the child does not need the parent). */
export function childOfOrNull(parent, ...pairs) {
  return {
    kind: 'KEEP',
    covers: [{ parent, pairs }],
    sql: (a, h) => {
      const p = h.uid();
      return `(${pairs.map(([f]) => `${a}."${f}" IS NULL`).join(' OR ')} OR EXISTS (SELECT 1 FROM "${parent}" ${p} WHERE ${pairs.map(([f, r]) => `${p}."${r}" = ${a}."${f}"`).join(' AND ')} AND ${h.K(parent, p)}))`;
    },
  };
}
export function all(...rules) {
  return {
    kind: 'KEEP',
    owners: rules.flatMap((r) => r.owners || []),
    covers: rules.flatMap((r) => r.covers || []),
    sql: (a, h) => rules.map((r) => `(${r.sql(a, h)})`).join(' AND '),
  };
}
export const raw = (fn, extra = {}) => ({ kind: 'KEEP', sql: fn, ...extra });

// ====================================================================================================================
// auth-service
// ====================================================================================================================
const auth = {
  _prisma_migrations: preserve('migration history'),
  users: raw((a) => inP(a, 'id'), { owners: ['id'] }),
  audit_logs: childOf('users', ['userId', 'id']),
  refresh_tokens: childOf('users', ['userId', 'id']),
  password_reset_tokens: childOf('users', ['user_id', 'id']),
  email_verifications: raw((a) => `lower(${a}."email") = ANY($2::text[])`),
  partner_application_tokens: raw((a) => `(lower(${a}."email") = ANY($2::text[]) OR ${inP(a, 'created_user_id')})`),
  pt_deactivation_calls: ownAll('pt_user_id'),
};

// ====================================================================================================================
// user-service
// ====================================================================================================================
const user = {
  _prisma_migrations: preserve('migration history (also holds the failed 20261021140000 row - never touched by this tool)'),
  vietnam_provinces: preserve('geography reference data'),
  vietnam_wards: preserve('geography reference data'),
  client_compat_events: preserve('telemetry that is evidence for retiring LISTING_LEGACY_CLIENT_COMPAT (14-day window)'),
  UserPreference: ownAll('userId'),
  agent_contract_drafts: ownAll('user_id', 'pt_id'),
  audit_logs: ownAll('actor_user_id'),
  client_journeys: all(ownAll('user_id', 'pt_id'), childOfOrNull('contracts', ['contract_id', 'id'])),
  client_reviews: childOf('sessions', ['session_id', 'id']),
  contracts: ownAll('client_user_id', 'pt_user_id'),
  inbody_entries: ownAll('user_id'),
  notification_preferences: ownAll('user_id'),
  notifications: ownAll('user_id'),
  pt_application_certificates: childOf('pt_applications', ['application_id', 'id']),
  pt_application_media: childOf('pt_applications', ['application_id', 'id']),
  pt_applications: childOf('user_profiles', ['user_profile_id', 'id']),
  pt_availability: ownAll('pt_user_id'),
  pt_listing_revisions: ownAll('pt_user_id'),
  pt_media_upload_intents: ownAll('pt_user_id'),
  pt_physique_photos: ownAll('pt_user_id'),
  pt_restriction_contract_extensions: childOf('pt_restrictions', ['restriction_id', 'id']),
  pt_restrictions: all(ownAll('pt_user_id'), childOfOrNull('contracts', ['contract_id', 'id'])),
  pt_schedule_exceptions: ownAll('pt_user_id'),
  pt_service_packages: ownAll('pt_user_id'),
  pt_terms_acceptances: ownAll('user_id'),
  pt_training_locations: ownAll('pt_user_id'),
  push_devices: ownAll('user_id'),
  session_reschedule_requests: childOf('sessions', ['session_id', 'id']),
  session_reviews: childOf('sessions', ['session_id', 'id']),
  session_settlements: childOf('contracts', ['contract_id', 'id']),
  sessions: childOf('contracts', ['contract_id', 'id']),
  user_profiles: ownAll('userId'),
};

// ====================================================================================================================
// fitness-service (PARTNER OWNED)
// ====================================================================================================================
const fitness = {
  _prisma_migrations: preserve('migration history'),
  equipment: preserve('catalogue'),
  muscles: preserve('catalogue'),
  foods: preserve('catalogue'),
  food_aliases: preserve('catalogue'),
  food_sources: preserve('catalogue'),
  recipes: preserve('catalogue'),
  recipe_ingredients: preserve('catalogue'),
  import_batches: preserve('catalogue import history'),
  import_records: preserve('catalogue import history'),
  exercise_review_decisions: preserve('catalogue review audit'),
  exercises: raw((a) => `(${a}."owner_id" IS NULL OR ${inP(a, 'owner_id')})`, { owners: ['owner_id'], note: 'system exercises (owner_id NULL) stay; custom exercises survive only for preserved owners' }),
  exercise_aliases: childOf('exercises', ['exercise_id', 'id']),
  exercise_equipment: childOf('exercises', ['exercise_id', 'id']),
  exercise_muscles: childOf('exercises', ['exercise_id', 'id']),
  exercise_sources: childOf('exercises', ['exercise_id', 'id']),
  body_metrics: ownAll('user_id'),
  coach_client_action_audits: ownAll('pt_user_id', 'client_user_id'),
  cycle_assessments: childOf('training_cycles', ['cycle_id', 'id']),
  cycle_feedback_analysis_audits: childOf('training_cycles', ['cycle_id', 'id']),
  cycle_feedback_summaries: childOf('training_cycles', ['cycle_id', 'id']),
  cycle_inbody_links: childOf('training_cycles', ['cycle_id', 'id']),
  cycle_session_feedback: childOf('training_cycles', ['cycle_id', 'id']),
  exercise_session_feedback: childOf('cycle_session_feedback', ['session_feedback_id', 'id']),
  fitness_roadmaps: ownAll('user_id', 'created_by_user_id'),
  nutrition_goals: ownAll('user_id', 'created_by_user_id'),
  nutrition_logs: ownAll('user_id'),
  nutrition_meal_completions: ownAll('user_id'),
  nutrition_program_days: childOf('nutrition_programs', ['program_id', 'id']),
  nutrition_program_meal_items: childOf('nutrition_program_meals', ['meal_id', 'id']),
  nutrition_program_meals: childOf('nutrition_program_days', ['day_id', 'id']),
  nutrition_programs: ownAll('user_id'),
  plan_generation_audits: ownAll('pt_user_id', 'client_user_id'),
  recommendation_audits: ownAll('user_id'),
  roadmap_phases: childOf('fitness_roadmaps', ['roadmap_id', 'id']),
  training_cycles: all(ownAll('user_id'), childOfOrNull('roadmap_phases', ['roadmap_phase_id', 'id'])),
  user_equipment: ownAll('user_id'),
  workout_exercises: childOf('workouts', ['workout_id', 'id']),
  workout_import_batches: ownAll('user_id'),
  workout_mutation_events: ownAll('user_id'),
  workout_program_days: childOf('workout_programs', ['program_id', 'id']),
  workout_program_exercise_group_members: childOf('workout_program_exercise_groups', ['group_id', 'id']),
  workout_program_exercise_groups: childOf('workout_program_days', ['program_day_id', 'id']),
  workout_program_exercise_set_prescriptions: childOf('workout_program_exercises', ['program_exercise_id', 'id']),
  workout_program_exercises: childOf('workout_program_days', ['program_day_id', 'id']),
  workout_program_templates: ownAll('created_by_user_id'),
  workout_programs: ownAll('user_id'),
  workout_schedules: all(
    ownAll('user_id'),
    childOfOrNull('workouts', ['workout_id', 'id']),
    childOfOrNull('training_cycles', ['training_cycle_id', 'id']),
    childOfOrNull('workout_program_days', ['program_day_id', 'id']),
  ),
  workout_set_segments: childOf('workout_sets', ['workout_set_id', 'id']),
  workout_sets: childOf('workout_exercises', ['workout_exercise_id', 'id']),
  workouts: ownAll('user_id'),
};

// ====================================================================================================================
// ai-service (PARTNER OWNED)
// ====================================================================================================================
const ai = {
  _prisma_migrations: preserve('migration history'),
  knowledge_sources: preserve('knowledge base (crawled content, vectors live in qdrant)'),
  knowledge_documents: preserve('knowledge base'),
  knowledge_chunks: preserve('knowledge base'),
  knowledge_pipeline_runs: preserve('knowledge base'),
  knowledge_review_queue: preserve('knowledge base'),
  agent_workflow_sessions: ownAll('user_id'),
  chat_sessions: ownAll('user_id'),
  conversations: ownAll('user_id'),
  fitness_agent_actions: ownAll('user_id'),
  fitness_recommendations: ownAll('user_id'),
  nutrition_plans: ownAll('user_id'),
  user_memories: ownAll('user_id'),
  workout_plans: ownAll('user_id', 'pt_user_id'),
  personalized_services: ownAll('seller_id'),
  personalized_service_orders: all(ownAll('seller_id', 'buyer_id'), childOf('personalized_services', ['service_id', 'id'])),
  personalized_service_checkins: childOf('personalized_service_orders', ['order_id', 'id']),
  personalized_service_plan_versions: childOf('personalized_service_orders', ['order_id', 'id']),
  personalized_service_reviews: childOf('personalized_service_orders', ['order_id', 'id']),
  personalized_service_revision_requests: childOf('personalized_service_orders', ['order_id', 'id']),
  published_plans: all(ownAll('publisher_id'), childOf('workout_plans', ['source_plan_id', 'id'])),
  plan_adoptions: all(ownAll('adopter_id'), childOf('published_plans', ['published_plan_id', 'id'])),
  plan_improvement_suggestions: childOf('published_plans', ['published_plan_id', 'id']),
  plan_moderation_analyses: childOf('published_plans', ['published_plan_id', 'id']),
  plan_reviews: all(ownAll('reviewer_id'), childOf('published_plans', ['published_plan_id', 'id'])),
  training_packages: all(ownAll('seller_id'), childOf('published_plans', ['published_plan_id', 'id'])),
  training_package_purchases: all(ownAll('buyer_id'), childOf('training_packages', ['package_id', 'id'])),
};

// ====================================================================================================================
// chat-service
// ====================================================================================================================
const chat = {
  _prisma_migrations: preserve('migration history'),
  conversations: raw(
    (a) =>
      `EXISTS (SELECT 1 FROM "conversation_participants" cp WHERE cp."conversationId" = ${a}."id") AND NOT EXISTS (SELECT 1 FROM "conversation_participants" cq WHERE cq."conversationId" = ${a}."id" AND NOT COALESCE(cq."userId" = ANY($1::text[]), FALSE))`,
    { note: 'kept only when every participant is a preserved account' },
  ),
  conversation_participants: childOf('conversations', ['conversationId', 'id']),
  messages: childOf('conversations', ['conversationId', 'id']),
  call_sessions: childOf('conversations', ['conversationId', 'id']),
};

// ====================================================================================================================
// payment-service  (MONEY - every choice here is a question for the owner, see the Phase G report)
// ====================================================================================================================
const payment = {
  _prisma_migrations: preserve('migration history'),
  wallets: raw((a) => `(${a}."owner_type"::text = 'PLATFORM' OR ${inP(a, 'owner_id')} OR ${a}."owner_id" = ANY($3::text[]))`, {
    note: 'PLATFORM wallets are kept; user wallets of preserved accounts; GYM wallets of surviving gyms',
  }),
  wallet_ledger_entries: childOf('wallets', ['wallet_id', 'id']),
  withdrawal_requests: childOf('wallets', ['wallet_id', 'id']),
  payment_transactions: raw(
    (a, h) => {
      const e = h.uid();
      return `(EXISTS (SELECT 1 FROM "wallet_ledger_entries" ${e} WHERE ${e}."transaction_id" = ${a}."id" AND ${h.K('wallet_ledger_entries', e)})
        OR (${inP(a, 'payer_id')} AND (${a}."pt_id" IS NULL OR ${inP(a, 'pt_id')}) AND (${a}."gym_id" IS NULL OR ${a}."gym_id" = ANY($3::text[]))))`;
    },
    { owners: ['payer_id', 'pt_id'], note: 'pinned by any surviving ledger entry (money never loses its trail), or payer/pt/gym all survive' },
  ),
  platform_commissions: childOf('payment_transactions', ['payment_transaction_id', 'id']),
  contract_unpaid_obligations: childOf('payment_transactions', ['transaction_id', 'id']),
  contract_unpaid_obligation_events: childOf('contract_unpaid_obligations', ['obligation_id', 'id']),
  contract_unpaid_obligation_payments: childOf('contract_unpaid_obligations', ['obligation_id', 'id']),
  pt_holdback_reviews: childOf('payment_transactions', ['transaction_id', 'id']),
  pt_holdback_review_events: childOf('pt_holdback_reviews', ['review_id', 'id']),
  partner_receivables: raw((a) => `(${inP(a, 'partner_id')} OR ${a}."partner_id" = ANY($3::text[]))`, { owners: ['partner_id'] }),
  partner_receivable_events: childOf('partner_receivables', ['receivable_id', 'id']),
  ledger_operations: childOf('payment_transactions', ['transaction_id', 'id']),
  payment_webhook_events: raw((a, h) => {
    const x = h.uid();
    return `EXISTS (SELECT 1 FROM "payment_transactions" ${x} WHERE ${x}."provider_transaction_id" = ${a}."provider_transaction_id" AND ${x}."provider" = ${a}."provider" AND ${h.K('payment_transactions', x)})`;
  }),
};

// ====================================================================================================================
// gym-service
// ====================================================================================================================
const gym = {
  _prisma_migrations: preserve('migration history'),
  amenities: preserve('amenity catalogue'),
  amenity_audit_logs: preserve('amenity catalogue audit (admin actions)'),
  platform_commission_rates: preserve('platform configuration'),
  client_compat_events: preserve('evidence for retiring LISTING_LEGACY_CLIENT_COMPAT (14-day window)'),
  legacy_compat_events: preserve('evidence for retiring LISTING_LEGACY_CLIENT_COMPAT (14-day window)'),
  compat_writer_heartbeats: preserve('evidence for retiring LISTING_LEGACY_CLIENT_COMPAT (14-day window)'),
  gym_brands: ownAll('owner_id'),
  gyms: all(ownAll('owner_id'), childOfOrNull('gym_brands', ['brand_id', 'id'])),
  gym_partner_accounts: ownAll('user_id'),
  gym_partners: raw(
    (a, h) => {
      const x = h.uid();
      return `EXISTS (SELECT 1 FROM "gym_partner_accounts" ${x} WHERE ${x}."partner_id" = ${a}."id" AND ${h.K('gym_partner_accounts', x)})`;
    },
    { note: 'kept when at least one of its accounts is a preserved account' },
  ),
  gym_partner_contact_logs: childOf('gym_partners', ['partner_id', 'id']),
  gym_partner_documents: childOf('gym_partners', ['partner_id', 'id']),
  gym_partner_document_files: childOf('gym_partner_documents', ['document_id', 'id']),
  gym_partner_review_issues: childOf('gym_partners', ['partner_id', 'id']),
  partner_audit_logs: childOf('gym_partners', ['partner_id', 'id']),
  partner_internal_notes: childOf('gym_partners', ['partner_id', 'id']),
  partner_invitations: childOf('gym_partners', ['partner_id', 'id']),
  partner_upload_intents: childOf('gym_partners', ['partner_id', 'id']),
  amenity_proposals: raw(
    (a, h) => {
      const g = h.uid();
      const c = h.uid();
      return `((${inP(a, 'owner_user_id')} AND (${a}."gym_id" IS NULL OR EXISTS (SELECT 1 FROM "gyms" ${g} WHERE ${g}."id" = ${a}."gym_id" AND ${h.K('gyms', g)})))
        OR EXISTS (SELECT 1 FROM "amenities" ${c} WHERE ${c}."created_from_proposal_id" = ${a}."id"))`;
    },
    { owners: ['owner_user_id'], note: 'a proposal that created a catalogue amenity is kept (the catalogue row points at it)' },
  ),
  gym_amenities: childOf('gyms', ['gym_id', 'id']),
  gym_branch_documents: childOf('gyms', ['gym_id', 'id']),
  gym_branch_review_issues: childOf('gyms', ['gym_id', 'id']),
  gym_listing_revisions: childOf('gyms', ['gym_id', 'id']),
  gym_operating_hours: childOf('gyms', ['gym_id', 'id']),
  gym_photos: childOf('gyms', ['gym_id', 'id']),
  gym_assisted_checkin_challenges: all(childOf('gyms', ['gym_id', 'id']), ownAll('client_id', 'staff_user_id')),
  gym_assisted_checkin_events: all(childOf('gyms', ['gym_id', 'id']), ownAll('staff_user_id', 'client_id')),
  gym_assisted_checkin_exceptions: all(childOf('gyms', ['gym_id', 'id']), ownAll('client_id', 'requested_by')),
  gym_brand_pt_agreements: all(childOf('gym_brands', ['brand_id', 'id']), ownAll('pt_user_id')),
  gym_pt_agreement_conflicts: all(childOf('gym_brands', ['brand_id', 'id']), ownAll('pt_user_id'), childOfOrNull('gym_brand_pt_agreements', ['resolved_agreement_id', 'id'])),
  gym_membership_plans: childOf('gym_brands', ['brand_id', 'id']),
  gym_membership_contracts: all(childOf('gyms', ['gym_id', 'id']), childOf('gym_membership_plans', ['plan_id', 'id']), ownAll('client_id')),
  gym_check_ins: childOf('gym_membership_contracts', ['membership_id', 'id']),
  gym_membership_referrals: all(childOf('gym_membership_contracts', ['membership_contract_id', 'id']), ownOpt('referrer_pt_user_id')),
  gym_complaints: all(childOf('gyms', ['gym_id', 'id']), ownOpt('reporter_user_id')),
  gym_pt_check_ins: all(childOf('gyms', ['gym_id', 'id']), ownAll('pt_user_id')),
  gym_pt_collaborations: all(childOf('gyms', ['gym_id', 'id']), ownAll('pt_user_id'), childOfOrNull('gym_brand_pt_agreements', ['superseded_by_agreement_id', 'id'])),
  gym_reviews: all(childOf('gyms', ['gym_id', 'id']), ownAll('client_id')),
  gym_trainer_affiliations: all(childOf('gyms', ['gym_id', 'id']), ownAll('pt_id')),
};

export const POLICY = { auth, user, fitness, ai, chat, payment, gym };

/** Columns excluded from rowHash because they legitimately change while an account is simply in use (12.15 item 2). */
export function volatileColumns(columns) {
  return columns
    .map((c) => c.name)
    .filter((n) => /^updated_?at$/i.test(n) || /^last_.*_at$/i.test(n) || /^lastLogin/i.test(n))
    .sort();
}

/** Build the keep-SQL resolver for one database's rules. K(table, alias) -> parenthesised boolean SQL (TRUE for PRESERVE tables). */
export function makeKeep(rules) {
  let uid = 0;
  const K = (table, alias, depth = 0) => {
    if (depth > 10) throw new Error(`policy recursion too deep at ${table}`);
    const rule = rules[table];
    if (!rule) throw new Error(`no policy rule for table ${table}`);
    if (rule.kind === 'PRESERVE') return 'TRUE';
    return `(${rule.sql(alias, { K: (t, a) => K(t, a, depth + 1), uid: () => `z${++uid}` })})`;
  };
  return K;
}
