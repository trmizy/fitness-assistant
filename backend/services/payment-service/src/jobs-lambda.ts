import { logger } from "@gym-coach/shared";
import {
  ensureDatabaseUrlConfigured,
  validateRequiredRuntimeConfig,
} from "./config/lambda-runtime";

export type PaymentServiceJobName = "reconciliation";

export interface PaymentServiceJobEvent {
  job?: PaymentServiceJobName | string;
}

export async function runPaymentServiceJob(event: PaymentServiceJobEvent) {
  switch (event.job) {
    case "reconciliation": {
      const { runReconciliation } = await import("./services/reconciliation.service");
      await runReconciliation();
      return { status: "ok" };
    }
    default:
      throw Object.assign(new Error(`Unknown payment-service job: ${event.job ?? ""}`), {
        statusCode: 400,
      });
  }
}

export async function handler(event: PaymentServiceJobEvent = {}) {
  try {
    await ensureDatabaseUrlConfigured();
    validateRequiredRuntimeConfig();
    const result = await runPaymentServiceJob(event);
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: "ok",
        service: "payment-service",
        job: event.job,
        result,
      }),
    };
  } catch (error: any) {
    const statusCode = error?.statusCode || 500;
    logger.error(
      { job: event.job, statusCode, message: error?.message },
      "Payment Service jobs Lambda failed",
    );
    return {
      statusCode,
      body: JSON.stringify({
        status: "error",
        service: "payment-service",
        job: event.job,
        error: statusCode === 400 ? error.message : "Internal server error",
      }),
    };
  }
}
