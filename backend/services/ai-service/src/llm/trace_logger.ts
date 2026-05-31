import { logger } from '@gym-coach/shared';

function makeTraceId(): string {
  return `ai_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface TraceContext {
  traceId: string;
  startedAt: number;
}

export const traceLogger = {
  start(question: string, userId?: string): TraceContext {
    const context: TraceContext = {
      traceId: makeTraceId(),
      startedAt: Date.now(),
    };

    logger.info(
      {
        traceId: context.traceId,
        userId,
        questionLength: question.length,
      },
      'LLM orchestration started',
    );

    return context;
  },

  end(context: TraceContext, extra: Record<string, unknown>): void {
    logger.info(
      {
        traceId: context.traceId,
        durationMs: Date.now() - context.startedAt,
        ...extra,
      },
      'LLM orchestration finished',
    );
  },
};
