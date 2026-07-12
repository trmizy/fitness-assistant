erDiagram

%% ═══════════════════════════════════════════════════════════
%% DATABASE: gymcoach_auth  (auth-service)
%% ═══════════════════════════════════════════════════════════

    users {
        uuid   id           PK
        string email        UK
        string password
        string firstName
        string lastName
        enum   role              "CUSTOMER | PT | ADMIN"
        bool   isActive
        ts     createdAt
        ts     updatedAt
    }

    refresh_tokens {
        uuid   id           PK
        string token        UK
        uuid   userId       FK
        ts     expiresAt
        ts     createdAt
    }

    email_verifications {
        uuid   id           PK
        string email        UK
        string passwordHash
        string otpHash
        int    attempts
        ts     expiresAt
        ts     createdAt
    }

    audit_logs {
        uuid   id         PK
        uuid   userId     FK
        string action
        string ipAddress
        string userAgent
        json   metadata
        ts     createdAt
    }

%% ═══════════════════════════════════════════════════════════
%% DATABASE: gymcoach_user  (user-service)
%% ═══════════════════════════════════════════════════════════

    user_profiles {
        uuid   id          PK
        uuid   userId      UK  "→ users.id (auth-service)"
        string firstName
        string lastName
        string email
        bool   isPT
        int    age
        enum   gender          "MALE | FEMALE | OTHER"
        float  heightCm
        enum   goal            "WEIGHT_LOSS | MUSCLE_GAIN | MAINTENANCE | ATHLETIC_PERFORMANCE"
        enum   activityLevel   "SEDENTARY | LIGHTLY_ACTIVE | MODERATELY_ACTIVE | VERY_ACTIVE | EXTREMELY_ACTIVE"
        enum   experienceLevel "BEGINNER | INTERMEDIATE | ADVANCED"
        float  currentWeight
        float  targetWeight
        string photoUrl
        ts     createdAt
        ts     updatedAt
    }

    pt_applications {
        uuid   id                  PK
        uuid   userProfileId       FK  UK
        enum   status              "DRAFT | SUBMITTED | UNDER_REVIEW | NEEDS_MORE_INFO | APPROVED | REJECTED"
        string phoneNumber
        string nationalIdNumber
        string professionalBio
        arr    mainSpecialties
        float  desiredSessionPrice
        float  onlinePricePerSession
        float  offlinePricePerSession
        float  packagePrice
        int    sessionsPerPackage
        enum   serviceMode         "ONLINE | OFFLINE | HYBRID"
        string adminNote
        string rejectionReason
        ts     submittedAt
        ts     approvedAt
        ts     createdAt
        ts     updatedAt
    }

    pt_application_certificates {
        uuid   id                  PK
        uuid   applicationId       FK
        string certificateName
        string issuingOrganization
        bool   isCurrentlyValid
        string certificationStatus
        ts     issueDate
        ts     expirationDate
        string certificateFileUrl
        ts     createdAt
    }

    pt_application_media {
        uuid   id            PK
        uuid   applicationId FK
        enum   groupType     "IDENTITY | CERTIFICATE | PORTFOLIO"
        string fileUrl
        string label
        ts     createdAt
    }

    inbody_entries {
        uuid   id          PK
        uuid   userId      FK  "→ users.id (auth-service)"
        ts     date
        date   dateOnly    UK  "unique(userId, dateOnly)"
        float  weight
        float  height
        float  bmi
        float  bmr              "migration only – not in Prisma schema"
        float  bodyFat
        float  bodyFatPct
        float  muscleMass
        float  rightArmMuscle
        float  leftArmMuscle
        float  trunkMuscle
        float  rightLegMuscle
        float  leftLegMuscle
        float  rightArmFat
        float  leftArmFat
        float  trunkFat
        float  rightLegFat
        float  leftLegFat
        string status      "manual | extracted | pending"
        ts     createdAt
        ts     updatedAt
    }

    contracts {
        uuid   id               PK
        uuid   ptUserId         FK  "→ users.id"
        uuid   clientUserId     FK  "→ users.id"
        enum   status           "PENDING_REVIEW | PENDING_SIGNATURE | ACTIVE | COMPLETED | EXPIRED | CANCELLED | REJECTED"
        enum   packageType      "PER_SESSION | PACKAGE"
        string packageName
        enum   sessionMode      "ONLINE | OFFLINE | HYBRID"
        int    totalSessions
        int    usedSessions
        float  price
        float  pricePerSession
        ts     startDate
        ts     endDate
        string eSignProvider
        string eSignRequestId
        string eSignStatus
        ts     clientSignedAt
        ts     ptSignedAt
        ts     fullySignedAt
        string contractPdfPath
        string rejectionReason
        ts     createdAt
        ts     updatedAt
    }

    sessions {
        uuid   id                 PK
        uuid   contractId         FK
        uuid   clientUserId       FK  "→ users.id"
        uuid   ptUserId           FK  "→ users.id"
        enum   status             "REQUESTED | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW"
        enum   sessionMode        "ONLINE | OFFLINE | HYBRID"
        ts     scheduledStartAt
        ts     scheduledEndAt
        string location
        string notes
        string ptNotes
        bool   sessionDeducted
        ts     completedAt
        ts     createdAt
        ts     updatedAt
    }

    session_reviews {
        uuid   id           PK
        uuid   sessionId    FK  UK
        uuid   contractId   FK
        uuid   clientUserId FK  "→ users.id"
        int    rating       "1–5"
        string comment
        ts     createdAt
    }

    notifications {
        uuid   id         PK
        uuid   userId     FK  "→ users.id"
        string text
        enum   eventType  "CONTRACT_REQUESTED | SESSION_BOOKED | SESSION_CONFIRMED | ..."
        enum   entityType "CONTRACT | SESSION"
        uuid   entityId
        string link
        bool   unread
        ts     createdAt
        ts     updatedAt
    }

    pt_availability {
        uuid   id        PK
        uuid   ptUserId  FK  "→ users.id"
        enum   dayOfWeek "MONDAY | ... | SUNDAY"
        string startTime
        string endTime
        bool   isActive
        ts     createdAt
        ts     updatedAt
    }

    pt_schedule_exceptions {
        uuid   id        PK
        uuid   ptUserId  FK  "→ users.id"
        ts     date
        string reason
        ts     createdAt
    }

    vietnam_provinces {
        int    code           PK
        string name
        string nameNormalized
        string codename
        string divisionType
        ts     createdAt
        ts     updatedAt
    }

    vietnam_wards {
        int    code           PK
        int    provinceCode   FK
        string name
        string nameNormalized
        string codename
        string divisionType
        ts     createdAt
        ts     updatedAt
    }

    pt_training_locations {
        uuid   id                 PK
        uuid   ptUserId           FK  "→ user_profiles.userId"
        int    provinceCode       FK
        int    wardCode           FK  "nullable"
        string gymName
        string addressLine
        bool   isPrimary
        bool   isActive
        string note
        ts     createdAt
        ts     updatedAt
    }

%% ═══════════════════════════════════════════════════════════
%% DATABASE: gymcoach_fitness  (fitness-service)
%% ═══════════════════════════════════════════════════════════

    exercises {
        uuid   id                    PK
        string exerciseName
        enum   typeOfActivity        "STRENGTH | CARDIO | MOBILITY | STRENGTH_CARDIO | STRENGTH_MOBILITY"
        enum   typeOfEquipment       "BODYWEIGHT | BARBELL | DUMBBELLS | KETTLEBELL | MACHINE | ..."
        enum   bodyPart              "UPPER_BODY | LOWER_BODY | CORE | FULL_BODY"
        enum   type                  "PUSH | PULL | HOLD | STRETCH"
        arr    muscleGroupsActivated
        string instructions
        string videoUrl
        ts     createdAt
        ts     updatedAt
    }

    workouts {
        uuid   id          PK
        uuid   userId      FK  "→ users.id"
        string name
        ts     date
        int    duration    "minutes"
        string notes
        ts     createdAt
        ts     updatedAt
    }

    workout_exercises {
        uuid   id         PK
        uuid   workoutId  FK
        uuid   exerciseId FK
        int    sets
        int    reps
        int    duration   "seconds"
        float  weight     "kg"
        int    order
        ts     createdAt
    }

    workout_sets {
        uuid   id                  PK
        uuid   workoutExerciseId   FK
        int    setNumber
        int    reps
        float  weight              "kg"
        float  rpe                 "1-10"
        bool   completed
        ts     createdAt
    }

    foods {
        uuid   id       PK
        int    fdcId    UK
        string name
        float  calories
        float  protein
        float  carbs
        float  fats
        string source
        string imageUrl
    }

    food_aliases {
        uuid   id              PK
        uuid   foodId          FK
        string alias
        string aliasNormalized
        string language
        string source
        ts     createdAt
        ts     updatedAt
    }

    nutrition_logs {
        uuid   id       PK
        uuid   userId   FK  "→ users.id"
        ts     date
        string mealType "breakfast | lunch | dinner | snack"
        string foodName
        int    calories
        float  protein
        float  carbs
        float  fats
        string notes
        ts     createdAt
        ts     updatedAt
    }

    nutrition_goals {
        uuid   id       PK
        uuid   userId   UK  "→ users.id"
        int    calories
        float  protein
        float  carbs
        float  fat
        int    waterMl
        ts     createdAt
        ts     updatedAt
    }

    body_metrics {
        uuid   id         PK
        uuid   userId     FK  "→ users.id"
        ts     date
        float  weight
        float  bodyFat
        float  muscleMass
        float  bodyWater
        string notes
        ts     createdAt
        ts     updatedAt
    }

    workout_programs {
        uuid   id           PK
        uuid   userId       FK  "→ users.id"
        string name
        string goal
        int    durationWeeks
        int    daysPerWeek
        string status       "ACTIVE | ARCHIVED"
        int    version
        string sourcePlanId FK  "→ workout_plans.id (ai-service)"
        ts     createdAt
        ts     updatedAt
    }

    workout_program_days {
        uuid   id          PK
        uuid   programId   FK
        int    dayNumber
        string title
        int    duration    "minutes"
        ts     createdAt
        ts     updatedAt
    }

    workout_program_exercises {
        uuid   id           PK
        uuid   programDayId FK
        uuid   exerciseId   FK
        int    order
        int    sets
        int    reps
        float  weight
        int    restSeconds
        ts     createdAt
    }

    workout_schedules {
        uuid   id           PK
        uuid   userId       FK  "→ users.id"
        ts     date
        uuid   programDayId FK  "nullable"
        uuid   workoutId    FK  "nullable"
        string sourcePlanId
        string notes
        ts     createdAt
        ts     updatedAt
    }

    nutrition_programs {
        uuid   id                  PK
        uuid   userId              FK  "→ users.id"
        string name
        string goal
        int    durationWeeks
        int    mealsPerDay
        int    dailyCaloriesTarget
        float  proteinTargetGrams
        float  carbTargetGrams
        float  fatTargetGrams
        string status              "ACTIVE | ARCHIVED"
        string sourcePlanId        FK  "→ nutrition_plans.id (ai-service)"
        ts     startDate
        ts     endDate
        ts     createdAt
        ts     updatedAt
    }

    nutrition_program_days {
        uuid   id            PK
        uuid   programId     FK
        int    dayNumber
        string title
        int    totalCalories
        float  proteinGrams
        float  carbGrams
        float  fatGrams
        ts     createdAt
        ts     updatedAt
    }

    nutrition_program_meals {
        uuid   id           PK
        uuid   dayId        FK
        string mealType     "BREAKFAST | LUNCH | DINNER | SNACK"
        string title
        int    calories
        float  proteinGrams
        float  carbGrams
        float  fatGrams
        ts     createdAt
        ts     updatedAt
    }

    nutrition_program_meal_items {
        uuid   id             PK
        uuid   mealId         FK
        uuid   foodId         FK  "nullable"
        string customFoodName
        float  quantity
        string unit
        int    calories
        float  proteinGrams
        float  carbGrams
        float  fatGrams
        ts     createdAt
        ts     updatedAt
    }

    nutrition_meal_completions {
        uuid   id               PK
        uuid   userId           FK  "→ users.id"
        uuid   mealId           FK
        date   logDate
        string status           "PENDING | COMPLETED | PARTIAL | SKIPPED"
        int    percentConsumed
        int    consumedCalories
        float  consumedProtein
        float  consumedCarbs
        float  consumedFat
        ts     completedAt
        ts     createdAt
        ts     updatedAt
    }

%% ═══════════════════════════════════════════════════════════
%% DATABASE: gymcoach_ai  (ai-service)
%% ═══════════════════════════════════════════════════════════

    conversations_ai {
        uuid   id                        PK
        uuid   userId                    FK  "→ users.id (auth-service)"
        string question
        string answer
        string modelUsed
        float  responseTime
        int    promptTokens
        int    completionTokens
        int    totalTokens
        float  cost
        int    feedback
        string routeIntent
        bool   usedFallback
        bool   usedDeterministicFallback
        string responseLanguage
        ts     createdAt
    }

    workout_plans {
        uuid   id             PK
        uuid   userId         FK  "→ users.id"
        string name
        string goal
        int    duration       "weeks"
        int    daysPerWeek
        json   plan
        enum   status         "QUEUED | PROCESSING | COMPLETED | FAILED"
        int    version
        string jobId
        string failReason
        uuid   ptUserId       FK  "→ users.id (nullable)"
        string ptName
        enum   ptReviewStatus "PENDING_PT_REVIEW | PT_APPROVED | PT_REJECTED"
        string ptNote
        ts     ptReviewedAt
        ts     archivedAt
        ts     createdAt
        ts     updatedAt
    }

    nutrition_plans {
        uuid   id           PK    "no migration – created via db push"
        uuid   userId       FK  "→ users.id"
        string name
        string goal
        int    durationWeeks
        int    mealsPerDay
        json   plan
        enum   status       "QUEUED | PROCESSING | COMPLETED | FAILED"
        string jobId
        string failReason
        ts     archivedAt
        ts     createdAt
        ts     updatedAt
    }

%% ═══════════════════════════════════════════════════════════
%% DATABASE: gymcoach_chat  (chat-service)
%% ═══════════════════════════════════════════════════════════

    conversations_chat {
        uuid   id            PK
        enum   type          "DIRECT"
        ts     lastMessageAt
        ts     createdAt
        ts     updatedAt
    }

    conversation_participants {
        uuid   id             PK
        uuid   conversationId FK
        uuid   userId         FK  "→ users.id (auth-service)"
        ts     joinedAt
    }

    messages {
        uuid   id             PK
        uuid   conversationId FK
        uuid   senderId       FK  "→ users.id"
        string content
        ts     readAt
        ts     createdAt
    }

    call_sessions {
        uuid   id                 PK
        uuid   conversationId     FK  "nullable"
        uuid   callerId           FK  "→ users.id"
        uuid   calleeId           FK  "→ users.id"
        enum   callType           "VOICE | VIDEO"
        enum   status             "INITIATING | RINGING | ACCEPTED | ACTIVE | ENDED | MISSED | FAILED"
        enum   origin             "CHAT | SESSION"
        uuid   coachingSessionId  FK  "→ sessions.id (user-service)"
        ts     startedAt
        ts     endedAt
        ts     answeredAt
        ts     createdAt
        ts     updatedAt
    }

%% ═══════════════════════════════════════════════════════════
%% RELATIONSHIPS
%% ═══════════════════════════════════════════════════════════

    %% auth-service internal
    users                    ||--o{ refresh_tokens               : "has"
    users                    ||--o{ audit_logs                   : "generates"

    %% user-service internal
    user_profiles            ||--o| pt_applications              : "submits"
    pt_applications          ||--o{ pt_application_certificates  : "attaches"
    pt_applications          ||--o{ pt_application_media         : "uploads"
    user_profiles            ||--o{ pt_training_locations        : "sets"
    vietnam_provinces        ||--o{ vietnam_wards                : "contains"
    vietnam_provinces        ||--o{ pt_training_locations        : "in"
    vietnam_wards            ||--o{ pt_training_locations        : "in"
    contracts                ||--o{ sessions                     : "books"
    contracts                ||--o{ session_reviews              : "has"
    sessions                 ||--o| session_reviews              : "reviewed by"

    %% fitness-service internal
    exercises                ||--o{ workout_exercises            : "performed in"
    exercises                ||--o{ workout_program_exercises    : "prescribed in"
    workouts                 ||--o{ workout_exercises            : "contains"
    workouts                 ||--o{ workout_schedules            : "scheduled as"
    workout_exercises        ||--o{ workout_sets                 : "has"
    foods                    ||--o{ food_aliases                 : "known as"
    foods                    ||--o{ nutrition_program_meal_items : "included in"
    workout_programs         ||--o{ workout_program_days         : "structured in"
    workout_program_days     ||--o{ workout_program_exercises    : "prescribes"
    workout_program_days     ||--o{ workout_schedules            : "scheduled on"
    nutrition_programs       ||--o{ nutrition_program_days       : "structured in"
    nutrition_program_days   ||--o{ nutrition_program_meals      : "has"
    nutrition_program_meals  ||--o{ nutrition_program_meal_items : "contains"
    nutrition_program_meals  ||--o{ nutrition_meal_completions   : "tracked by"

    %% chat-service internal
    conversations_chat       ||--o{ conversation_participants    : "has"
    conversations_chat       ||--o{ messages                     : "contains"
    conversations_chat       ||--o{ call_sessions                : "starts"

    %% cross-service logical references (userId keys)
    users                    ||--o| user_profiles                : "has profile"
    users                    ||--o{ inbody_entries               : "records"
    users                    ||--o{ contracts                    : "pt signs"
    users                    ||--o{ sessions                     : "attends"
    users                    ||--o{ workout_plans                : "generates"
    users                    ||--o{ nutrition_plans              : "generates"
    users                    ||--o{ workout_programs             : "follows"
    users                    ||--o{ nutrition_programs           : "follows"
    users                    ||--o{ workouts                     : "logs"
    users                    ||--o{ nutrition_logs               : "logs"
    workout_plans            ||--o{ workout_programs             : "imported to"
    nutrition_plans          ||--o{ nutrition_programs           : "imported to"
