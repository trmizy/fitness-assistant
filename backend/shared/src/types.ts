export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: 'CUSTOMER' | 'PT' | 'ADMIN';
}

export interface AuthRequest {
  user?: User;
}

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';
export type Goal = 'WEIGHT_LOSS' | 'MUSCLE_GAIN' | 'MAINTENANCE' | 'ATHLETIC_PERFORMANCE';
export type ActivityLevel = 'SEDENTARY' | 'LIGHTLY_ACTIVE' | 'MODERATELY_ACTIVE' | 'VERY_ACTIVE' | 'EXTREMELY_ACTIVE';
export type ExperienceLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
