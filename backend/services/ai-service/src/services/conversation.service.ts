import { conversationRepository } from '../repositories/conversation.repository';
import { llmService } from './llm.service';
import { aiQueue } from '../workers/ai.worker';

export const conversationService = {
  async getConversations(userId?: string, limit = 10) {
    const where: any = {};
    if (userId) where.userId = userId;
    const conversations = await conversationRepository.findMany(where, limit);
    return { conversations };
  },

  async submitFeedback(conversationId: string, feedback: number) {
    if (!conversationId || ![1, -1].includes(feedback)) {
      throw { status: 400, message: 'Invalid input' };
    }
    await conversationRepository.updateFeedback(conversationId, feedback);
    return { message: 'Feedback received' };
  },

  async getFeedbackStats() {
    const total = await conversationRepository.count();
    const thumbsUp = await conversationRepository.count({ feedback: 1 });
    const thumbsDown = await conversationRepository.count({ feedback: -1 });
    return {
      total_conversations: total,
      thumbs_up: thumbsUp,
      thumbs_down: thumbsDown,
      satisfaction_rate:
        total > 0 ? ((thumbsUp / total) * 100).toFixed(1) : '0',
    };
  },

  async generateWorkout(params: {
    goal?: string;
    duration?: number;
    equipment?: string[];
    bodyParts?: string[];
  }) {
    const { goal, duration, equipment, bodyParts } = params;
    const prompt = `
Generate a workout plan with the following requirements:
- Goal: ${goal || 'general fitness'}
- Duration: ${duration || 60} minutes
- Available equipment: ${equipment?.join(', ') || 'bodyweight'}
- Body parts to target: ${bodyParts?.join(', ') || 'full body'}

Return a JSON array of exercises with this format:
[
  {
    "exerciseId": "uuid",
    "sets": 3,
    "reps": 10,
    "duration": null,
    "weight": null
  }
]
`.trim();

    const llmResponse = await llmService.callLLM(prompt);

    let exercises: any[] = [];
    try {
      const jsonMatch = llmResponse.answer.match(/\[[\s\S]*\]/);
      if (jsonMatch) exercises = JSON.parse(jsonMatch[0]);
    } catch {
      // use empty exercises fallback
    }

    return {
      name: `${goal || 'General'} Workout`,
      description: `AI-generated workout for ${goal || 'general fitness'}`,
      duration: duration || 60,
      exercises,
    };
  },

  async queuePlanGeneration(params: {
    userId?: string;
    goal?: string;
    durationWeeks?: number;
    daysPerWeek?: number;
  }) {
    const job = await aiQueue.add('generate-plan', params);
    return { message: 'Workout plan generation started', jobId: job.id };
  },
};
