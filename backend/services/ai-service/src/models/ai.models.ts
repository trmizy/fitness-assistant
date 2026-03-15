export interface SearchResult {
  exerciseName: string;
  typeOfActivity: string;
  typeOfEquipment: string;
  bodyPart: string;
  type: string;
  muscleGroupsActivated: string;
  instructions: string;
  score: number;
}

export interface LLMResponse {
  answer: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface RelevanceEval {
  Relevance: 'NON_RELEVANT' | 'PARTLY_RELEVANT' | 'RELEVANT' | 'UNKNOWN';
  Explanation: string;
}
