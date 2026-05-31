export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'LLM_UNAVAILABLE'
  | 'LLM_GENERATION_FAILED'
  | 'PLAN_NOT_FOUND'
  | 'PLAN_NOT_COMPLETED'
  | 'PLAN_GENERATION_FAILED'
  | 'RETRIEVAL_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly statusCode: number;

  constructor(code: ApiErrorCode, message: string, statusCode: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

/** Thrown when the LLM provider fails to respond */
export class LlmError extends ApiError {
  constructor(message: string, public readonly cause?: Error) {
    super('LLM_UNAVAILABLE', message, 503);
    this.name = 'LlmError';
    Object.setPrototypeOf(this, LlmError.prototype);
  }
}

/** Thrown when LLM returns unparseable structured output */
export class LlmGenerationError extends ApiError {
  constructor(message: string) {
    super('LLM_GENERATION_FAILED', message, 500);
    this.name = 'LlmGenerationError';
    Object.setPrototypeOf(this, LlmGenerationError.prototype);
  }
}

export function formatErrorResponse(code: ApiErrorCode, message: string) {
  return { success: false, error: { code, message } };
}

export function formatSuccessResponse<T>(data: T) {
  return { success: true, data };
}
