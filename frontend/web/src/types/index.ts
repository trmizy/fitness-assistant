export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role?: string;
  bio?: string;
  height?: number;
  weight?: number;
  age?: number;
  goal?: string;
  fitnessLevel?: 'beginner' | 'intermediate' | 'advanced';
}

export interface InBodyEntry {
  id: string;
  date: string;
  weight: number;
  bodyFat: number;
  muscleMass: number;
  bmi: number;
  bmr: number;
  visceralFat?: number;
  notes?: string;
}

export interface SetLog {
  reps: number;
  weight: number;
  rpe?: number;
}

export interface ExerciseLog {
  id: string;
  exerciseName: string;
  sets: SetLog[];
}

export interface WorkoutLog {
  id: string;
  name: string;
  date: string;
  duration: number;
  notes?: string;
  exercises: ExerciseLog[];
}

export interface WorkoutPlanExercise {
  name: string;
  sets: number;
  reps: string;
  rest: string;
  notes?: string;
}

export interface WorkoutPlanDay {
  day: string;
  label: string;
  focus: string;
  isRest: boolean;
  exercises: WorkoutPlanExercise[];
}

export interface MealItem {
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
}

export interface MealPlanDay {
  day: string;
  label: string;
  totalCalories: number;
  totalProtein: number;
  meals: MealItem[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}
