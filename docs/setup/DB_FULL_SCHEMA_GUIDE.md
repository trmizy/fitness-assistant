# Database Full Schema Guide

Generated: 2026-04-08 21:40:56
Source: PostgreSQL metadata in docker compose dev stack

## Database: gymcoach

### Tables
- _prisma_migrations
- audit_logs
- conversations
- email_verifications
- exercises
- nutrition_logs
- refresh_tokens
- user_profiles
- users
- workout_exercises
- workout_plans
- workouts

### Enum Types (valid values for USER-DEFINED columns)
| Enum Type | Allowed Values |
|---|---|
| ActivityLevel | SEDENTARY, LIGHTLY_ACTIVE, MODERATELY_ACTIVE, VERY_ACTIVE, EXTREMELY_ACTIVE |
| BodyPart | UPPER_BODY, LOWER_BODY, CORE, FULL_BODY |
| EquipmentType | BODYWEIGHT, BARBELL, DUMBBELLS, KETTLEBELL, MACHINE, RESISTANCE_BAND, CABLE, MEDICINE_BALL, FOAM_ROLLER |
| ExerciseType | STRENGTH, CARDIO, MOBILITY, STRENGTH_CARDIO, STRENGTH_MOBILITY |
| ExperienceLevel | BEGINNER, INTERMEDIATE, ADVANCED |
| Gender | MALE, FEMALE, OTHER |
| Goal | WEIGHT_LOSS, MUSCLE_GAIN, MAINTENANCE, ATHLETIC_PERFORMANCE |
| MovementType | PUSH, PULL, HOLD, STRETCH |
| Role | CUSTOMER, PT, ADMIN |
| role | CUSTOMER, PT, ADMIN |

### Column Details
| Table | # | Column | Data Type | Nullable | Default | PK | FK Reference |
|---|---:|---|---|---|---|---|---|
| _prisma_migrations | 1 | id | character varying | NO |  | YES |  |
| _prisma_migrations | 2 | checksum | character varying | NO |  |  |  |
| _prisma_migrations | 3 | finished_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 4 | migration_name | character varying | NO |  |  |  |
| _prisma_migrations | 5 | logs | text | YES |  |  |  |
| _prisma_migrations | 6 | rolled_back_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 7 | started_at | timestamp with time zone | NO | now() |  |  |
| _prisma_migrations | 8 | applied_steps_count | integer | NO | 0 |  |  |
| audit_logs | 1 | id | text | NO |  | YES |  |
| audit_logs | 2 | userId | text | NO |  |  | users.id |
| audit_logs | 3 | action | text | NO |  |  |  |
| audit_logs | 4 | ipAddress | text | YES |  |  |  |
| audit_logs | 5 | userAgent | text | YES |  |  |  |
| audit_logs | 6 | metadata | jsonb | YES |  |  |  |
| audit_logs | 7 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| conversations | 1 | id | text | NO |  | YES |  |
| conversations | 2 | user_id | text | YES |  |  |  |
| conversations | 3 | question | text | NO |  |  |  |
| conversations | 4 | answer | text | NO |  |  |  |
| conversations | 5 | model_used | text | NO |  |  |  |
| conversations | 6 | response_time | double precision | NO |  |  |  |
| conversations | 7 | relevance | text | YES |  |  |  |
| conversations | 8 | relevance_explanation | text | YES |  |  |  |
| conversations | 9 | prompt_tokens | integer | NO |  |  |  |
| conversations | 10 | completion_tokens | integer | NO |  |  |  |
| conversations | 11 | total_tokens | integer | NO |  |  |  |
| conversations | 12 | cost | double precision | NO | 0 |  |  |
| conversations | 13 | feedback | integer | YES |  |  |  |
| conversations | 14 | feedback_timestamp | timestamp without time zone | YES |  |  |  |
| conversations | 15 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| email_verifications | 1 | id | text | NO |  | YES |  |
| email_verifications | 2 | email | text | NO |  |  |  |
| email_verifications | 3 | passwordHash | text | NO |  |  |  |
| email_verifications | 4 | firstName | text | YES |  |  |  |
| email_verifications | 5 | lastName | text | YES |  |  |  |
| email_verifications | 6 | otpHash | text | NO |  |  |  |
| email_verifications | 7 | attempts | integer | NO | 0 |  |  |
| email_verifications | 8 | expiresAt | timestamp without time zone | NO |  |  |  |
| email_verifications | 9 | sentAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| email_verifications | 10 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| email_verifications | 11 | updatedAt | timestamp without time zone | NO |  |  |  |
| exercises | 1 | id | text | NO |  | YES |  |
| exercises | 2 | exercise_name | text | NO |  |  |  |
| exercises | 3 | type_of_activity | USER-DEFINED | NO |  |  |  |
| exercises | 4 | type_of_equipment | USER-DEFINED | NO |  |  |  |
| exercises | 5 | body_part | USER-DEFINED | NO |  |  |  |
| exercises | 6 | type | USER-DEFINED | NO |  |  |  |
| exercises | 7 | muscle_groups_activated | ARRAY | YES |  |  |  |
| exercises | 8 | instructions | text | NO |  |  |  |
| exercises | 9 | video_url | text | YES |  |  |  |
| exercises | 10 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| exercises | 11 | updated_at | timestamp without time zone | NO |  |  |  |
| nutrition_logs | 1 | id | text | NO |  | YES |  |
| nutrition_logs | 2 | user_id | text | NO |  |  |  |
| nutrition_logs | 3 | date | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| nutrition_logs | 4 | meal_type | text | NO |  |  |  |
| nutrition_logs | 5 | food_name | text | NO |  |  |  |
| nutrition_logs | 6 | calories | integer | NO |  |  |  |
| nutrition_logs | 7 | protein | double precision | YES |  |  |  |
| nutrition_logs | 8 | carbs | double precision | YES |  |  |  |
| nutrition_logs | 9 | fats | double precision | YES |  |  |  |
| nutrition_logs | 10 | notes | text | YES |  |  |  |
| nutrition_logs | 11 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| nutrition_logs | 12 | updated_at | timestamp without time zone | NO |  |  |  |
| refresh_tokens | 1 | id | text | NO |  | YES |  |
| refresh_tokens | 2 | token | text | NO |  |  |  |
| refresh_tokens | 3 | userId | text | NO |  |  | users.id |
| refresh_tokens | 4 | expiresAt | timestamp without time zone | NO |  |  |  |
| refresh_tokens | 5 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| user_profiles | 1 | id | text | NO |  | YES |  |
| user_profiles | 2 | userId | text | NO |  |  |  |
| user_profiles | 3 | age | integer | YES |  |  |  |
| user_profiles | 4 | gender | USER-DEFINED | YES |  |  |  |
| user_profiles | 5 | heightCm | double precision | YES |  |  |  |
| user_profiles | 6 | goal | USER-DEFINED | YES |  |  |  |
| user_profiles | 7 | activityLevel | USER-DEFINED | YES |  |  |  |
| user_profiles | 8 | experienceLevel | USER-DEFINED | YES |  |  |  |
| user_profiles | 9 | preferredTrainingDays | ARRAY | YES |  |  |  |
| user_profiles | 10 | availableEquipment | ARRAY | YES |  |  |  |
| user_profiles | 11 | injuries | ARRAY | YES |  |  |  |
| user_profiles | 12 | currentWeight | double precision | YES |  |  |  |
| user_profiles | 13 | targetWeight | double precision | YES |  |  |  |
| user_profiles | 14 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| user_profiles | 15 | updatedAt | timestamp without time zone | NO |  |  |  |
| user_profiles | 16 | isPT | boolean | NO | false |  |  |
| users | 1 | id | text | NO |  | YES |  |
| users | 2 | email | text | NO |  |  |  |
| users | 3 | password | text | NO |  |  |  |
| users | 4 | firstName | text | YES |  |  |  |
| users | 5 | lastName | text | YES |  |  |  |
| users | 6 | role | USER-DEFINED | NO | 'CUSTOMER'::"Role" |  |  |
| users | 7 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| users | 8 | updatedAt | timestamp without time zone | NO |  |  |  |
| workout_exercises | 1 | id | text | NO |  | YES |  |
| workout_exercises | 2 | workout_id | text | NO |  |  | workouts.id |
| workout_exercises | 3 | exercise_id | text | NO |  |  | exercises.id |
| workout_exercises | 4 | sets | integer | NO |  |  |  |
| workout_exercises | 5 | reps | integer | YES |  |  |  |
| workout_exercises | 6 | duration | integer | YES |  |  |  |
| workout_exercises | 7 | weight | double precision | YES |  |  |  |
| workout_exercises | 8 | notes | text | YES |  |  |  |
| workout_exercises | 9 | order | integer | NO | 0 |  |  |
| workout_exercises | 10 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| workout_plans | 1 | id | text | NO |  | YES |  |
| workout_plans | 2 | user_id | text | NO |  |  |  |
| workout_plans | 3 | name | text | NO |  |  |  |
| workout_plans | 4 | description | text | YES |  |  |  |
| workout_plans | 5 | goal | text | NO |  |  |  |
| workout_plans | 6 | duration | integer | NO |  |  |  |
| workout_plans | 7 | days_per_week | integer | NO |  |  |  |
| workout_plans | 8 | plan | jsonb | NO |  |  |  |
| workout_plans | 9 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| workout_plans | 10 | updated_at | timestamp without time zone | NO |  |  |  |
| workouts | 1 | id | text | NO |  | YES |  |
| workouts | 2 | user_id | text | NO |  |  |  |
| workouts | 3 | name | text | NO |  |  |  |
| workouts | 4 | description | text | YES |  |  |  |
| workouts | 5 | date | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| workouts | 6 | duration | integer | YES |  |  |  |
| workouts | 7 | notes | text | YES |  |  |  |
| workouts | 8 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| workouts | 9 | updated_at | timestamp without time zone | NO |  |  |  |

### Seed Notes
- Insert parent rows before child rows using FK references above.
- Keep IDs (UUID) explicit when seeding related records.
- For USER-DEFINED columns, only use values listed in Enum Types.
- For timestamps, prefer explicit values for reproducible test data.

## Database: gymcoach_auth

### Tables
- _prisma_migrations
- audit_logs
- email_verifications
- refresh_tokens
- users

### Enum Types (valid values for USER-DEFINED columns)
| Enum Type | Allowed Values |
|---|---|
| Role | CUSTOMER, PT, ADMIN |

### Column Details
| Table | # | Column | Data Type | Nullable | Default | PK | FK Reference |
|---|---:|---|---|---|---|---|---|
| _prisma_migrations | 1 | id | character varying | NO |  | YES |  |
| _prisma_migrations | 2 | checksum | character varying | NO |  |  |  |
| _prisma_migrations | 3 | finished_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 4 | migration_name | character varying | NO |  |  |  |
| _prisma_migrations | 5 | logs | text | YES |  |  |  |
| _prisma_migrations | 6 | rolled_back_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 7 | started_at | timestamp with time zone | NO | now() |  |  |
| _prisma_migrations | 8 | applied_steps_count | integer | NO | 0 |  |  |
| audit_logs | 1 | id | text | NO |  | YES |  |
| audit_logs | 2 | userId | text | NO |  |  | users.id |
| audit_logs | 3 | action | text | NO |  |  |  |
| audit_logs | 4 | ipAddress | text | YES |  |  |  |
| audit_logs | 5 | userAgent | text | YES |  |  |  |
| audit_logs | 6 | metadata | jsonb | YES |  |  |  |
| audit_logs | 7 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| email_verifications | 1 | id | text | NO |  | YES |  |
| email_verifications | 2 | email | text | NO |  |  |  |
| email_verifications | 3 | passwordHash | text | NO |  |  |  |
| email_verifications | 4 | firstName | text | YES |  |  |  |
| email_verifications | 5 | lastName | text | YES |  |  |  |
| email_verifications | 6 | otpHash | text | NO |  |  |  |
| email_verifications | 7 | attempts | integer | NO | 0 |  |  |
| email_verifications | 8 | expiresAt | timestamp without time zone | NO |  |  |  |
| email_verifications | 9 | sentAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| email_verifications | 10 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| email_verifications | 11 | updatedAt | timestamp without time zone | NO |  |  |  |
| refresh_tokens | 1 | id | text | NO |  | YES |  |
| refresh_tokens | 2 | token | text | NO |  |  |  |
| refresh_tokens | 3 | userId | text | NO |  |  | users.id |
| refresh_tokens | 4 | expiresAt | timestamp without time zone | NO |  |  |  |
| refresh_tokens | 5 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| users | 1 | id | text | NO |  | YES |  |
| users | 2 | email | text | NO |  |  |  |
| users | 3 | password | text | NO |  |  |  |
| users | 4 | firstName | text | YES |  |  |  |
| users | 5 | lastName | text | YES |  |  |  |
| users | 6 | role | USER-DEFINED | NO | 'CUSTOMER'::"Role" |  |  |
| users | 7 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| users | 8 | updatedAt | timestamp without time zone | NO |  |  |  |

### Seed Notes
- Insert parent rows before child rows using FK references above.
- Keep IDs (UUID) explicit when seeding related records.
- For USER-DEFINED columns, only use values listed in Enum Types.
- For timestamps, prefer explicit values for reproducible test data.

## Database: gymcoach_user

### Tables
- _prisma_migrations
- inbody_entries
- pt_application_certificates
- pt_application_media
- pt_applications
- user_profiles

### Enum Types (valid values for USER-DEFINED columns)
| Enum Type | Allowed Values |
|---|---|
| ActivityLevel | SEDENTARY, LIGHTLY_ACTIVE, MODERATELY_ACTIVE, VERY_ACTIVE, EXTREMELY_ACTIVE |
| ExperienceLevel | BEGINNER, INTERMEDIATE, ADVANCED |
| Gender | MALE, FEMALE, OTHER |
| Goal | WEIGHT_LOSS, MUSCLE_GAIN, MAINTENANCE, ATHLETIC_PERFORMANCE |
| MediaGroupType | IDENTITY, CERTIFICATE, PORTFOLIO |
| PTApplicationStatus | DRAFT, SUBMITTED, UNDER_REVIEW, NEEDS_MORE_INFO, APPROVED, REJECTED |
| ServiceMode | ONLINE, OFFLINE, HYBRID |

### Column Details
| Table | # | Column | Data Type | Nullable | Default | PK | FK Reference |
|---|---:|---|---|---|---|---|---|
| _prisma_migrations | 1 | id | character varying | NO |  | YES |  |
| _prisma_migrations | 2 | checksum | character varying | NO |  |  |  |
| _prisma_migrations | 3 | finished_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 4 | migration_name | character varying | NO |  |  |  |
| _prisma_migrations | 5 | logs | text | YES |  |  |  |
| _prisma_migrations | 6 | rolled_back_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 7 | started_at | timestamp with time zone | NO | now() |  |  |
| _prisma_migrations | 8 | applied_steps_count | integer | NO | 0 |  |  |
| inbody_entries | 1 | id | text | NO |  | YES |  |
| inbody_entries | 2 | user_id | text | NO |  |  |  |
| inbody_entries | 3 | date | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| inbody_entries | 4 | weight | double precision | NO |  |  |  |
| inbody_entries | 5 | height | double precision | YES |  |  |  |
| inbody_entries | 6 | bmi | double precision | YES |  |  |  |
| inbody_entries | 7 | bmr | double precision | YES |  |  |  |
| inbody_entries | 8 | body_fat | double precision | NO |  |  |  |
| inbody_entries | 9 | body_fat_pct | double precision | YES |  |  |  |
| inbody_entries | 10 | muscle_mass | double precision | NO |  |  |  |
| inbody_entries | 11 | right_arm_muscle | double precision | YES |  |  |  |
| inbody_entries | 12 | left_arm_muscle | double precision | YES |  |  |  |
| inbody_entries | 13 | trunk_muscle | double precision | YES |  |  |  |
| inbody_entries | 14 | right_leg_muscle | double precision | YES |  |  |  |
| inbody_entries | 15 | left_leg_muscle | double precision | YES |  |  |  |
| inbody_entries | 16 | right_arm_fat | double precision | YES |  |  |  |
| inbody_entries | 17 | left_arm_fat | double precision | YES |  |  |  |
| inbody_entries | 18 | trunk_fat | double precision | YES |  |  |  |
| inbody_entries | 19 | right_leg_fat | double precision | YES |  |  |  |
| inbody_entries | 20 | left_leg_fat | double precision | YES |  |  |  |
| inbody_entries | 21 | status | text | NO | 'manual'::text |  |  |
| inbody_entries | 22 | notes | text | YES |  |  |  |
| inbody_entries | 23 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| inbody_entries | 24 | updated_at | timestamp without time zone | NO |  |  |  |
| pt_application_certificates | 1 | id | text | NO |  | YES |  |
| pt_application_certificates | 2 | application_id | text | NO |  |  | pt_applications.id |
| pt_application_certificates | 3 | certificate_name | text | NO |  |  |  |
| pt_application_certificates | 4 | issuing_organization | text | NO |  |  |  |
| pt_application_certificates | 5 | is_currently_valid | boolean | NO |  |  |  |
| pt_application_certificates | 6 | certification_status | text | YES |  |  |  |
| pt_application_certificates | 7 | issue_date | timestamp without time zone | YES |  |  |  |
| pt_application_certificates | 8 | expiration_date | timestamp without time zone | YES |  |  |  |
| pt_application_certificates | 9 | certificate_file_url | text | YES |  |  |  |
| pt_application_certificates | 10 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| pt_application_media | 1 | id | text | NO |  | YES |  |
| pt_application_media | 2 | application_id | text | NO |  |  | pt_applications.id |
| pt_application_media | 3 | group_type | USER-DEFINED | NO |  |  |  |
| pt_application_media | 4 | file_url | text | NO |  |  |  |
| pt_application_media | 5 | label | text | YES |  |  |  |
| pt_application_media | 6 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| pt_applications | 1 | id | text | NO |  | YES |  |
| pt_applications | 2 | user_profile_id | text | NO |  |  | user_profiles.id |
| pt_applications | 3 | status | USER-DEFINED | NO | 'DRAFT'::"PTApplicationStatus" |  |  |
| pt_applications | 4 | phone_number | text | YES |  |  |  |
| pt_applications | 5 | national_id_number | text | YES |  |  |  |
| pt_applications | 6 | current_address | text | YES |  |  |  |
| pt_applications | 7 | id_card_front_url | text | YES |  |  |  |
| pt_applications | 8 | id_card_back_url | text | YES |  |  |  |
| pt_applications | 9 | portrait_photo_url | text | YES |  |  |  |
| pt_applications | 10 | years_of_experience | text | YES |  |  |  |
| pt_applications | 11 | education_background | text | YES |  |  |  |
| pt_applications | 12 | previous_work_experience | text | YES |  |  |  |
| pt_applications | 13 | professional_bio | text | YES |  |  |  |
| pt_applications | 14 | main_specialties | ARRAY | YES |  |  |  |
| pt_applications | 15 | target_client_groups | ARRAY | YES |  |  |  |
| pt_applications | 16 | primary_training_goals | ARRAY | YES |  |  |  |
| pt_applications | 17 | training_methods_approach | text | YES |  |  |  |
| pt_applications | 18 | portfolio_url | text | YES |  |  |  |
| pt_applications | 19 | linkedin_url | text | YES |  |  |  |
| pt_applications | 20 | website_url | text | YES |  |  |  |
| pt_applications | 21 | social_links | jsonb | YES |  |  |  |
| pt_applications | 22 | availability_notes | text | YES |  |  |  |
| pt_applications | 23 | available_time_slots | jsonb | YES |  |  |  |
| pt_applications | 24 | service_mode | USER-DEFINED | YES |  |  |  |
| pt_applications | 25 | operating_areas | ARRAY | YES |  |  |  |
| pt_applications | 26 | desired_session_price | double precision | YES |  |  |  |
| pt_applications | 27 | available_days | ARRAY | YES |  |  |  |
| pt_applications | 28 | available_from | text | YES |  |  |  |
| pt_applications | 29 | available_until | text | YES |  |  |  |
| pt_applications | 30 | gym_affiliation | text | YES |  |  |  |
| pt_applications | 31 | package_price | double precision | YES |  |  |  |
| pt_applications | 32 | monthly_program_price | double precision | YES |  |  |  |
| pt_applications | 33 | additional_pricing_notes | text | YES |  |  |  |
| pt_applications | 34 | other_references | text | YES |  |  |  |
| pt_applications | 35 | admin_note | text | YES |  |  |  |
| pt_applications | 36 | rejection_reason | text | YES |  |  |  |
| pt_applications | 37 | submitted_at | timestamp without time zone | YES |  |  |  |
| pt_applications | 38 | reviewed_at | timestamp without time zone | YES |  |  |  |
| pt_applications | 39 | approved_at | timestamp without time zone | YES |  |  |  |
| pt_applications | 40 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| pt_applications | 41 | updated_at | timestamp without time zone | NO |  |  |  |
| user_profiles | 1 | id | text | NO |  | YES |  |
| user_profiles | 2 | userId | text | NO |  |  |  |
| user_profiles | 3 | age | integer | YES |  |  |  |
| user_profiles | 4 | gender | USER-DEFINED | YES |  |  |  |
| user_profiles | 5 | heightCm | double precision | YES |  |  |  |
| user_profiles | 6 | goal | USER-DEFINED | YES |  |  |  |
| user_profiles | 7 | activityLevel | USER-DEFINED | YES |  |  |  |
| user_profiles | 8 | experienceLevel | USER-DEFINED | YES |  |  |  |
| user_profiles | 9 | preferredTrainingDays | ARRAY | YES |  |  |  |
| user_profiles | 10 | availableEquipment | ARRAY | YES |  |  |  |
| user_profiles | 11 | injuries | ARRAY | YES |  |  |  |
| user_profiles | 12 | currentWeight | double precision | YES |  |  |  |
| user_profiles | 13 | targetWeight | double precision | YES |  |  |  |
| user_profiles | 14 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| user_profiles | 15 | updatedAt | timestamp without time zone | NO |  |  |  |
| user_profiles | 16 | isPT | boolean | NO | false |  |  |
| user_profiles | 17 | email | text | YES |  |  |  |
| user_profiles | 18 | firstName | text | YES |  |  |  |
| user_profiles | 19 | lastName | text | YES |  |  |  |

### Seed Notes
- Insert parent rows before child rows using FK references above.
- Keep IDs (UUID) explicit when seeding related records.
- For USER-DEFINED columns, only use values listed in Enum Types.
- For timestamps, prefer explicit values for reproducible test data.

## Database: gymcoach_fitness

### Tables
- _prisma_migrations
- exercises
- nutrition_logs
- workout_exercises
- workouts

### Enum Types (valid values for USER-DEFINED columns)
| Enum Type | Allowed Values |
|---|---|
| BodyPart | UPPER_BODY, LOWER_BODY, CORE, FULL_BODY |
| EquipmentType | BODYWEIGHT, BARBELL, DUMBBELLS, KETTLEBELL, MACHINE, RESISTANCE_BAND, CABLE, MEDICINE_BALL, FOAM_ROLLER |
| ExerciseType | STRENGTH, CARDIO, MOBILITY, STRENGTH_CARDIO, STRENGTH_MOBILITY |
| MovementType | PUSH, PULL, HOLD, STRETCH |

### Column Details
| Table | # | Column | Data Type | Nullable | Default | PK | FK Reference |
|---|---:|---|---|---|---|---|---|
| _prisma_migrations | 1 | id | character varying | NO |  | YES |  |
| _prisma_migrations | 2 | checksum | character varying | NO |  |  |  |
| _prisma_migrations | 3 | finished_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 4 | migration_name | character varying | NO |  |  |  |
| _prisma_migrations | 5 | logs | text | YES |  |  |  |
| _prisma_migrations | 6 | rolled_back_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 7 | started_at | timestamp with time zone | NO | now() |  |  |
| _prisma_migrations | 8 | applied_steps_count | integer | NO | 0 |  |  |
| exercises | 1 | id | text | NO |  | YES |  |
| exercises | 2 | exercise_name | text | NO |  |  |  |
| exercises | 3 | type_of_activity | USER-DEFINED | NO |  |  |  |
| exercises | 4 | type_of_equipment | USER-DEFINED | NO |  |  |  |
| exercises | 5 | body_part | USER-DEFINED | NO |  |  |  |
| exercises | 6 | type | USER-DEFINED | NO |  |  |  |
| exercises | 7 | muscle_groups_activated | ARRAY | YES |  |  |  |
| exercises | 8 | instructions | text | NO |  |  |  |
| exercises | 9 | video_url | text | YES |  |  |  |
| exercises | 10 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| exercises | 11 | updated_at | timestamp without time zone | NO |  |  |  |
| nutrition_logs | 1 | id | text | NO |  | YES |  |
| nutrition_logs | 2 | user_id | text | NO |  |  |  |
| nutrition_logs | 3 | date | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| nutrition_logs | 4 | meal_type | text | NO |  |  |  |
| nutrition_logs | 5 | food_name | text | NO |  |  |  |
| nutrition_logs | 6 | calories | integer | NO |  |  |  |
| nutrition_logs | 7 | protein | double precision | YES |  |  |  |
| nutrition_logs | 8 | carbs | double precision | YES |  |  |  |
| nutrition_logs | 9 | fats | double precision | YES |  |  |  |
| nutrition_logs | 10 | notes | text | YES |  |  |  |
| nutrition_logs | 11 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| nutrition_logs | 12 | updated_at | timestamp without time zone | NO |  |  |  |
| workout_exercises | 1 | id | text | NO |  | YES |  |
| workout_exercises | 2 | workout_id | text | NO |  |  | workouts.id |
| workout_exercises | 3 | exercise_id | text | NO |  |  | exercises.id |
| workout_exercises | 4 | sets | integer | NO |  |  |  |
| workout_exercises | 5 | reps | integer | YES |  |  |  |
| workout_exercises | 6 | duration | integer | YES |  |  |  |
| workout_exercises | 7 | weight | double precision | YES |  |  |  |
| workout_exercises | 8 | notes | text | YES |  |  |  |
| workout_exercises | 9 | order | integer | NO | 0 |  |  |
| workout_exercises | 10 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| workouts | 1 | id | text | NO |  | YES |  |
| workouts | 2 | user_id | text | NO |  |  |  |
| workouts | 3 | name | text | NO |  |  |  |
| workouts | 4 | description | text | YES |  |  |  |
| workouts | 5 | date | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| workouts | 6 | duration | integer | YES |  |  |  |
| workouts | 7 | notes | text | YES |  |  |  |
| workouts | 8 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| workouts | 9 | updated_at | timestamp without time zone | NO |  |  |  |

### Seed Notes
- Insert parent rows before child rows using FK references above.
- Keep IDs (UUID) explicit when seeding related records.
- For USER-DEFINED columns, only use values listed in Enum Types.
- For timestamps, prefer explicit values for reproducible test data.

## Database: gymcoach_ai

### Tables
- _prisma_migrations
- chat_messages
- chat_session_summaries
- chat_sessions
- conversations
- user_memory_items
- workout_plans

### Enum Types (valid values for USER-DEFINED columns)
| Enum Type | Allowed Values |
|---|---|
| ChatRole | user, assistant, system |

### Column Details
| Table | # | Column | Data Type | Nullable | Default | PK | FK Reference |
|---|---:|---|---|---|---|---|---|
| _prisma_migrations | 1 | id | character varying | NO |  | YES |  |
| _prisma_migrations | 2 | checksum | character varying | NO |  |  |  |
| _prisma_migrations | 3 | finished_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 4 | migration_name | character varying | NO |  |  |  |
| _prisma_migrations | 5 | logs | text | YES |  |  |  |
| _prisma_migrations | 6 | rolled_back_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 7 | started_at | timestamp with time zone | NO | now() |  |  |
| _prisma_migrations | 8 | applied_steps_count | integer | NO | 0 |  |  |
| chat_messages | 1 | id | text | NO |  | YES |  |
| chat_messages | 2 | session_id | text | NO |  |  | chat_sessions.id |
| chat_messages | 3 | user_id | text | NO |  |  |  |
| chat_messages | 4 | role | USER-DEFINED | NO |  |  |  |
| chat_messages | 5 | content | text | NO |  |  |  |
| chat_messages | 6 | message_index | integer | NO |  |  |  |
| chat_messages | 7 | embedding | ARRAY | NO | ARRAY[]::double precision[] |  |  |
| chat_messages | 8 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| chat_messages | 9 | updated_at | timestamp without time zone | NO |  |  |  |
| chat_session_summaries | 1 | id | text | NO |  | YES |  |
| chat_session_summaries | 2 | session_id | text | NO |  |  | chat_sessions.id |
| chat_session_summaries | 3 | user_id | text | NO |  |  |  |
| chat_session_summaries | 4 | summary_text | text | NO |  |  |  |
| chat_session_summaries | 5 | source_from_index | integer | NO | 0 |  |  |
| chat_session_summaries | 6 | source_to_index | integer | NO | 0 |  |  |
| chat_session_summaries | 7 | summary_version | integer | NO | 1 |  |  |
| chat_session_summaries | 8 | embedding | ARRAY | NO | ARRAY[]::double precision[] |  |  |
| chat_session_summaries | 9 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| chat_session_summaries | 10 | updated_at | timestamp without time zone | NO |  |  |  |
| chat_sessions | 1 | id | text | NO |  | YES |  |
| chat_sessions | 2 | user_id | text | NO |  |  |  |
| chat_sessions | 3 | title | text | NO |  |  |  |
| chat_sessions | 4 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| chat_sessions | 5 | updated_at | timestamp without time zone | NO |  |  |  |
| chat_sessions | 6 | last_message_at | timestamp without time zone | YES |  |  |  |
| conversations | 1 | id | text | NO |  | YES |  |
| conversations | 2 | user_id | text | YES |  |  |  |
| conversations | 3 | question | text | NO |  |  |  |
| conversations | 4 | answer | text | NO |  |  |  |
| conversations | 5 | model_used | text | NO |  |  |  |
| conversations | 6 | response_time | double precision | NO |  |  |  |
| conversations | 7 | relevance | text | YES |  |  |  |
| conversations | 8 | relevance_explanation | text | YES |  |  |  |
| conversations | 9 | prompt_tokens | integer | NO |  |  |  |
| conversations | 10 | completion_tokens | integer | NO |  |  |  |
| conversations | 11 | total_tokens | integer | NO |  |  |  |
| conversations | 12 | cost | double precision | NO | 0 |  |  |
| conversations | 13 | feedback | integer | YES |  |  |  |
| conversations | 14 | feedback_timestamp | timestamp without time zone | YES |  |  |  |
| conversations | 15 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| user_memory_items | 1 | id | text | NO |  | YES |  |
| user_memory_items | 2 | user_id | text | NO |  |  |  |
| user_memory_items | 3 | memory_key | text | NO |  |  |  |
| user_memory_items | 4 | memory_value | text | NO |  |  |  |
| user_memory_items | 5 | source_session_id | text | YES |  |  |  |
| user_memory_items | 6 | confidence | double precision | NO | 0.5 |  |  |
| user_memory_items | 7 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| user_memory_items | 8 | updated_at | timestamp without time zone | NO |  |  |  |
| workout_plans | 1 | id | text | NO |  | YES |  |
| workout_plans | 2 | user_id | text | NO |  |  |  |
| workout_plans | 3 | name | text | NO |  |  |  |
| workout_plans | 4 | description | text | YES |  |  |  |
| workout_plans | 5 | goal | text | NO |  |  |  |
| workout_plans | 6 | duration | integer | NO |  |  |  |
| workout_plans | 7 | days_per_week | integer | NO |  |  |  |
| workout_plans | 8 | plan | jsonb | NO |  |  |  |
| workout_plans | 9 | created_at | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| workout_plans | 10 | updated_at | timestamp without time zone | NO |  |  |  |

### Seed Notes
- Insert parent rows before child rows using FK references above.
- Keep IDs (UUID) explicit when seeding related records.
- For USER-DEFINED columns, only use values listed in Enum Types.
- For timestamps, prefer explicit values for reproducible test data.

## Database: gymcoach_chat

### Tables
- _prisma_migrations
- conversation_participants
- conversations
- messages

### Enum Types (valid values for USER-DEFINED columns)
| Enum Type | Allowed Values |
|---|---|
| ConversationType | DIRECT |

### Column Details
| Table | # | Column | Data Type | Nullable | Default | PK | FK Reference |
|---|---:|---|---|---|---|---|---|
| _prisma_migrations | 1 | id | character varying | NO |  | YES |  |
| _prisma_migrations | 2 | checksum | character varying | NO |  |  |  |
| _prisma_migrations | 3 | finished_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 4 | migration_name | character varying | NO |  |  |  |
| _prisma_migrations | 5 | logs | text | YES |  |  |  |
| _prisma_migrations | 6 | rolled_back_at | timestamp with time zone | YES |  |  |  |
| _prisma_migrations | 7 | started_at | timestamp with time zone | NO | now() |  |  |
| _prisma_migrations | 8 | applied_steps_count | integer | NO | 0 |  |  |
| conversation_participants | 1 | id | text | NO |  | YES |  |
| conversation_participants | 2 | conversationId | text | NO |  |  | conversations.id |
| conversation_participants | 3 | userId | text | NO |  |  |  |
| conversation_participants | 4 | joinedAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| conversations | 1 | id | text | NO |  | YES |  |
| conversations | 2 | type | USER-DEFINED | NO | 'DIRECT'::"ConversationType" |  |  |
| conversations | 3 | lastMessageAt | timestamp without time zone | YES |  |  |  |
| conversations | 4 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |
| conversations | 5 | updatedAt | timestamp without time zone | NO |  |  |  |
| messages | 1 | id | text | NO |  | YES |  |
| messages | 2 | conversationId | text | NO |  |  | conversations.id |
| messages | 3 | senderId | text | NO |  |  |  |
| messages | 4 | content | text | NO |  |  |  |
| messages | 5 | readAt | timestamp without time zone | YES |  |  |  |
| messages | 6 | createdAt | timestamp without time zone | NO | CURRENT_TIMESTAMP |  |  |

### Seed Notes
- Insert parent rows before child rows using FK references above.
- Keep IDs (UUID) explicit when seeding related records.
- For USER-DEFINED columns, only use values listed in Enum Types.
- For timestamps, prefer explicit values for reproducible test data.

## Suggested Global Seed Flow
1. gymcoach_auth.users -> refresh_tokens/audit_logs/email_verifications
2. gymcoach_user.user_profiles -> pt_applications -> pt_application_* -> inbody_entries
3. gymcoach_fitness.exercises -> workouts -> workout_exercises -> nutrition_logs
4. gymcoach_ai.conversations/workout_plans and memory/session tables
5. gymcoach_chat.conversations -> conversation_participants -> messages
