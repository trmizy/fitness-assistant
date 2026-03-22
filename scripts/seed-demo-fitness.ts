import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import {
  PrismaClient as AuthPrismaClient,
  Role,
} from '../backend/services/auth-service/src/generated/prisma';
import {
  PrismaClient as UserPrismaClient,
  Gender,
  Goal,
  ActivityLevel,
  ExperienceLevel,
} from '../backend/services/user-service/src/generated/prisma';
import {
  PrismaClient as FitnessPrismaClient,
  ExerciseType,
  EquipmentType,
  BodyPart,
  MovementType,
} from '../backend/services/fitness-service/src/generated/prisma';
import { PrismaClient as AiPrismaClient } from '../backend/services/ai-service/src/generated/prisma';

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const DEMO_VIDEO_PREFIX = 'https://demo.fitassistant.local/exercises/';
const DEMO_PASSWORD = 'Demo@12345';

let authPrisma!: AuthPrismaClient;
let userPrisma!: UserPrismaClient;
let fitnessPrisma!: FitnessPrismaClient;
let aiPrisma!: AiPrismaClient;

let randomSeed = 42;
function seededRandom() {
  randomSeed = (randomSeed * 1664525 + 1013904223) % 4294967296;
  return randomSeed / 4294967296;
}

function pickOne<T>(items: T[]): T {
  return items[Math.floor(seededRandom() * items.length)];
}

function pickManyUnique<T>(items: T[], count: number): T[] {
  const copy = [...items];
  const picked: T[] = [];
  while (copy.length > 0 && picked.length < count) {
    const index = Math.floor(seededRandom() * copy.length);
    picked.push(copy.splice(index, 1)[0]);
  }
  return picked;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  d.setHours(6 + Math.floor(seededRandom() * 14));
  d.setMinutes(Math.floor(seededRandom() * 60));
  return d;
}

function ensureEnvironment() {
  if (fs.existsSync(ENV_PATH)) {
    dotenv.config({ path: ENV_PATH, override: true });
    console.log(`[env] Loaded .env from ${ENV_PATH}`);
  } else {
    dotenv.config({ override: true });
    console.log('[env] .env at root not found, loaded default environment');
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is missing. Please set it in .env before seeding.');
  }

  process.env.DATABASE_URL = process.env.DATABASE_URL;
  return process.env.DATABASE_URL;
}

type DemoUserSeed = {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  isPT: boolean;
  goal: Goal;
  activityLevel: ActivityLevel;
  experienceLevel: ExperienceLevel;
  gender: Gender;
  age: number;
  heightCm: number;
  currentWeight: number;
  targetWeight: number;
  preferredTrainingDays: number[];
  availableEquipment: string[];
  injuries: string[];
};

const demoUsersSeed: DemoUserSeed[] = [
  {
    email: 'demo.admin@fitassistant.local',
    firstName: 'Demo',
    lastName: 'Admin',
    role: Role.ADMIN,
    isPT: false,
    goal: Goal.MAINTENANCE,
    activityLevel: ActivityLevel.MODERATELY_ACTIVE,
    experienceLevel: ExperienceLevel.INTERMEDIATE,
    gender: Gender.OTHER,
    age: 35,
    heightCm: 172,
    currentWeight: 70,
    targetWeight: 70,
    preferredTrainingDays: [1, 3, 5],
    availableEquipment: ['dumbbells', 'bands', 'machine'],
    injuries: [],
  },
  {
    email: 'demo.pt@fitassistant.local',
    firstName: 'Demo',
    lastName: 'Trainer',
    role: Role.PT,
    isPT: true,
    goal: Goal.ATHLETIC_PERFORMANCE,
    activityLevel: ActivityLevel.VERY_ACTIVE,
    experienceLevel: ExperienceLevel.ADVANCED,
    gender: Gender.MALE,
    age: 31,
    heightCm: 178,
    currentWeight: 82,
    targetWeight: 83,
    preferredTrainingDays: [1, 2, 3, 4, 5, 6],
    availableEquipment: ['barbell', 'dumbbells', 'cable', 'machine'],
    injuries: ['old right shoulder strain'],
  },
  {
    email: 'demo.user1@fitassistant.local',
    firstName: 'Lina',
    lastName: 'Nguyen',
    role: Role.CUSTOMER,
    isPT: false,
    goal: Goal.WEIGHT_LOSS,
    activityLevel: ActivityLevel.LIGHTLY_ACTIVE,
    experienceLevel: ExperienceLevel.BEGINNER,
    gender: Gender.FEMALE,
    age: 27,
    heightCm: 160,
    currentWeight: 68,
    targetWeight: 58,
    preferredTrainingDays: [1, 3, 5],
    availableEquipment: ['bodyweight', 'bands'],
    injuries: [],
  },
  {
    email: 'demo.user2@fitassistant.local',
    firstName: 'Minh',
    lastName: 'Tran',
    role: Role.CUSTOMER,
    isPT: false,
    goal: Goal.MUSCLE_GAIN,
    activityLevel: ActivityLevel.MODERATELY_ACTIVE,
    experienceLevel: ExperienceLevel.INTERMEDIATE,
    gender: Gender.MALE,
    age: 25,
    heightCm: 174,
    currentWeight: 68,
    targetWeight: 75,
    preferredTrainingDays: [1, 2, 4, 6],
    availableEquipment: ['barbell', 'dumbbells', 'machine'],
    injuries: [],
  },
  {
    email: 'demo.user3@fitassistant.local',
    firstName: 'Anna',
    lastName: 'Le',
    role: Role.CUSTOMER,
    isPT: false,
    goal: Goal.MAINTENANCE,
    activityLevel: ActivityLevel.MODERATELY_ACTIVE,
    experienceLevel: ExperienceLevel.INTERMEDIATE,
    gender: Gender.FEMALE,
    age: 30,
    heightCm: 165,
    currentWeight: 58,
    targetWeight: 58,
    preferredTrainingDays: [2, 4, 6],
    availableEquipment: ['dumbbells', 'bodyweight'],
    injuries: ['left knee sensitivity'],
  },
  {
    email: 'demo.user4@fitassistant.local',
    firstName: 'David',
    lastName: 'Pham',
    role: Role.CUSTOMER,
    isPT: false,
    goal: Goal.WEIGHT_LOSS,
    activityLevel: ActivityLevel.SEDENTARY,
    experienceLevel: ExperienceLevel.BEGINNER,
    gender: Gender.MALE,
    age: 38,
    heightCm: 170,
    currentWeight: 85,
    targetWeight: 75,
    preferredTrainingDays: [1, 4, 6],
    availableEquipment: ['bodyweight'],
    injuries: ['lower back tightness'],
  },
  {
    email: 'demo.user5@fitassistant.local',
    firstName: 'Sara',
    lastName: 'Do',
    role: Role.CUSTOMER,
    isPT: false,
    goal: Goal.ATHLETIC_PERFORMANCE,
    activityLevel: ActivityLevel.VERY_ACTIVE,
    experienceLevel: ExperienceLevel.ADVANCED,
    gender: Gender.FEMALE,
    age: 29,
    heightCm: 168,
    currentWeight: 61,
    targetWeight: 62,
    preferredTrainingDays: [1, 2, 3, 5, 6],
    availableEquipment: ['barbell', 'dumbbells', 'kettlebell', 'cable'],
    injuries: [],
  },
  {
    email: 'demo.user6@fitassistant.local',
    firstName: 'Khanh',
    lastName: 'Vo',
    role: Role.CUSTOMER,
    isPT: false,
    goal: Goal.MUSCLE_GAIN,
    activityLevel: ActivityLevel.MODERATELY_ACTIVE,
    experienceLevel: ExperienceLevel.BEGINNER,
    gender: Gender.MALE,
    age: 23,
    heightCm: 176,
    currentWeight: 62,
    targetWeight: 70,
    preferredTrainingDays: [2, 4, 6],
    availableEquipment: ['dumbbells', 'machine'],
    injuries: [],
  },
  {
    email: 'demo.user7@fitassistant.local',
    firstName: 'Mai',
    lastName: 'Ho',
    role: Role.CUSTOMER,
    isPT: false,
    goal: Goal.WEIGHT_LOSS,
    activityLevel: ActivityLevel.LIGHTLY_ACTIVE,
    experienceLevel: ExperienceLevel.BEGINNER,
    gender: Gender.FEMALE,
    age: 34,
    heightCm: 158,
    currentWeight: 72,
    targetWeight: 62,
    preferredTrainingDays: [1, 3, 5],
    availableEquipment: ['bodyweight', 'resistance_band'],
    injuries: ['right ankle mobility'],
  },
  {
    email: 'demo.user8@fitassistant.local',
    firstName: 'Tom',
    lastName: 'Bui',
    role: Role.CUSTOMER,
    isPT: false,
    goal: Goal.MAINTENANCE,
    activityLevel: ActivityLevel.MODERATELY_ACTIVE,
    experienceLevel: ExperienceLevel.INTERMEDIATE,
    gender: Gender.MALE,
    age: 32,
    heightCm: 180,
    currentWeight: 78,
    targetWeight: 77,
    preferredTrainingDays: [2, 4, 6],
    availableEquipment: ['barbell', 'dumbbells', 'machine'],
    injuries: [],
  },
];

type DemoUserRecord = {
  id: string;
  email: string;
  role: Role;
  goal: Goal;
  isPT: boolean;
  experienceLevel: ExperienceLevel;
  equipment: string[];
};

type Summary = {
  users: number;
  profiles: number;
  exercises: number;
  workouts: number;
  workoutExercises: number;
  workoutPlans: number;
  nutritionLogs: number;
  conversations: number;
  auditLogs: number;
};

async function createDemoUsers(summary: Summary): Promise<DemoUserRecord[]> {
  console.log('[seed] createDemoUsers');
  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10);
  const records: DemoUserRecord[] = [];

  for (const item of demoUsersSeed) {
    const existing = await authPrisma.user.findUnique({ where: { email: item.email } });
    const user = await authPrisma.user.upsert({
      where: { email: item.email },
      update: {
        firstName: item.firstName,
        lastName: item.lastName,
        role: item.role,
        password: hashedPassword,
      },
      create: {
        email: item.email,
        firstName: item.firstName,
        lastName: item.lastName,
        role: item.role,
        password: hashedPassword,
      },
    });

    if (!existing) summary.users += 1;

    records.push({
      id: user.id,
      email: item.email,
      role: item.role,
      goal: item.goal,
      isPT: item.isPT,
      experienceLevel: item.experienceLevel,
      equipment: item.availableEquipment,
    });
  }

  return records;
}

async function createDemoProfiles(users: DemoUserRecord[], summary: Summary) {
  console.log('[seed] createDemoProfiles');

  for (const item of demoUsersSeed) {
    const user = users.find((u) => u.email === item.email);
    if (!user) continue;

    const existing = await userPrisma.userProfile.findUnique({ where: { userId: user.id } });
    await userPrisma.userProfile.upsert({
      where: { userId: user.id },
      update: {
        isPT: item.isPT,
        age: item.age,
        gender: item.gender,
        heightCm: item.heightCm,
        goal: item.goal,
        activityLevel: item.activityLevel,
        experienceLevel: item.experienceLevel,
        preferredTrainingDays: item.preferredTrainingDays,
        availableEquipment: item.availableEquipment,
        injuries: item.injuries,
        currentWeight: item.currentWeight,
        targetWeight: item.targetWeight,
      },
      create: {
        userId: user.id,
        isPT: item.isPT,
        age: item.age,
        gender: item.gender,
        heightCm: item.heightCm,
        goal: item.goal,
        activityLevel: item.activityLevel,
        experienceLevel: item.experienceLevel,
        preferredTrainingDays: item.preferredTrainingDays,
        availableEquipment: item.availableEquipment,
        injuries: item.injuries,
        currentWeight: item.currentWeight,
        targetWeight: item.targetWeight,
      },
    });

    if (!existing) summary.profiles += 1;
  }
}

type ExerciseSeed = {
  exerciseName: string;
  typeOfActivity: ExerciseType;
  typeOfEquipment: EquipmentType;
  bodyPart: BodyPart;
  type: MovementType;
  muscleGroupsActivated: string[];
  instructions: string;
  videoSlug: string;
};

function getExerciseSeeds(): ExerciseSeed[] {
  return [
    { exerciseName: 'Push-Up', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['chest', 'triceps', 'front delts'], instructions: 'Keep body in one line and lower chest under control. [DEMO]', videoSlug: 'push-up' },
    { exerciseName: 'Bench Press', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BARBELL, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['chest', 'triceps', 'front delts'], instructions: 'Drive feet down and press bar over mid chest. [DEMO]', videoSlug: 'bench-press' },
    { exerciseName: 'Incline Dumbbell Press', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['upper chest', 'triceps', 'front delts'], instructions: 'Set bench incline to 30-45 degrees and press up. [DEMO]', videoSlug: 'incline-dumbbell-press' },
    { exerciseName: 'Chest Fly Machine', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.MACHINE, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['chest', 'front delts'], instructions: 'Keep elbows soft and squeeze chest at center. [DEMO]', videoSlug: 'chest-fly-machine' },
    { exerciseName: 'Lat Pulldown', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.CABLE, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['lats', 'biceps', 'upper back'], instructions: 'Pull bar to upper chest with neutral spine. [DEMO]', videoSlug: 'lat-pulldown' },
    { exerciseName: 'Barbell Row', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BARBELL, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['lats', 'middle back', 'rear delts'], instructions: 'Hinge at hips and row bar to lower ribs. [DEMO]', videoSlug: 'barbell-row' },
    { exerciseName: 'Dumbbell Row', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['lats', 'middle back', 'biceps'], instructions: 'Keep torso stable and pull elbow toward hip. [DEMO]', videoSlug: 'dumbbell-row' },
    { exerciseName: 'Face Pull', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.CABLE, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['rear delts', 'upper back'], instructions: 'Pull rope to forehead and externally rotate shoulders. [DEMO]', videoSlug: 'face-pull' },
    { exerciseName: 'Bodyweight Squat', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.LOWER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['quads', 'glutes', 'core'], instructions: 'Sit hips back and keep knees tracking over toes. [DEMO]', videoSlug: 'bodyweight-squat' },
    { exerciseName: 'Back Squat', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BARBELL, bodyPart: BodyPart.LOWER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['quads', 'glutes', 'hamstrings'], instructions: 'Brace core and drive up through mid-foot. [DEMO]', videoSlug: 'back-squat' },
    { exerciseName: 'Romanian Deadlift', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BARBELL, bodyPart: BodyPart.LOWER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['hamstrings', 'glutes', 'lower back'], instructions: 'Hinge hips back and keep bar close to thighs. [DEMO]', videoSlug: 'romanian-deadlift' },
    { exerciseName: 'Walking Lunge', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.LOWER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['quads', 'glutes', 'hamstrings'], instructions: 'Take long steps and keep torso upright. [DEMO]', videoSlug: 'walking-lunge' },
    { exerciseName: 'Leg Press', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.MACHINE, bodyPart: BodyPart.LOWER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['quads', 'glutes'], instructions: 'Lower sled with control and press through heels. [DEMO]', videoSlug: 'leg-press' },
    { exerciseName: 'Calf Raise', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.MACHINE, bodyPart: BodyPart.LOWER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['calves'], instructions: 'Pause at top and bottom for full range. [DEMO]', videoSlug: 'calf-raise' },
    { exerciseName: 'Overhead Press', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BARBELL, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['shoulders', 'triceps', 'upper chest'], instructions: 'Press overhead while keeping ribcage down. [DEMO]', videoSlug: 'overhead-press' },
    { exerciseName: 'Lateral Raise', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['side delts'], instructions: 'Lift to shoulder height with slight elbow bend. [DEMO]', videoSlug: 'lateral-raise' },
    { exerciseName: 'Front Raise', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['front delts'], instructions: 'Raise dumbbells to eye level with control. [DEMO]', videoSlug: 'front-raise' },
    { exerciseName: 'Rear Delt Fly', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['rear delts', 'upper back'], instructions: 'Hinge forward and sweep arms out wide. [DEMO]', videoSlug: 'rear-delt-fly' },
    { exerciseName: 'Biceps Curl', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['biceps', 'forearms'], instructions: 'Keep elbows close and avoid swinging. [DEMO]', videoSlug: 'biceps-curl' },
    { exerciseName: 'Hammer Curl', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['biceps', 'brachialis'], instructions: 'Use neutral grip and strict tempo. [DEMO]', videoSlug: 'hammer-curl' },
    { exerciseName: 'Triceps Rope Pushdown', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.CABLE, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['triceps'], instructions: 'Keep elbows tucked and extend fully. [DEMO]', videoSlug: 'triceps-rope-pushdown' },
    { exerciseName: 'Skull Crusher', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BARBELL, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['triceps'], instructions: 'Lower bar to forehead and extend with control. [DEMO]', videoSlug: 'skull-crusher' },
    { exerciseName: 'Plank', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.CORE, type: MovementType.HOLD, muscleGroupsActivated: ['abs', 'obliques', 'lower back'], instructions: 'Squeeze glutes and keep neutral spine. [DEMO]', videoSlug: 'plank' },
    { exerciseName: 'Side Plank', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.CORE, type: MovementType.HOLD, muscleGroupsActivated: ['obliques', 'abs'], instructions: 'Stack feet and hold hips high. [DEMO]', videoSlug: 'side-plank' },
    { exerciseName: 'Dead Bug', typeOfActivity: ExerciseType.MOBILITY, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.CORE, type: MovementType.HOLD, muscleGroupsActivated: ['deep core', 'abs'], instructions: 'Press lower back into floor while moving limbs. [DEMO]', videoSlug: 'dead-bug' },
    { exerciseName: 'Mountain Climber', typeOfActivity: ExerciseType.STRENGTH_CARDIO, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.CORE, type: MovementType.PULL, muscleGroupsActivated: ['core', 'hip flexors', 'shoulders'], instructions: 'Drive knees quickly while keeping body stable. [DEMO]', videoSlug: 'mountain-climber' },
    { exerciseName: 'Burpee', typeOfActivity: ExerciseType.STRENGTH_CARDIO, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.FULL_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['full body', 'cardio system'], instructions: 'Move smoothly from squat to plank to jump. [DEMO]', videoSlug: 'burpee' },
    { exerciseName: 'Jump Rope', typeOfActivity: ExerciseType.CARDIO, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.FULL_BODY, type: MovementType.HOLD, muscleGroupsActivated: ['calves', 'shoulders', 'cardio system'], instructions: 'Keep jumps low and wrists relaxed. [DEMO]', videoSlug: 'jump-rope' },
    { exerciseName: 'Treadmill Run', typeOfActivity: ExerciseType.CARDIO, typeOfEquipment: EquipmentType.MACHINE, bodyPart: BodyPart.FULL_BODY, type: MovementType.HOLD, muscleGroupsActivated: ['legs', 'cardio system'], instructions: 'Maintain steady pace with upright posture. [DEMO]', videoSlug: 'treadmill-run' },
    { exerciseName: 'Rowing Machine', typeOfActivity: ExerciseType.CARDIO, typeOfEquipment: EquipmentType.MACHINE, bodyPart: BodyPart.FULL_BODY, type: MovementType.PULL, muscleGroupsActivated: ['back', 'legs', 'cardio system'], instructions: 'Drive with legs then finish with arms. [DEMO]', videoSlug: 'rowing-machine' },
    { exerciseName: 'Kettlebell Swing', typeOfActivity: ExerciseType.STRENGTH_CARDIO, typeOfEquipment: EquipmentType.KETTLEBELL, bodyPart: BodyPart.FULL_BODY, type: MovementType.PULL, muscleGroupsActivated: ['glutes', 'hamstrings', 'core'], instructions: 'Use hip snap, not arms, to float the bell. [DEMO]', videoSlug: 'kettlebell-swing' },
    { exerciseName: 'Thruster', typeOfActivity: ExerciseType.STRENGTH_CARDIO, typeOfEquipment: EquipmentType.DUMBBELLS, bodyPart: BodyPart.FULL_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['quads', 'shoulders', 'core'], instructions: 'Squat then press overhead in one motion. [DEMO]', videoSlug: 'thruster' },
    { exerciseName: 'Glute Bridge', typeOfActivity: ExerciseType.STRENGTH, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.LOWER_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['glutes', 'hamstrings'], instructions: 'Squeeze glutes hard at the top. [DEMO]', videoSlug: 'glute-bridge' },
    { exerciseName: 'Hip Flexor Stretch', typeOfActivity: ExerciseType.MOBILITY, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.LOWER_BODY, type: MovementType.STRETCH, muscleGroupsActivated: ['hip flexors', 'quads'], instructions: 'Tuck pelvis and lean forward gently. [DEMO]', videoSlug: 'hip-flexor-stretch' },
    { exerciseName: 'Cat Cow', typeOfActivity: ExerciseType.MOBILITY, typeOfEquipment: EquipmentType.BODYWEIGHT, bodyPart: BodyPart.CORE, type: MovementType.STRETCH, muscleGroupsActivated: ['spine', 'core'], instructions: 'Move through full spinal flexion and extension. [DEMO]', videoSlug: 'cat-cow' },
    { exerciseName: 'Band Pull Apart', typeOfActivity: ExerciseType.STRENGTH_MOBILITY, typeOfEquipment: EquipmentType.RESISTANCE_BAND, bodyPart: BodyPart.UPPER_BODY, type: MovementType.PULL, muscleGroupsActivated: ['rear delts', 'upper back'], instructions: 'Keep shoulders down and pull band to chest. [DEMO]', videoSlug: 'band-pull-apart' },
    { exerciseName: 'Medicine Ball Slam', typeOfActivity: ExerciseType.STRENGTH_CARDIO, typeOfEquipment: EquipmentType.MEDICINE_BALL, bodyPart: BodyPart.FULL_BODY, type: MovementType.PUSH, muscleGroupsActivated: ['core', 'lats', 'shoulders'], instructions: 'Reach high then slam ball forcefully. [DEMO]', videoSlug: 'medicine-ball-slam' },
  ];
}

async function cleanupDemoData(demoUserIds: string[]) {
  console.log('[seed] cleanupDemoData');

  await fitnessPrisma.workoutExercise.deleteMany({
    where: {
      OR: [
        { workout: { userId: { in: demoUserIds } } },
        { exercise: { videoUrl: { startsWith: DEMO_VIDEO_PREFIX } } },
      ],
    },
  });

  await fitnessPrisma.workout.deleteMany({ where: { userId: { in: demoUserIds } } });
  await fitnessPrisma.nutritionLog.deleteMany({ where: { userId: { in: demoUserIds } } });

  await aiPrisma.workoutPlan.deleteMany({ where: { userId: { in: demoUserIds } } });
  await aiPrisma.conversation.deleteMany({ where: { userId: { in: demoUserIds } } });

  await authPrisma.auditLog.deleteMany({
    where: {
      userId: { in: demoUserIds },
      action: {
        in: ['LOGIN', 'UPDATE_PROFILE', 'CREATE_WORKOUT_PLAN', 'LOG_NUTRITION', 'COMPLETE_WORKOUT'],
      },
    },
  });
}

async function seedExercises(summary: Summary) {
  console.log('[seed] seedExercises');
  const seeds = getExerciseSeeds();

  await fitnessPrisma.exercise.deleteMany({
    where: {
      OR: [
        { videoUrl: { startsWith: DEMO_VIDEO_PREFIX } },
        { instructions: { contains: '[DEMO]' } },
      ],
    },
  });

  for (const [index, ex] of seeds.entries()) {
    await fitnessPrisma.exercise.create({
      data: {
        exerciseName: ex.exerciseName,
        typeOfActivity: ex.typeOfActivity,
        typeOfEquipment: ex.typeOfEquipment,
        bodyPart: ex.bodyPart,
        type: ex.type,
        muscleGroupsActivated: ex.muscleGroupsActivated,
        instructions: ex.instructions,
        videoUrl: `${DEMO_VIDEO_PREFIX}${ex.videoSlug}`,
      },
    });
    if ((index + 1) % 10 === 0 || index === seeds.length - 1) {
      console.log(`[seed] exercises ${index + 1}/${seeds.length}`);
    }
  }

  summary.exercises = seeds.length;

  return fitnessPrisma.exercise.findMany({
    where: { videoUrl: { startsWith: DEMO_VIDEO_PREFIX } },
  });
}

function buildPlanJson(focuses: string[]) {
  return {
    weeks: Array.from({ length: 4 }).map((_, weekIdx) => ({
      week: weekIdx + 1,
      days: focuses.map((focus, dayIdx) => ({
        day: dayIdx + 1,
        focus,
        exercises: [
          { name: 'Warm-up', sets: 1, reps: 1, durationMinutes: 10 },
          { name: 'Main Block', sets: 3, reps: 10 },
          { name: 'Cooldown', sets: 1, reps: 1, durationMinutes: 8 },
        ],
      })),
    })),
  };
}

async function seedWorkoutPlans(users: DemoUserRecord[], summary: Summary) {
  console.log('[seed] seedWorkoutPlans');

  const getUserId = (email: string) => users.find((u) => u.email === email)?.id;

  const plans = [
    {
      userId: getUserId('demo.user1@fitassistant.local')!,
      name: 'Beginner Fat Loss 3 Days/Week',
      description: 'Low impact plan for beginner fat loss with sustainable volume.',
      goal: 'fat_loss',
      duration: 8,
      daysPerWeek: 3,
      plan: buildPlanJson(['Full Body', 'Cardio + Core', 'Lower Body + Walk']),
    },
    {
      userId: getUserId('demo.user2@fitassistant.local')!,
      name: 'Muscle Gain 4 Days/Week',
      description: 'Hypertrophy focused split with progressive overload.',
      goal: 'muscle_gain',
      duration: 10,
      daysPerWeek: 4,
      plan: buildPlanJson(['Upper Push', 'Lower Strength', 'Upper Pull', 'Lower Hypertrophy']),
    },
    {
      userId: getUserId('demo.user4@fitassistant.local')!,
      name: 'Home Workout No Equipment',
      description: 'Bodyweight focused plan for home training.',
      goal: 'fat_loss',
      duration: 6,
      daysPerWeek: 4,
      plan: buildPlanJson(['Bodyweight Circuit', 'Core and Mobility', 'Cardio Intervals', 'Full Body Light']),
    },
    {
      userId: getUserId('demo.user8@fitassistant.local')!,
      name: 'Upper Lower Split',
      description: 'Balanced upper and lower split for maintenance and strength.',
      goal: 'maintenance',
      duration: 8,
      daysPerWeek: 4,
      plan: buildPlanJson(['Upper A', 'Lower A', 'Upper B', 'Lower B']),
    },
    {
      userId: getUserId('demo.user6@fitassistant.local')!,
      name: 'Full Body Beginner',
      description: 'Foundational movements with simple progression.',
      goal: 'beginner_foundation',
      duration: 8,
      daysPerWeek: 3,
      plan: buildPlanJson(['Full Body A', 'Full Body B', 'Conditioning']),
    },
    {
      userId: getUserId('demo.pt@fitassistant.local')!,
      name: 'PT Sample Client Plan',
      description: 'Template plan a PT can adapt for mixed client goals.',
      goal: 'pt_template',
      duration: 12,
      daysPerWeek: 5,
      plan: buildPlanJson(['Client Assessment', 'Strength Base', 'Hypertrophy', 'Conditioning', 'Recovery']),
    },
  ];

  for (const plan of plans) {
    await aiPrisma.workoutPlan.create({ data: plan });
  }

  summary.workoutPlans = plans.length;
}

async function seedWorkouts(
  users: DemoUserRecord[],
  exercises: Array<{
    id: string;
    bodyPart: BodyPart;
    typeOfActivity: ExerciseType;
    type: MovementType;
    typeOfEquipment: EquipmentType;
  }>,
  summary: Summary,
) {
  console.log('[seed] seedWorkouts + workout_exercises');

  const customerUsers = users.filter((u) => u.role === Role.CUSTOMER).slice(0, 6);
  let createdWorkoutCount = 0;
  let createdWorkoutExerciseCount = 0;

  for (const user of customerUsers) {
    const workoutCount = 6 + Math.floor(seededRandom() * 7); // 6..12

    for (let w = 0; w < workoutCount; w++) {
      const focus =
        user.goal === Goal.WEIGHT_LOSS
          ? pickOne(['Fat Loss Circuit', 'Cardio + Core', 'Full Body Burn'])
          : user.goal === Goal.MUSCLE_GAIN
            ? pickOne(['Push Hypertrophy', 'Pull Hypertrophy', 'Lower Strength'])
            : pickOne(['Full Body Strength', 'Upper Lower Mix', 'Conditioning + Mobility']);

      const workout = await fitnessPrisma.workout.create({
        data: {
          userId: user.id,
          name: focus,
          description: `Demo workout for ${user.email}`,
          date: daysAgo(Math.floor(seededRandom() * 21)),
          duration: 40 + Math.floor(seededRandom() * 35),
          notes: user.goal === Goal.WEIGHT_LOSS ? 'Keep heart rate steady and rest short.' : 'Focus on technique and progression.',
        },
      });
      createdWorkoutCount += 1;

      const candidateExercises = exercises.filter((ex) => {
        if (user.goal === Goal.WEIGHT_LOSS) {
          return ex.typeOfActivity === ExerciseType.CARDIO || ex.typeOfActivity === ExerciseType.STRENGTH_CARDIO || ex.bodyPart === BodyPart.CORE;
        }
        if (user.goal === Goal.MUSCLE_GAIN) {
          return ex.typeOfActivity === ExerciseType.STRENGTH || ex.typeOfActivity === ExerciseType.STRENGTH_CARDIO;
        }
        return ex.typeOfActivity !== ExerciseType.MOBILITY;
      });

      const selectedExercises = pickManyUnique(candidateExercises, 4 + Math.floor(seededRandom() * 5)); // 4..8

      let order = 1;
      for (const exercise of selectedExercises) {
        const isCardio = exercise.typeOfActivity === ExerciseType.CARDIO || exercise.typeOfActivity === ExerciseType.STRENGTH_CARDIO;
        const isBeginner = user.experienceLevel === ExperienceLevel.BEGINNER;

        let sets = isCardio ? 2 : user.goal === Goal.MUSCLE_GAIN ? 4 : 3;
        let reps: number | null = isCardio ? null : user.goal === Goal.MUSCLE_GAIN ? 8 + Math.floor(seededRandom() * 5) : 10 + Math.floor(seededRandom() * 7);
        let duration: number | null = isCardio ? 180 + Math.floor(seededRandom() * 360) : null;

        if (exercise.type === MovementType.HOLD && !isCardio) {
          reps = null;
          duration = 30 + Math.floor(seededRandom() * 60);
          sets = 3;
        }

        let weight: number | null = null;
        if (!isCardio && exercise.typeOfEquipment !== EquipmentType.BODYWEIGHT && exercise.type !== MovementType.HOLD) {
          if (isBeginner) {
            weight = Number((5 + seededRandom() * 17).toFixed(1));
          } else if (user.goal === Goal.MUSCLE_GAIN) {
            weight = Number((18 + seededRandom() * 42).toFixed(1));
          } else {
            weight = Number((10 + seededRandom() * 25).toFixed(1));
          }
        }

        await fitnessPrisma.workoutExercise.create({
          data: {
            workoutId: workout.id,
            exerciseId: exercise.id,
            sets,
            reps,
            duration,
            weight,
            notes: isBeginner ? 'Focus on clean form and breathing.' : 'Progressive overload target.',
            order,
          },
        });

        createdWorkoutExerciseCount += 1;
        order += 1;
      }
    }
  }

  summary.workouts = createdWorkoutCount;
  summary.workoutExercises = createdWorkoutExerciseCount;
}

async function seedNutritionLogs(users: DemoUserRecord[], summary: Summary) {
  console.log('[seed] seedNutritionLogs');

  const targets = users.filter((u) => u.role === Role.CUSTOMER).slice(0, 6);
  const mealTypes = ['breakfast', 'lunch', 'dinner', 'snack'];
  const foodsByMeal: Record<string, string[]> = {
    breakfast: ['Oatmeal with berries', 'Egg white omelette', 'Greek yogurt bowl', 'Avocado toast'],
    lunch: ['Grilled chicken rice bowl', 'Salmon quinoa salad', 'Beef stir fry with vegetables', 'Turkey sandwich'],
    dinner: ['Baked fish and sweet potato', 'Lean beef with brown rice', 'Tofu vegetable stir fry', 'Chicken pasta'],
    snack: ['Protein shake', 'Banana with peanut butter', 'Mixed nuts', 'Cottage cheese'],
  };

  let created = 0;

  for (const user of targets) {
    const daySpan = 10 + Math.floor(seededRandom() * 5); // 10..14

    for (let day = 0; day < daySpan; day++) {
      const currentDate = daysAgo(day);
      const logsPerDay = 3 + Math.floor(seededRandom() * 3); // 3..5
      const selectedMeals = pickManyUnique(mealTypes, Math.min(logsPerDay, mealTypes.length));

      for (const mealType of selectedMeals) {
        const foodName = pickOne(foodsByMeal[mealType]);

        const baseCalories =
          user.goal === Goal.WEIGHT_LOSS
            ? mealType === 'snack'
              ? 140
              : 420
            : user.goal === Goal.MUSCLE_GAIN
              ? mealType === 'snack'
                ? 260
                : 620
              : mealType === 'snack'
                ? 190
                : 500;

        const calories = Math.max(100, Math.round(baseCalories + (seededRandom() * 80 - 40)));
        const protein = user.goal === Goal.MUSCLE_GAIN ? Number((25 + seededRandom() * 20).toFixed(1)) : Number((16 + seededRandom() * 15).toFixed(1));
        const carbs = user.goal === Goal.WEIGHT_LOSS ? Number((20 + seededRandom() * 35).toFixed(1)) : Number((35 + seededRandom() * 50).toFixed(1));
        const fats = Number((8 + seededRandom() * 18).toFixed(1));

        await fitnessPrisma.nutritionLog.create({
          data: {
            userId: user.id,
            date: currentDate,
            mealType,
            foodName,
            calories,
            protein,
            carbs,
            fats,
            notes:
              user.goal === Goal.WEIGHT_LOSS
                ? 'Kept portions moderate for calorie control.'
                : user.goal === Goal.MUSCLE_GAIN
                  ? 'Prioritized protein and total calories for growth.'
                  : 'Balanced macro meal for maintenance.',
          },
        });
        created += 1;
      }
    }
  }

  summary.nutritionLogs = created;
}

async function seedConversations(users: DemoUserRecord[], summary: Summary) {
  console.log('[seed] seedConversations');

  const customerUsers = users.filter((u) => u.role === Role.CUSTOMER);
  const prompts = [
    {
      question: 'How can I lose fat without losing muscle?',
      answer: 'Use a moderate calorie deficit, keep protein high, and continue resistance training 3-4 days per week.',
      relevance: 'HIGH',
      relevanceExplanation: 'Matches user fat loss goal and provides actionable steps.',
    },
    {
      question: 'Can you suggest a simple meal plan for fat loss?',
      answer: 'Build each meal around lean protein, vegetables, and controlled carbs. Track calories for 2 weeks and adjust slowly.',
      relevance: 'HIGH',
      relevanceExplanation: 'Nutrition advice aligned to fat loss and adherence.',
    },
    {
      question: 'What is a good upper body workout for beginners?',
      answer: 'Try push-up progressions, dumbbell rows, shoulder press, and planks. Focus on form and gradual progression.',
      relevance: 'HIGH',
      relevanceExplanation: 'Beginner-friendly upper body session with progression focus.',
    },
    {
      question: 'I only have dumbbells at home. What should I train?',
      answer: 'Use a full-body split: goblet squat, dumbbell row, Romanian deadlift, floor press, overhead press, and core finisher.',
      relevance: 'HIGH',
      relevanceExplanation: 'Home equipment constraints addressed with practical exercise list.',
    },
    {
      question: 'How many days should a beginner train each week?',
      answer: 'Start with 3 days per week full body. Keep at least one rest day between hard sessions.',
      relevance: 'HIGH',
      relevanceExplanation: 'Clear beginner recommendation that supports recovery.',
    },
  ];

  const rows = customerUsers.flatMap((user, idx) => {
    return prompts.map((item, promptIdx) => {
      const promptTokens = 110 + Math.floor(seededRandom() * 70);
      const completionTokens = 160 + Math.floor(seededRandom() * 90);
      const totalTokens = promptTokens + completionTokens;

      return {
        userId: user.id,
        question: item.question,
        answer: item.answer,
        modelUsed: 'llama3.2:3b',
        responseTime: Number((1.1 + seededRandom() * 2.7).toFixed(2)),
        relevance: item.relevance,
        relevanceExplanation: item.relevanceExplanation,
        promptTokens,
        completionTokens,
        totalTokens,
        cost: Number((totalTokens * 0.000001).toFixed(6)),
        createdAt: daysAgo((idx + promptIdx) % 10),
      };
    });
  });

  await aiPrisma.conversation.createMany({ data: rows });
  summary.conversations = rows.length;
}

async function seedAuditLogs(users: DemoUserRecord[], summary: Summary) {
  console.log('[seed] seedAuditLogs');

  const actions = ['LOGIN', 'UPDATE_PROFILE', 'CREATE_WORKOUT_PLAN', 'LOG_NUTRITION', 'COMPLETE_WORKOUT'];

  const rows = users
    .filter((u) => u.role !== Role.ADMIN)
    .flatMap((u) =>
      actions.map((action, idx) => ({
        userId: u.id,
        action,
        ipAddress: '127.0.0.1',
        userAgent: 'seed-demo-script',
        metadata: {
          source: 'demo-seed-v1',
          email: u.email,
          note: 'generated for demo dashboard',
          step: idx + 1,
        },
        createdAt: daysAgo(Math.floor(seededRandom() * 14)),
      })),
    );

  await authPrisma.auditLog.createMany({ data: rows });
  summary.auditLogs = rows.length;
}

async function main() {
  const summary: Summary = {
    users: 0,
    profiles: 0,
    exercises: 0,
    workouts: 0,
    workoutExercises: 0,
    workoutPlans: 0,
    nutritionLogs: 0,
    conversations: 0,
    auditLogs: 0,
  };

  try {
    const databaseUrl = ensureEnvironment();
    authPrisma = new AuthPrismaClient({ datasources: { db: { url: databaseUrl } } });
    userPrisma = new UserPrismaClient({ datasources: { db: { url: databaseUrl } } });
    fitnessPrisma = new FitnessPrismaClient({ datasources: { db: { url: databaseUrl } } });
    aiPrisma = new AiPrismaClient({ datasources: { db: { url: databaseUrl } } });

    const demoUsers = await createDemoUsers(summary);
    const demoUserIds = demoUsers.map((u) => u.id);

    await createDemoProfiles(demoUsers, summary);
    await cleanupDemoData(demoUserIds);

    const demoExercises = await seedExercises(summary);
    await seedWorkoutPlans(demoUsers, summary);
    await seedWorkouts(demoUsers, demoExercises, summary);
    await seedNutritionLogs(demoUsers, summary);
    await seedConversations(demoUsers, summary);
    await seedAuditLogs(demoUsers, summary);

    console.log('');
    console.log('===== DEMO SEED SUMMARY =====');
    console.log(`users created: ${summary.users}`);
    console.log(`profiles created: ${summary.profiles}`);
    console.log(`exercises created: ${summary.exercises}`);
    console.log(`workouts created: ${summary.workouts}`);
    console.log(`workout_exercises created: ${summary.workoutExercises}`);
    console.log(`workout_plans created: ${summary.workoutPlans}`);
    console.log(`nutrition_logs created: ${summary.nutritionLogs}`);
    console.log(`conversations created: ${summary.conversations}`);
    console.log(`audit_logs created: ${summary.auditLogs}`);
    console.log('=============================');
    console.log(`Demo password for all demo accounts: ${DEMO_PASSWORD}`);
  } catch (error: any) {
    console.error(`[seed] Failed: ${error?.message || error}`);
    process.exitCode = 1;
  } finally {
    await Promise.all([
      authPrisma?.$disconnect(),
      userPrisma?.$disconnect(),
      fitnessPrisma?.$disconnect(),
      aiPrisma?.$disconnect(),
    ]);
  }
}

main();
