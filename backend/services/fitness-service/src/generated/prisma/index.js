
Object.defineProperty(exports, "__esModule", { value: true });

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
  NotFoundError,
  getPrismaClient,
  sqltag,
  empty,
  join,
  raw,
  skip,
  Decimal,
  Debug,
  objectEnumValues,
  makeStrictEnum,
  Extensions,
  warnOnce,
  defineDmmfProperty,
  Public,
  getRuntime
} = require('./runtime/library.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError;
Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError
Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError
Prisma.PrismaClientInitializationError = PrismaClientInitializationError
Prisma.PrismaClientValidationError = PrismaClientValidationError
Prisma.NotFoundError = NotFoundError
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = sqltag
Prisma.empty = empty
Prisma.join = join
Prisma.raw = raw
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = Extensions.getExtensionContext
Prisma.defineExtension = Extensions.defineExtension

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}




  const path = require('path')

/**
 * Enums
 */
exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.ExerciseScalarFieldEnum = {
  id: 'id',
  exerciseName: 'exerciseName',
  typeOfActivity: 'typeOfActivity',
  typeOfEquipment: 'typeOfEquipment',
  bodyPart: 'bodyPart',
  type: 'type',
  muscleGroupsActivated: 'muscleGroupsActivated',
  instructions: 'instructions',
  videoUrl: 'videoUrl',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  description: 'description',
  date: 'date',
  duration: 'duration',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutExerciseScalarFieldEnum = {
  id: 'id',
  workoutId: 'workoutId',
  exerciseId: 'exerciseId',
  sets: 'sets',
  reps: 'reps',
  duration: 'duration',
  weight: 'weight',
  notes: 'notes',
  order: 'order',
  createdAt: 'createdAt'
};

exports.Prisma.WorkoutSetScalarFieldEnum = {
  id: 'id',
  workoutExerciseId: 'workoutExerciseId',
  setNumber: 'setNumber',
  reps: 'reps',
  weight: 'weight',
  rpe: 'rpe',
  completed: 'completed',
  createdAt: 'createdAt'
};

exports.Prisma.FoodScalarFieldEnum = {
  id: 'id',
  fdcId: 'fdcId',
  name: 'name',
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fats: 'fats',
  source: 'source',
  imageUrl: 'imageUrl'
};

exports.Prisma.FoodAliasScalarFieldEnum = {
  id: 'id',
  foodId: 'foodId',
  alias: 'alias',
  aliasNormalized: 'aliasNormalized',
  language: 'language',
  source: 'source',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionLogScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  mealType: 'mealType',
  foodName: 'foodName',
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fats: 'fats',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionGoalScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fat: 'fat',
  waterMl: 'waterMl',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BodyMetricsScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  weight: 'weight',
  bodyFat: 'bodyFat',
  muscleMass: 'muscleMass',
  bodyWater: 'bodyWater',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutProgramScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  description: 'description',
  sourcePlanId: 'sourcePlanId',
  sourceType: 'sourceType',
  aiPlanVersion: 'aiPlanVersion',
  goal: 'goal',
  durationWeeks: 'durationWeeks',
  daysPerWeek: 'daysPerWeek',
  status: 'status',
  archivedAt: 'archivedAt',
  version: 'version',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutProgramDayScalarFieldEnum = {
  id: 'id',
  programId: 'programId',
  dayNumber: 'dayNumber',
  title: 'title',
  description: 'description',
  duration: 'duration',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WorkoutProgramExerciseScalarFieldEnum = {
  id: 'id',
  programDayId: 'programDayId',
  exerciseId: 'exerciseId',
  order: 'order',
  sets: 'sets',
  reps: 'reps',
  weight: 'weight',
  duration: 'duration',
  restSeconds: 'restSeconds',
  notes: 'notes',
  createdAt: 'createdAt'
};

exports.Prisma.WorkoutScheduleScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  programDayId: 'programDayId',
  workoutId: 'workoutId',
  sourcePlanId: 'sourcePlanId',
  sourceType: 'sourceType',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionProgramScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  name: 'name',
  goal: 'goal',
  durationWeeks: 'durationWeeks',
  mealsPerDay: 'mealsPerDay',
  dailyCaloriesTarget: 'dailyCaloriesTarget',
  proteinTargetGrams: 'proteinTargetGrams',
  carbTargetGrams: 'carbTargetGrams',
  fatTargetGrams: 'fatTargetGrams',
  sourcePlanId: 'sourcePlanId',
  sourceType: 'sourceType',
  status: 'status',
  startDate: 'startDate',
  endDate: 'endDate',
  repeatEnabled: 'repeatEnabled',
  archivedAt: 'archivedAt',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionProgramDayScalarFieldEnum = {
  id: 'id',
  programId: 'programId',
  dayNumber: 'dayNumber',
  title: 'title',
  totalCalories: 'totalCalories',
  proteinGrams: 'proteinGrams',
  carbGrams: 'carbGrams',
  fatGrams: 'fatGrams',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionProgramMealScalarFieldEnum = {
  id: 'id',
  dayId: 'dayId',
  mealType: 'mealType',
  title: 'title',
  calories: 'calories',
  proteinGrams: 'proteinGrams',
  carbGrams: 'carbGrams',
  fatGrams: 'fatGrams',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionProgramMealItemScalarFieldEnum = {
  id: 'id',
  mealId: 'mealId',
  foodId: 'foodId',
  customFoodName: 'customFoodName',
  quantity: 'quantity',
  unit: 'unit',
  calories: 'calories',
  proteinGrams: 'proteinGrams',
  carbGrams: 'carbGrams',
  fatGrams: 'fatGrams',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.NutritionMealCompletionScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  mealId: 'mealId',
  logDate: 'logDate',
  status: 'status',
  percentConsumed: 'percentConsumed',
  consumedCalories: 'consumedCalories',
  consumedProtein: 'consumedProtein',
  consumedCarbs: 'consumedCarbs',
  consumedFat: 'consumedFat',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};
exports.ExerciseType = exports.$Enums.ExerciseType = {
  STRENGTH: 'STRENGTH',
  CARDIO: 'CARDIO',
  MOBILITY: 'MOBILITY',
  STRENGTH_CARDIO: 'STRENGTH_CARDIO',
  STRENGTH_MOBILITY: 'STRENGTH_MOBILITY'
};

exports.EquipmentType = exports.$Enums.EquipmentType = {
  BODYWEIGHT: 'BODYWEIGHT',
  BARBELL: 'BARBELL',
  DUMBBELLS: 'DUMBBELLS',
  KETTLEBELL: 'KETTLEBELL',
  MACHINE: 'MACHINE',
  RESISTANCE_BAND: 'RESISTANCE_BAND',
  CABLE: 'CABLE',
  MEDICINE_BALL: 'MEDICINE_BALL',
  FOAM_ROLLER: 'FOAM_ROLLER'
};

exports.BodyPart = exports.$Enums.BodyPart = {
  UPPER_BODY: 'UPPER_BODY',
  LOWER_BODY: 'LOWER_BODY',
  CORE: 'CORE',
  FULL_BODY: 'FULL_BODY'
};

exports.MovementType = exports.$Enums.MovementType = {
  PUSH: 'PUSH',
  PULL: 'PULL',
  HOLD: 'HOLD',
  STRETCH: 'STRETCH'
};

exports.Prisma.ModelName = {
  Exercise: 'Exercise',
  Workout: 'Workout',
  WorkoutExercise: 'WorkoutExercise',
  WorkoutSet: 'WorkoutSet',
  Food: 'Food',
  FoodAlias: 'FoodAlias',
  NutritionLog: 'NutritionLog',
  NutritionGoal: 'NutritionGoal',
  BodyMetrics: 'BodyMetrics',
  WorkoutProgram: 'WorkoutProgram',
  WorkoutProgramDay: 'WorkoutProgramDay',
  WorkoutProgramExercise: 'WorkoutProgramExercise',
  WorkoutSchedule: 'WorkoutSchedule',
  NutritionProgram: 'NutritionProgram',
  NutritionProgramDay: 'NutritionProgramDay',
  NutritionProgramMeal: 'NutritionProgramMeal',
  NutritionProgramMealItem: 'NutritionProgramMealItem',
  NutritionMealCompletion: 'NutritionMealCompletion'
};
/**
 * Create the Client
 */
const config = {
  "generator": {
    "name": "client",
    "provider": {
      "fromEnvVar": null,
      "value": "prisma-client-js"
    },
    "output": {
      "value": "/app/backend/services/fitness-service/src/generated/prisma",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "linux-musl-openssl-3.0.x",
        "native": true
      },
      {
        "fromEnvVar": null,
        "value": "linux-musl-openssl-3.0.x"
      }
    ],
    "previewFeatures": [],
    "sourceFilePath": "/app/backend/services/fitness-service/prisma/schema.prisma",
    "isCustomOutput": true
  },
  "relativeEnvPaths": {
    "rootEnvPath": null
  },
  "relativePath": "../../../prisma",
  "clientVersion": "5.22.0",
  "engineVersion": "605197351a3c8bdd595af2d2a9bc3025bca48ea2",
  "datasourceNames": [
    "db"
  ],
  "activeProvider": "postgresql",
  "inlineDatasources": {
    "db": {
      "url": {
        "fromEnvVar": "DATABASE_URL",
        "value": null
      }
    }
  },
  "inlineSchema": "generator client {\n  provider      = \"prisma-client-js\"\n  output        = \"../src/generated/prisma\"\n  binaryTargets = [\"native\", \"linux-musl-openssl-3.0.x\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nenum ExerciseType {\n  STRENGTH\n  CARDIO\n  MOBILITY\n  STRENGTH_CARDIO\n  STRENGTH_MOBILITY\n}\n\nenum EquipmentType {\n  BODYWEIGHT\n  BARBELL\n  DUMBBELLS\n  KETTLEBELL\n  MACHINE\n  RESISTANCE_BAND\n  CABLE\n  MEDICINE_BALL\n  FOAM_ROLLER\n}\n\nenum BodyPart {\n  UPPER_BODY\n  LOWER_BODY\n  CORE\n  FULL_BODY\n}\n\nenum MovementType {\n  PUSH\n  PULL\n  HOLD\n  STRETCH\n}\n\nmodel Exercise {\n  id                    String        @id @default(uuid())\n  exerciseName          String        @map(\"exercise_name\")\n  typeOfActivity        ExerciseType  @map(\"type_of_activity\")\n  typeOfEquipment       EquipmentType @map(\"type_of_equipment\")\n  bodyPart              BodyPart      @map(\"body_part\")\n  type                  MovementType\n  muscleGroupsActivated String[]      @map(\"muscle_groups_activated\")\n  instructions          String\n  videoUrl              String?       @map(\"video_url\")\n  createdAt             DateTime      @default(now()) @map(\"created_at\")\n  updatedAt             DateTime      @updatedAt @map(\"updated_at\")\n\n  workoutExercises        WorkoutExercise[]\n  workoutProgramExercises WorkoutProgramExercise[]\n\n  @@index([bodyPart, typeOfActivity])\n  @@index([typeOfEquipment])\n  @@map(\"exercises\")\n}\n\nmodel Workout {\n  id          String   @id @default(uuid())\n  userId      String   @map(\"user_id\")\n  name        String\n  description String?\n  date        DateTime @default(now())\n  duration    Int? // minutes\n  notes       String?\n  createdAt   DateTime @default(now()) @map(\"created_at\")\n  updatedAt   DateTime @updatedAt @map(\"updated_at\")\n\n  exercises WorkoutExercise[]\n  schedules WorkoutSchedule[]\n\n  @@index([userId, date])\n  @@map(\"workouts\")\n}\n\nmodel WorkoutExercise {\n  id         String   @id @default(uuid())\n  workoutId  String   @map(\"workout_id\")\n  exerciseId String   @map(\"exercise_id\")\n  sets       Int\n  reps       Int?\n  duration   Int? // seconds for holds/cardio\n  weight     Float? // kg\n  notes      String?\n  order      Int      @default(0)\n  createdAt  DateTime @default(now()) @map(\"created_at\")\n\n  workout     Workout      @relation(fields: [workoutId], references: [id], onDelete: Cascade)\n  exercise    Exercise     @relation(fields: [exerciseId], references: [id])\n  workoutSets WorkoutSet[]\n\n  @@index([workoutId])\n  @@index([exerciseId])\n  @@map(\"workout_exercises\")\n}\n\nmodel WorkoutSet {\n  id                String   @id @default(uuid())\n  workoutExerciseId String   @map(\"workout_exercise_id\")\n  setNumber         Int      @map(\"set_number\")\n  reps              Int?\n  weight            Float? // kg\n  rpe               Float? // Rate of Perceived Exertion (1-10)\n  completed         Boolean  @default(false)\n  createdAt         DateTime @default(now()) @map(\"created_at\")\n\n  workoutExercise WorkoutExercise @relation(fields: [workoutExerciseId], references: [id], onDelete: Cascade)\n\n  @@index([workoutExerciseId])\n  @@map(\"workout_sets\")\n}\n\nmodel Food {\n  id       String  @id @default(uuid())\n  fdcId    Int     @unique @map(\"fdc_id\")\n  name     String\n  calories Float\n  protein  Float   @default(0)\n  carbs    Float   @default(0)\n  fats     Float   @default(0)\n  source   String // 'sr_legacy' | 'survey_fndds'\n  imageUrl String? @map(\"image_url\")\n\n  aliases   FoodAlias[]\n  mealItems NutritionProgramMealItem[]\n\n  @@index([name])\n  @@map(\"foods\")\n}\n\nmodel FoodAlias {\n  id              String   @id @default(uuid())\n  foodId          String   @map(\"food_id\")\n  alias           String\n  aliasNormalized String   @map(\"alias_normalized\")\n  language        String   @default(\"vi\")\n  source          String?  @default(\"manual_seed\")\n  createdAt       DateTime @default(now()) @map(\"created_at\")\n  updatedAt       DateTime @updatedAt @map(\"updated_at\")\n\n  food Food @relation(fields: [foodId], references: [id], onDelete: Cascade)\n\n  @@unique([foodId, alias, language])\n  @@unique([foodId, aliasNormalized, language])\n  @@index([foodId])\n  @@index([alias])\n  @@index([aliasNormalized])\n  @@map(\"food_aliases\")\n}\n\nmodel NutritionLog {\n  id        String   @id @default(uuid())\n  userId    String   @map(\"user_id\")\n  date      DateTime @default(now())\n  mealType  String   @map(\"meal_type\") // breakfast, lunch, dinner, snack\n  foodName  String   @map(\"food_name\")\n  calories  Int\n  protein   Float? // grams\n  carbs     Float? // grams\n  fats      Float? // grams\n  notes     String?\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  @@index([userId, date])\n  @@map(\"nutrition_logs\")\n}\n\n// 🎯 Nutrition Goals (one per user, upserted)\nmodel NutritionGoal {\n  id        String   @id @default(uuid())\n  userId    String   @unique @map(\"user_id\")\n  calories  Int      @default(2000)\n  protein   Float    @default(150)\n  carbs     Float    @default(200)\n  fat       Float    @default(65)\n  waterMl   Int?     @map(\"water_ml\")\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  @@map(\"nutrition_goals\")\n}\n\n// 📊 Body Composition Tracking\nmodel BodyMetrics {\n  id         String   @id @default(uuid())\n  userId     String   @map(\"user_id\")\n  date       DateTime @default(now())\n  weight     Float? // kg\n  bodyFat    Float?   @map(\"body_fat\") // percentage\n  muscleMass Float?   @map(\"muscle_mass\") // kg\n  bodyWater  Float?   @map(\"body_water\") // percentage\n  notes      String?\n  createdAt  DateTime @default(now()) @map(\"created_at\")\n  updatedAt  DateTime @updatedAt @map(\"updated_at\")\n\n  @@index([userId, date])\n  @@map(\"body_metrics\")\n}\n\n// 💪 Workout Program Templates\nmodel WorkoutProgram {\n  id            String  @id @default(uuid())\n  userId        String  @map(\"user_id\")\n  name          String // \"Muscle Gain\", \"Cutting\", etc.\n  description   String?\n  sourcePlanId  String? @map(\"source_plan_id\")\n  sourceType    String? @map(\"source_type\")\n  aiPlanVersion Int?    @map(\"ai_plan_version\")\n\n  goal          String?\n  durationWeeks Int?      @map(\"duration_weeks\")\n  daysPerWeek   Int?      @map(\"days_per_week\")\n  status        String    @default(\"ACTIVE\")\n  archivedAt    DateTime? @map(\"archived_at\")\n  version       Int       @default(1)\n\n  createdAt DateTime @default(now()) @map(\"created_at\")\n  updatedAt DateTime @updatedAt @map(\"updated_at\")\n\n  days WorkoutProgramDay[]\n\n  @@unique([userId, sourcePlanId])\n  @@index([userId])\n  @@index([userId, status])\n  @@index([userId, sourcePlanId])\n  @@map(\"workout_programs\")\n}\n\n// 📅 Individual Days within a Workout Program\nmodel WorkoutProgramDay {\n  id          String   @id @default(uuid())\n  programId   String   @map(\"program_id\")\n  dayNumber   Int      @map(\"day_number\") // 1, 2, 3...\n  title       String // \"Chest + Triceps\", \"Back + Biceps\"\n  description String?\n  duration    Int? // minutes\n  createdAt   DateTime @default(now()) @map(\"created_at\")\n  updatedAt   DateTime @updatedAt @map(\"updated_at\")\n\n  program   WorkoutProgram           @relation(fields: [programId], references: [id], onDelete: Cascade)\n  exercises WorkoutProgramExercise[]\n  schedules WorkoutSchedule[]\n\n  @@unique([programId, dayNumber])\n  @@index([programId])\n  @@map(\"workout_program_days\")\n}\n\n// 🏋️ Exercises within a Program Day (with prescriptions)\nmodel WorkoutProgramExercise {\n  id           String   @id @default(uuid())\n  programDayId String   @map(\"program_day_id\")\n  exerciseId   String   @map(\"exercise_id\")\n  order        Int      @default(0)\n  sets         Int?\n  reps         Int?\n  weight       Float? // kg\n  duration     Int? // seconds\n  restSeconds  Int?     @map(\"rest_seconds\")\n  notes        String?\n  createdAt    DateTime @default(now()) @map(\"created_at\")\n\n  programDay WorkoutProgramDay @relation(fields: [programDayId], references: [id], onDelete: Cascade)\n  exercise   Exercise          @relation(fields: [exerciseId], references: [id])\n\n  @@index([programDayId])\n  @@index([exerciseId])\n  @@map(\"workout_program_exercises\")\n}\n\n// 📆 Calendar Scheduling (links user to program days on specific dates)\nmodel WorkoutSchedule {\n  id           String   @id @default(uuid())\n  userId       String   @map(\"user_id\")\n  date         DateTime\n  programDayId String?  @map(\"program_day_id\") // optional: which program day is scheduled\n  workoutId    String?  @map(\"workout_id\") // optional: completed workout\n  sourcePlanId String?  @map(\"source_plan_id\")\n  sourceType   String?  @map(\"source_type\")\n  notes        String?\n  createdAt    DateTime @default(now()) @map(\"created_at\")\n  updatedAt    DateTime @updatedAt @map(\"updated_at\")\n\n  programDay WorkoutProgramDay? @relation(fields: [programDayId], references: [id], onDelete: SetNull)\n  workout    Workout?           @relation(fields: [workoutId], references: [id], onDelete: SetNull)\n\n  @@unique([userId, date])\n  @@index([userId, date])\n  @@index([userId, sourcePlanId])\n  @@index([programDayId])\n  @@index([workoutId])\n  @@map(\"workout_schedules\")\n}\n\n// 🥗 Nutrition Program (from AI plan or manual, replaces mock data)\nmodel NutritionProgram {\n  id                  String    @id @default(uuid())\n  userId              String    @map(\"user_id\")\n  name                String\n  goal                String?\n  durationWeeks       Int?      @map(\"duration_weeks\")\n  mealsPerDay         Int?      @map(\"meals_per_day\")\n  dailyCaloriesTarget Int?      @map(\"daily_calories_target\")\n  proteinTargetGrams  Float?    @map(\"protein_target_grams\")\n  carbTargetGrams     Float?    @map(\"carb_target_grams\")\n  fatTargetGrams      Float?    @map(\"fat_target_grams\")\n  sourcePlanId        String?   @map(\"source_plan_id\") // ai-service NutritionPlan id\n  sourceType          String?   @map(\"source_type\") // \"AI_PLAN\" | \"MANUAL\"\n  status              String    @default(\"ACTIVE\") // \"ACTIVE\" | \"ARCHIVED\"\n  startDate           DateTime? @map(\"start_date\")\n  endDate             DateTime? @map(\"end_date\") // last calendar day of the plan\n  repeatEnabled       Boolean   @default(false) @map(\"repeat_enabled\") // cycle 7-day menu beyond endDate window\n  archivedAt          DateTime? @map(\"archived_at\")\n  notes               String?\n  createdAt           DateTime  @default(now()) @map(\"created_at\")\n  updatedAt           DateTime  @updatedAt @map(\"updated_at\")\n\n  days NutritionProgramDay[]\n\n  @@unique([userId, sourcePlanId])\n  @@index([userId])\n  @@index([userId, status])\n  @@map(\"nutrition_programs\")\n}\n\n// 📅 Daily breakdown within a NutritionProgram\nmodel NutritionProgramDay {\n  id            String   @id @default(uuid())\n  programId     String   @map(\"program_id\")\n  dayNumber     Int      @map(\"day_number\")\n  title         String?\n  totalCalories Int?     @map(\"total_calories\")\n  proteinGrams  Float?   @map(\"protein_grams\")\n  carbGrams     Float?   @map(\"carb_grams\")\n  fatGrams      Float?   @map(\"fat_grams\")\n  createdAt     DateTime @default(now()) @map(\"created_at\")\n  updatedAt     DateTime @updatedAt @map(\"updated_at\")\n\n  program NutritionProgram       @relation(fields: [programId], references: [id], onDelete: Cascade)\n  meals   NutritionProgramMeal[]\n\n  @@unique([programId, dayNumber])\n  @@index([programId])\n  @@map(\"nutrition_program_days\")\n}\n\n// 🍽️ A single meal (breakfast/lunch/dinner/snack) within a program day\nmodel NutritionProgramMeal {\n  id           String   @id @default(uuid())\n  dayId        String   @map(\"day_id\")\n  mealType     String   @map(\"meal_type\") // \"BREAKFAST\" | \"LUNCH\" | \"DINNER\" | \"SNACK\"\n  title        String?\n  calories     Int?\n  proteinGrams Float?   @map(\"protein_grams\")\n  carbGrams    Float?   @map(\"carb_grams\")\n  fatGrams     Float?   @map(\"fat_grams\")\n  notes        String?\n  createdAt    DateTime @default(now()) @map(\"created_at\")\n  updatedAt    DateTime @updatedAt @map(\"updated_at\")\n\n  day         NutritionProgramDay        @relation(fields: [dayId], references: [id], onDelete: Cascade)\n  items       NutritionProgramMealItem[]\n  completions NutritionMealCompletion[]\n\n  @@index([dayId])\n  @@map(\"nutrition_program_meals\")\n}\n\n// 🥦 Individual food items within a meal\nmodel NutritionProgramMealItem {\n  id             String   @id @default(uuid())\n  mealId         String   @map(\"meal_id\")\n  foodId         String?  @map(\"food_id\") // FK to Food (nullable if custom)\n  customFoodName String?  @map(\"custom_food_name\") // fallback if no foodId\n  quantity       Float    @default(100)\n  unit           String   @default(\"g\")\n  calories       Int?\n  proteinGrams   Float?   @map(\"protein_grams\")\n  carbGrams      Float?   @map(\"carb_grams\")\n  fatGrams       Float?   @map(\"fat_grams\")\n  notes          String?\n  createdAt      DateTime @default(now()) @map(\"created_at\")\n  updatedAt      DateTime @updatedAt @map(\"updated_at\")\n\n  meal NutritionProgramMeal @relation(fields: [mealId], references: [id], onDelete: Cascade)\n  food Food?                @relation(fields: [foodId], references: [id], onDelete: SetNull)\n\n  @@index([mealId])\n  @@index([foodId])\n  @@map(\"nutrition_program_meal_items\")\n}\n\n// ✅ Tracks whether a user completed/skipped/partially ate a planned meal on a given date\nmodel NutritionMealCompletion {\n  id               String    @id @default(uuid())\n  userId           String    @map(\"user_id\")\n  mealId           String    @map(\"meal_id\")\n  logDate          DateTime  @map(\"log_date\") @db.Date // The actual calendar date (date-only)\n  status           String    @default(\"PENDING\") // PENDING | COMPLETED | PARTIAL | SKIPPED\n  percentConsumed  Int       @default(100) @map(\"percent_consumed\") // 100 for full, 0-99 for partial\n  consumedCalories Int?      @map(\"consumed_calories\")\n  consumedProtein  Float?    @map(\"consumed_protein\")\n  consumedCarbs    Float?    @map(\"consumed_carbs\")\n  consumedFat      Float?    @map(\"consumed_fat\")\n  completedAt      DateTime? @map(\"completed_at\")\n  createdAt        DateTime  @default(now()) @map(\"created_at\")\n  updatedAt        DateTime  @updatedAt @map(\"updated_at\")\n\n  meal NutritionProgramMeal @relation(fields: [mealId], references: [id], onDelete: Cascade)\n\n  @@unique([userId, mealId, logDate], name: \"nutrition_meal_completion_unique\")\n  @@index([userId, logDate])\n  @@map(\"nutrition_meal_completions\")\n}\n",
  "inlineSchemaHash": "39793979af4097327032c1177c6332b23ffe9038eb94d4378c3aa3b4a2a9e024",
  "copyEngine": true
}

const fs = require('fs')

config.dirname = __dirname
if (!fs.existsSync(path.join(__dirname, 'schema.prisma'))) {
  const alternativePaths = [
    "src/generated/prisma",
    "generated/prisma",
  ]
  
  const alternativePath = alternativePaths.find((altPath) => {
    return fs.existsSync(path.join(process.cwd(), altPath, 'schema.prisma'))
  }) ?? alternativePaths[0]

  config.dirname = path.join(process.cwd(), alternativePath)
  config.isBundled = true
}

config.runtimeDataModel = JSON.parse("{\"models\":{\"Exercise\":{\"dbName\":\"exercises\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"exerciseName\",\"dbName\":\"exercise_name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"typeOfActivity\",\"dbName\":\"type_of_activity\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"ExerciseType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"typeOfEquipment\",\"dbName\":\"type_of_equipment\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"EquipmentType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bodyPart\",\"dbName\":\"body_part\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"BodyPart\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"type\",\"kind\":\"enum\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"MovementType\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"muscleGroupsActivated\",\"dbName\":\"muscle_groups_activated\",\"kind\":\"scalar\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"instructions\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"videoUrl\",\"dbName\":\"video_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"workoutExercises\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutExercise\",\"relationName\":\"ExerciseToWorkoutExercise\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"workoutProgramExercises\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutProgramExercise\",\"relationName\":\"ExerciseToWorkoutProgramExercise\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"Workout\":{\"dbName\":\"workouts\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"duration\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"exercises\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutExercise\",\"relationName\":\"WorkoutToWorkoutExercise\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"schedules\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutSchedule\",\"relationName\":\"WorkoutToWorkoutSchedule\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"WorkoutExercise\":{\"dbName\":\"workout_exercises\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"workoutId\",\"dbName\":\"workout_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"exerciseId\",\"dbName\":\"exercise_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sets\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reps\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"duration\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"weight\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"order\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"workout\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Workout\",\"relationName\":\"WorkoutToWorkoutExercise\",\"relationFromFields\":[\"workoutId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"exercise\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Exercise\",\"relationName\":\"ExerciseToWorkoutExercise\",\"relationFromFields\":[\"exerciseId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"workoutSets\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutSet\",\"relationName\":\"WorkoutExerciseToWorkoutSet\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"WorkoutSet\":{\"dbName\":\"workout_sets\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"workoutExerciseId\",\"dbName\":\"workout_exercise_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"setNumber\",\"dbName\":\"set_number\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reps\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"weight\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"rpe\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"completed\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"workoutExercise\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutExercise\",\"relationName\":\"WorkoutExerciseToWorkoutSet\",\"relationFromFields\":[\"workoutExerciseId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"Food\":{\"dbName\":\"foods\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fdcId\",\"dbName\":\"fdc_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"calories\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"protein\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Float\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"carbs\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Float\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fats\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Float\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"source\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"imageUrl\",\"dbName\":\"image_url\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"aliases\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"FoodAlias\",\"relationName\":\"FoodToFoodAlias\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"mealItems\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionProgramMealItem\",\"relationName\":\"FoodToNutritionProgramMealItem\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"FoodAlias\":{\"dbName\":\"food_aliases\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"foodId\",\"dbName\":\"food_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"alias\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"aliasNormalized\",\"dbName\":\"alias_normalized\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"language\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"vi\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"source\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"manual_seed\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"food\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Food\",\"relationName\":\"FoodToFoodAlias\",\"relationFromFields\":[\"foodId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"foodId\",\"alias\",\"language\"],[\"foodId\",\"aliasNormalized\",\"language\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"foodId\",\"alias\",\"language\"]},{\"name\":null,\"fields\":[\"foodId\",\"aliasNormalized\",\"language\"]}],\"isGenerated\":false},\"NutritionLog\":{\"dbName\":\"nutrition_logs\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"mealType\",\"dbName\":\"meal_type\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"foodName\",\"dbName\":\"food_name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"calories\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"protein\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"carbs\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fats\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"NutritionGoal\":{\"dbName\":\"nutrition_goals\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":true,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"calories\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":2000,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"protein\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Float\",\"default\":150,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"carbs\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Float\",\"default\":200,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Float\",\"default\":65,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"waterMl\",\"dbName\":\"water_ml\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"BodyMetrics\":{\"dbName\":\"body_metrics\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"weight\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bodyFat\",\"dbName\":\"body_fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"muscleMass\",\"dbName\":\"muscle_mass\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"bodyWater\",\"dbName\":\"body_water\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"WorkoutProgram\":{\"dbName\":\"workout_programs\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourcePlanId\",\"dbName\":\"source_plan_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourceType\",\"dbName\":\"source_type\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"aiPlanVersion\",\"dbName\":\"ai_plan_version\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"goal\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"durationWeeks\",\"dbName\":\"duration_weeks\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"daysPerWeek\",\"dbName\":\"days_per_week\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"ACTIVE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"archivedAt\",\"dbName\":\"archived_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"version\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":1,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"days\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutProgramDay\",\"relationName\":\"WorkoutProgramToWorkoutProgramDay\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"userId\",\"sourcePlanId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"userId\",\"sourcePlanId\"]}],\"isGenerated\":false},\"WorkoutProgramDay\":{\"dbName\":\"workout_program_days\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"programId\",\"dbName\":\"program_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"dayNumber\",\"dbName\":\"day_number\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"title\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"description\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"duration\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"program\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutProgram\",\"relationName\":\"WorkoutProgramToWorkoutProgramDay\",\"relationFromFields\":[\"programId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"exercises\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutProgramExercise\",\"relationName\":\"WorkoutProgramDayToWorkoutProgramExercise\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"schedules\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutSchedule\",\"relationName\":\"WorkoutProgramDayToWorkoutSchedule\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"programId\",\"dayNumber\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"programId\",\"dayNumber\"]}],\"isGenerated\":false},\"WorkoutProgramExercise\":{\"dbName\":\"workout_program_exercises\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"programDayId\",\"dbName\":\"program_day_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"exerciseId\",\"dbName\":\"exercise_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"order\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":0,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sets\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"reps\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"weight\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"duration\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"restSeconds\",\"dbName\":\"rest_seconds\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"programDay\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutProgramDay\",\"relationName\":\"WorkoutProgramDayToWorkoutProgramExercise\",\"relationFromFields\":[\"programDayId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"exercise\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Exercise\",\"relationName\":\"ExerciseToWorkoutProgramExercise\",\"relationFromFields\":[\"exerciseId\"],\"relationToFields\":[\"id\"],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"WorkoutSchedule\":{\"dbName\":\"workout_schedules\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"programDayId\",\"dbName\":\"program_day_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"workoutId\",\"dbName\":\"workout_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourcePlanId\",\"dbName\":\"source_plan_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourceType\",\"dbName\":\"source_type\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"programDay\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"WorkoutProgramDay\",\"relationName\":\"WorkoutProgramDayToWorkoutSchedule\",\"relationFromFields\":[\"programDayId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"SetNull\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"workout\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Workout\",\"relationName\":\"WorkoutToWorkoutSchedule\",\"relationFromFields\":[\"workoutId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"SetNull\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"userId\",\"date\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"userId\",\"date\"]}],\"isGenerated\":false},\"NutritionProgram\":{\"dbName\":\"nutrition_programs\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"goal\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"durationWeeks\",\"dbName\":\"duration_weeks\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"mealsPerDay\",\"dbName\":\"meals_per_day\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"dailyCaloriesTarget\",\"dbName\":\"daily_calories_target\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"proteinTargetGrams\",\"dbName\":\"protein_target_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"carbTargetGrams\",\"dbName\":\"carb_target_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fatTargetGrams\",\"dbName\":\"fat_target_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourcePlanId\",\"dbName\":\"source_plan_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"sourceType\",\"dbName\":\"source_type\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"ACTIVE\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"startDate\",\"dbName\":\"start_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"endDate\",\"dbName\":\"end_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"repeatEnabled\",\"dbName\":\"repeat_enabled\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Boolean\",\"default\":false,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"archivedAt\",\"dbName\":\"archived_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"days\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionProgramDay\",\"relationName\":\"NutritionProgramToNutritionProgramDay\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"userId\",\"sourcePlanId\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"userId\",\"sourcePlanId\"]}],\"isGenerated\":false},\"NutritionProgramDay\":{\"dbName\":\"nutrition_program_days\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"programId\",\"dbName\":\"program_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"dayNumber\",\"dbName\":\"day_number\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"title\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"totalCalories\",\"dbName\":\"total_calories\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"proteinGrams\",\"dbName\":\"protein_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"carbGrams\",\"dbName\":\"carb_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fatGrams\",\"dbName\":\"fat_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"program\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionProgram\",\"relationName\":\"NutritionProgramToNutritionProgramDay\",\"relationFromFields\":[\"programId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"meals\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionProgramMeal\",\"relationName\":\"NutritionProgramDayToNutritionProgramMeal\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"programId\",\"dayNumber\"]],\"uniqueIndexes\":[{\"name\":null,\"fields\":[\"programId\",\"dayNumber\"]}],\"isGenerated\":false},\"NutritionProgramMeal\":{\"dbName\":\"nutrition_program_meals\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"dayId\",\"dbName\":\"day_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"mealType\",\"dbName\":\"meal_type\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"title\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"calories\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"proteinGrams\",\"dbName\":\"protein_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"carbGrams\",\"dbName\":\"carb_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fatGrams\",\"dbName\":\"fat_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"day\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionProgramDay\",\"relationName\":\"NutritionProgramDayToNutritionProgramMeal\",\"relationFromFields\":[\"dayId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"items\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionProgramMealItem\",\"relationName\":\"NutritionProgramMealToNutritionProgramMealItem\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"completions\",\"kind\":\"object\",\"isList\":true,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionMealCompletion\",\"relationName\":\"NutritionMealCompletionToNutritionProgramMeal\",\"relationFromFields\":[],\"relationToFields\":[],\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"NutritionProgramMealItem\":{\"dbName\":\"nutrition_program_meal_items\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"mealId\",\"dbName\":\"meal_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"foodId\",\"dbName\":\"food_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"customFoodName\",\"dbName\":\"custom_food_name\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"quantity\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Float\",\"default\":100,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"unit\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"g\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"calories\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"proteinGrams\",\"dbName\":\"protein_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"carbGrams\",\"dbName\":\"carb_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"fatGrams\",\"dbName\":\"fat_grams\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"notes\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"meal\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionProgramMeal\",\"relationName\":\"NutritionProgramMealToNutritionProgramMealItem\",\"relationFromFields\":[\"mealId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"food\",\"kind\":\"object\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Food\",\"relationName\":\"FoodToNutritionProgramMealItem\",\"relationFromFields\":[\"foodId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"SetNull\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[],\"uniqueIndexes\":[],\"isGenerated\":false},\"NutritionMealCompletion\":{\"dbName\":\"nutrition_meal_completions\",\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":true,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":{\"name\":\"uuid(4)\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"userId\",\"dbName\":\"user_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"mealId\",\"dbName\":\"meal_id\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":true,\"hasDefaultValue\":false,\"type\":\"String\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"logDate\",\"dbName\":\"log_date\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"status\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"String\",\"default\":\"PENDING\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"percentConsumed\",\"dbName\":\"percent_consumed\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"Int\",\"default\":100,\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"consumedCalories\",\"dbName\":\"consumed_calories\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Int\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"consumedProtein\",\"dbName\":\"consumed_protein\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"consumedCarbs\",\"dbName\":\"consumed_carbs\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"consumedFat\",\"dbName\":\"consumed_fat\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"Float\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"completedAt\",\"dbName\":\"completed_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":false,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"createdAt\",\"dbName\":\"created_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":true,\"type\":\"DateTime\",\"default\":{\"name\":\"now\",\"args\":[]},\"isGenerated\":false,\"isUpdatedAt\":false},{\"name\":\"updatedAt\",\"dbName\":\"updated_at\",\"kind\":\"scalar\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"DateTime\",\"isGenerated\":false,\"isUpdatedAt\":true},{\"name\":\"meal\",\"kind\":\"object\",\"isList\":false,\"isRequired\":true,\"isUnique\":false,\"isId\":false,\"isReadOnly\":false,\"hasDefaultValue\":false,\"type\":\"NutritionProgramMeal\",\"relationName\":\"NutritionMealCompletionToNutritionProgramMeal\",\"relationFromFields\":[\"mealId\"],\"relationToFields\":[\"id\"],\"relationOnDelete\":\"Cascade\",\"isGenerated\":false,\"isUpdatedAt\":false}],\"primaryKey\":null,\"uniqueFields\":[[\"userId\",\"mealId\",\"logDate\"]],\"uniqueIndexes\":[{\"name\":\"nutrition_meal_completion_unique\",\"fields\":[\"userId\",\"mealId\",\"logDate\"]}],\"isGenerated\":false}},\"enums\":{\"ExerciseType\":{\"values\":[{\"name\":\"STRENGTH\",\"dbName\":null},{\"name\":\"CARDIO\",\"dbName\":null},{\"name\":\"MOBILITY\",\"dbName\":null},{\"name\":\"STRENGTH_CARDIO\",\"dbName\":null},{\"name\":\"STRENGTH_MOBILITY\",\"dbName\":null}],\"dbName\":null},\"EquipmentType\":{\"values\":[{\"name\":\"BODYWEIGHT\",\"dbName\":null},{\"name\":\"BARBELL\",\"dbName\":null},{\"name\":\"DUMBBELLS\",\"dbName\":null},{\"name\":\"KETTLEBELL\",\"dbName\":null},{\"name\":\"MACHINE\",\"dbName\":null},{\"name\":\"RESISTANCE_BAND\",\"dbName\":null},{\"name\":\"CABLE\",\"dbName\":null},{\"name\":\"MEDICINE_BALL\",\"dbName\":null},{\"name\":\"FOAM_ROLLER\",\"dbName\":null}],\"dbName\":null},\"BodyPart\":{\"values\":[{\"name\":\"UPPER_BODY\",\"dbName\":null},{\"name\":\"LOWER_BODY\",\"dbName\":null},{\"name\":\"CORE\",\"dbName\":null},{\"name\":\"FULL_BODY\",\"dbName\":null}],\"dbName\":null},\"MovementType\":{\"values\":[{\"name\":\"PUSH\",\"dbName\":null},{\"name\":\"PULL\",\"dbName\":null},{\"name\":\"HOLD\",\"dbName\":null},{\"name\":\"STRETCH\",\"dbName\":null}],\"dbName\":null}},\"types\":{}}")
defineDmmfProperty(exports.Prisma, config.runtimeDataModel)
config.engineWasm = undefined


const { warnEnvConflicts } = require('./runtime/library.js')

warnEnvConflicts({
    rootEnvPath: config.relativeEnvPaths.rootEnvPath && path.resolve(config.dirname, config.relativeEnvPaths.rootEnvPath),
    schemaEnvPath: config.relativeEnvPaths.schemaEnvPath && path.resolve(config.dirname, config.relativeEnvPaths.schemaEnvPath)
})

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

// file annotations for bundling tools to include these files
path.join(__dirname, "libquery_engine-linux-musl-openssl-3.0.x.so.node");
path.join(process.cwd(), "src/generated/prisma/libquery_engine-linux-musl-openssl-3.0.x.so.node")
// file annotations for bundling tools to include these files
path.join(__dirname, "schema.prisma");
path.join(process.cwd(), "src/generated/prisma/schema.prisma")
