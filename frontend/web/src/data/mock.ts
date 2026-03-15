import type { User, InBodyEntry, WorkoutLog, WorkoutPlanDay, MealPlanDay, Message } from '../types';

// ─── User ──────────────────────────────────────────────────────────────────────
export const mockUser: User = {
  id: 'demo-user-1',
  email: 'alex.nguyen@example.com',
  firstName: 'Alex',
  lastName: 'Nguyen',
  role: 'USER',
  bio: 'Fitness enthusiast | Strength training 4×/week | Goal: Lean muscle gain',
  height: 175,
  weight: 75.5,
  age: 28,
  goal: 'muscle_gain',
  fitnessLevel: 'intermediate',
};

// ─── InBody history ────────────────────────────────────────────────────────────
export const mockInBodyHistory: InBodyEntry[] = [
  { id: '1', date: '2026-03-10', weight: 75.5, bodyFat: 16.8, muscleMass: 58.2, bmi: 24.7, bmr: 1820, visceralFat: 6, notes: 'Morning, fasted' },
  { id: '2', date: '2026-02-24', weight: 76.2, bodyFat: 17.5, muscleMass: 57.8, bmi: 24.9, bmr: 1810, visceralFat: 7 },
  { id: '3', date: '2026-02-10', weight: 77.0, bodyFat: 18.2, muscleMass: 57.1, bmi: 25.2, bmr: 1800, visceralFat: 7 },
  { id: '4', date: '2026-01-27', weight: 77.8, bodyFat: 19.1, muscleMass: 56.5, bmi: 25.4, bmr: 1795, visceralFat: 8 },
  { id: '5', date: '2026-01-13', weight: 78.5, bodyFat: 20.0, muscleMass: 55.8, bmi: 25.7, bmr: 1780, visceralFat: 8 },
];

// ─── Workout logs ──────────────────────────────────────────────────────────────
export const mockWorkouts: WorkoutLog[] = [
  {
    id: 'w1', name: 'Upper Power A', date: '2026-03-10', duration: 75, notes: 'New bench PR 🎉',
    exercises: [
      { id: 'e1', exerciseName: 'Bench Press',      sets: [{ reps: 5, weight: 90, rpe: 8 }, { reps: 5, weight: 90, rpe: 8.5 }, { reps: 4, weight: 90, rpe: 9 }] },
      { id: 'e2', exerciseName: 'Barbell Row',       sets: [{ reps: 5, weight: 80, rpe: 7 }, { reps: 5, weight: 80, rpe: 7.5 }, { reps: 5, weight: 80, rpe: 8 }] },
      { id: 'e3', exerciseName: 'Overhead Press',    sets: [{ reps: 8, weight: 55, rpe: 7 }, { reps: 8, weight: 55, rpe: 7.5 }, { reps: 7, weight: 55, rpe: 8.5 }] },
      { id: 'e4', exerciseName: 'Dips',              sets: [{ reps: 12, weight: 0, rpe: 7 }, { reps: 10, weight: 0, rpe: 8 }, { reps: 9, weight: 0, rpe: 8.5 }] },
    ],
  },
  {
    id: 'w2', name: 'Lower Power', date: '2026-03-08', duration: 90, notes: 'Squat felt strong',
    exercises: [
      { id: 'e5', exerciseName: 'Back Squat',        sets: [{ reps: 5, weight: 120, rpe: 8 }, { reps: 5, weight: 120, rpe: 8.5 }, { reps: 4, weight: 120, rpe: 9 }] },
      { id: 'e6', exerciseName: 'Romanian Deadlift', sets: [{ reps: 8, weight: 90, rpe: 7 }, { reps: 8, weight: 90, rpe: 7.5 }, { reps: 8, weight: 90, rpe: 8 }] },
      { id: 'e7', exerciseName: 'Leg Press',         sets: [{ reps: 12, weight: 140, rpe: 7 }, { reps: 12, weight: 140, rpe: 7.5 }, { reps: 10, weight: 140, rpe: 8 }] },
    ],
  },
  {
    id: 'w3', name: 'Upper Hypertrophy', date: '2026-03-07', duration: 65,
    exercises: [
      { id: 'e8',  exerciseName: 'Incline DB Press', sets: [{ reps: 10, weight: 32, rpe: 8 }, { reps: 10, weight: 32, rpe: 8 }, { reps: 9, weight: 32, rpe: 9 }, { reps: 8, weight: 32, rpe: 9 }] },
      { id: 'e9',  exerciseName: 'Pull-ups',         sets: [{ reps: 10, weight: 0, rpe: 8 }, { reps: 9, weight: 0, rpe: 8.5 }, { reps: 8, weight: 0, rpe: 9 }] },
      { id: 'e10', exerciseName: 'Cable Fly',        sets: [{ reps: 15, weight: 12, rpe: 7 }, { reps: 15, weight: 12, rpe: 7.5 }, { reps: 12, weight: 12, rpe: 8 }] },
    ],
  },
  {
    id: 'w4', name: 'Lower Hypertrophy', date: '2026-03-05', duration: 70,
    exercises: [
      { id: 'e11', exerciseName: 'Front Squat',    sets: [{ reps: 10, weight: 80, rpe: 7 }, { reps: 10, weight: 80, rpe: 7.5 }, { reps: 10, weight: 80, rpe: 8 }] },
      { id: 'e12', exerciseName: 'Walking Lunges', sets: [{ reps: 12, weight: 30, rpe: 7 }, { reps: 12, weight: 30, rpe: 7.5 }, { reps: 10, weight: 30, rpe: 8 }] },
      { id: 'e13', exerciseName: 'Leg Curl',       sets: [{ reps: 15, weight: 40, rpe: 7 }, { reps: 15, weight: 40, rpe: 7.5 }, { reps: 12, weight: 40, rpe: 8 }] },
    ],
  },
];

// ─── Workout plan (weekly) ─────────────────────────────────────────────────────
export const mockWorkoutPlan: WorkoutPlanDay[] = [
  {
    day: 'Monday', label: 'Mon', focus: 'Upper Power', isRest: false,
    exercises: [
      { name: 'Bench Press',    sets: 4, reps: '3-5', rest: '3-5 min' },
      { name: 'Barbell Row',    sets: 4, reps: '3-5', rest: '3-5 min' },
      { name: 'Overhead Press', sets: 3, reps: '5-8', rest: '2-3 min' },
      { name: 'Pull-ups',       sets: 3, reps: '6-10', rest: '2 min' },
      { name: 'Dips',           sets: 3, reps: '8-12', rest: '90 sec' },
    ],
  },
  {
    day: 'Tuesday', label: 'Tue', focus: 'Lower Power', isRest: false,
    exercises: [
      { name: 'Back Squat',        sets: 4, reps: '3-5',   rest: '3-5 min' },
      { name: 'Romanian Deadlift', sets: 3, reps: '5-8',   rest: '3 min' },
      { name: 'Leg Press',         sets: 3, reps: '8-12',  rest: '2 min' },
      { name: 'Leg Curl',          sets: 3, reps: '10-15', rest: '90 sec' },
      { name: 'Calf Raises',       sets: 4, reps: '15-20', rest: '60 sec' },
    ],
  },
  { day: 'Wednesday', label: 'Wed', focus: 'Rest / Active Recovery', isRest: true, exercises: [] },
  {
    day: 'Thursday', label: 'Thu', focus: 'Upper Hypertrophy', isRest: false,
    exercises: [
      { name: 'Incline DB Press',      sets: 4, reps: '8-12',  rest: '2 min' },
      { name: 'Lat Pulldown',          sets: 4, reps: '8-12',  rest: '2 min' },
      { name: 'Cable Fly',             sets: 3, reps: '12-15', rest: '90 sec' },
      { name: 'Face Pulls',            sets: 3, reps: '15-20', rest: '60 sec' },
      { name: 'Bicep Curl',            sets: 3, reps: '12-15', rest: '60 sec' },
    ],
  },
  {
    day: 'Friday', label: 'Fri', focus: 'Lower Hypertrophy', isRest: false,
    exercises: [
      { name: 'Hack Squat',      sets: 4, reps: '8-12',  rest: '2 min' },
      { name: 'Leg Curl',        sets: 4, reps: '10-15', rest: '90 sec' },
      { name: 'Walking Lunges',  sets: 3, reps: '12/leg', rest: '90 sec' },
      { name: 'Calf Raises',     sets: 4, reps: '15-20', rest: '60 sec' },
    ],
  },
  {
    day: 'Saturday', label: 'Sat', focus: 'Full Body / Weak Points', isRest: false,
    exercises: [
      { name: 'Deadlift',              sets: 4, reps: '3-5',   rest: '4 min' },
      { name: 'Chest-supported Row',   sets: 3, reps: '10-12', rest: '2 min' },
      { name: 'Lateral Raises',        sets: 4, reps: '15-20', rest: '45 sec' },
      { name: 'Tricep Pushdown',       sets: 3, reps: '12-15', rest: '60 sec' },
    ],
  },
  { day: 'Sunday', label: 'Sun', focus: 'Rest & Recovery', isRest: true, exercises: [] },
];

// ─── Meal plan (weekly) ────────────────────────────────────────────────────────
export const mockMealPlan: MealPlanDay[] = [
  {
    day: 'Monday', label: 'Mon', totalCalories: 2800, totalProtein: 175,
    meals: [
      { mealType: 'breakfast', name: 'High-Protein Oats + Whey',     calories: 520, protein: 40, carbs: 65, fats: 12 },
      { mealType: 'lunch',     name: 'Chicken Rice Bowl',            calories: 750, protein: 52, carbs: 80, fats: 15 },
      { mealType: 'snack',     name: 'Greek Yogurt + Banana',        calories: 350, protein: 20, carbs: 45, fats: 5  },
      { mealType: 'dinner',    name: 'Salmon + Quinoa + Vegetables', calories: 780, protein: 55, carbs: 65, fats: 22 },
      { mealType: 'snack',     name: 'Casein Shake + Peanut Butter', calories: 400, protein: 35, carbs: 20, fats: 15 },
    ],
  },
  {
    day: 'Tuesday', label: 'Tue', totalCalories: 2750, totalProtein: 170,
    meals: [
      { mealType: 'breakfast', name: 'Egg White Omelette + Toast', calories: 480, protein: 38, carbs: 50, fats: 10 },
      { mealType: 'lunch',     name: 'Tuna Pasta',                 calories: 720, protein: 50, carbs: 85, fats: 12 },
      { mealType: 'snack',     name: 'Protein Bar',                calories: 280, protein: 20, carbs: 28, fats: 8  },
      { mealType: 'dinner',    name: 'Beef Stir Fry + Brown Rice', calories: 820, protein: 55, carbs: 70, fats: 25 },
      { mealType: 'snack',     name: 'Cottage Cheese + Berries',   calories: 350, protein: 30, carbs: 35, fats: 5  },
    ],
  },
  {
    day: 'Wednesday', label: 'Wed', totalCalories: 2600, totalProtein: 160,
    meals: [
      { mealType: 'breakfast', name: 'Smoothie Bowl',                  calories: 450, protein: 30, carbs: 60, fats: 10 },
      { mealType: 'lunch',     name: 'Turkey Wrap',                    calories: 650, protein: 45, carbs: 55, fats: 18 },
      { mealType: 'snack',     name: 'Apple + Peanut Butter',          calories: 300, protein: 10, carbs: 40, fats: 12 },
      { mealType: 'dinner',    name: 'Grilled Chicken + Sweet Potato', calories: 750, protein: 55, carbs: 75, fats: 12 },
      { mealType: 'snack',     name: 'Casein Shake',                   calories: 300, protein: 25, carbs: 15, fats: 8  },
    ],
  },
  {
    day: 'Thursday', label: 'Thu', totalCalories: 2800, totalProtein: 175,
    meals: [
      { mealType: 'breakfast', name: 'High-Protein Oats',         calories: 520, protein: 40, carbs: 65, fats: 12 },
      { mealType: 'lunch',     name: 'Shrimp Fried Rice',         calories: 700, protein: 42, carbs: 85, fats: 18 },
      { mealType: 'snack',     name: 'Greek Yogurt + Granola',    calories: 380, protein: 22, carbs: 50, fats: 8  },
      { mealType: 'dinner',    name: 'Pork Tenderloin + Veggies', calories: 750, protein: 58, carbs: 40, fats: 22 },
      { mealType: 'snack',     name: 'Protein Shake',             calories: 320, protein: 30, carbs: 20, fats: 6  },
    ],
  },
  {
    day: 'Friday', label: 'Fri', totalCalories: 2900, totalProtein: 180,
    meals: [
      { mealType: 'breakfast', name: 'Full Egg Omelette',          calories: 580, protein: 42, carbs: 55, fats: 22 },
      { mealType: 'lunch',     name: 'Chicken Quinoa Bowl',        calories: 780, protein: 55, carbs: 75, fats: 18 },
      { mealType: 'snack',     name: 'Nuts + Protein Bar',         calories: 400, protein: 22, carbs: 30, fats: 20 },
      { mealType: 'dinner',    name: 'Salmon Steak + Asparagus',   calories: 820, protein: 58, carbs: 30, fats: 30 },
      { mealType: 'snack',     name: 'Casein Shake',               calories: 320, protein: 28, carbs: 18, fats: 6  },
    ],
  },
  {
    day: 'Saturday', label: 'Sat', totalCalories: 3000, totalProtein: 175,
    meals: [
      { mealType: 'breakfast', name: 'Pancakes + Eggs',      calories: 680, protein: 42, carbs: 90, fats: 15 },
      { mealType: 'lunch',     name: 'Beef Bowl',            calories: 850, protein: 60, carbs: 80, fats: 25 },
      { mealType: 'snack',     name: 'Fruit + Whey Shake',   calories: 380, protein: 25, carbs: 45, fats: 5  },
      { mealType: 'dinner',    name: 'BBQ Chicken + Corn',   calories: 820, protein: 58, carbs: 65, fats: 20 },
      { mealType: 'snack',     name: 'Ice Cream (small)',    calories: 280, protein: 5,  carbs: 40, fats: 12 },
    ],
  },
  {
    day: 'Sunday', label: 'Sun', totalCalories: 2500, totalProtein: 155,
    meals: [
      { mealType: 'breakfast', name: 'Avocado Toast + Eggs',        calories: 550, protein: 28, carbs: 50, fats: 25 },
      { mealType: 'lunch',     name: 'Pasta + Meatballs',           calories: 720, protein: 45, carbs: 85, fats: 18 },
      { mealType: 'snack',     name: 'Mixed Fruits',                calories: 200, protein: 3,  carbs: 45, fats: 2  },
      { mealType: 'dinner',    name: 'Roast Chicken + Green Salad', calories: 680, protein: 58, carbs: 25, fats: 22 },
      { mealType: 'snack',     name: 'Casein + Milk',               calories: 280, protein: 25, carbs: 25, fats: 6  },
    ],
  },
];

// ─── Coach messages ────────────────────────────────────────────────────────────
export const mockMessages: Message[] = [
  {
    id: 'm1',
    role: 'assistant',
    content: "👋 Hey Alex! I'm your AI Gym Coach. I've reviewed your training data from the past month — you've been crushing it with 4 sessions per week! Your strength is up and body fat is trending down. What would you like to work on today?",
    timestamp: new Date(Date.now() - 60000 * 5),
  },
  {
    id: 'm2',
    role: 'user',
    content: "How's my progress compared to last month?",
    timestamp: new Date(Date.now() - 60000 * 4),
  },
  {
    id: 'm3',
    role: 'assistant',
    content: "📊 **30-Day Progress Summary:**\n\n**Body Composition**\n• Weight: 78.5 → 75.5 kg (↓ 3.0 kg)\n• Body Fat: 20.0% → 16.8% (↓ 3.2%)\n• Muscle Mass: 55.8 → 58.2 kg (↑ 2.4 kg)\n\n**Strength Gains**\n• Bench Press: 82.5 → 90 kg (+7.5 kg)\n• Back Squat: 107.5 → 120 kg (+12.5 kg)\n• Romanian DL: 75 → 90 kg (+15 kg)\n\nYou're achieving textbook body recomposition! Keep the current split and stay in a slight caloric surplus on training days. 💪",
    timestamp: new Date(Date.now() - 60000 * 3),
  },
];

export const suggestionChips = [
  "Analyze my progress this week",
  "Suggest workout for tomorrow",
  "Optimize my meal plan",
  "What's my estimated 1RM?",
  "Tips for faster recovery",
  "Generate a deload week plan",
];
