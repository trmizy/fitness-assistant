import { logger } from "@gym-coach/shared";
import {
  ESignProvider,
  ESignSendRequest,
  ESignSendResult,
} from "../types/esign.types";

export class MockESignProvider implements ESignProvider {
  async send(req: ESignSendRequest): Promise<ESignSendResult> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    logger.info({
      msg: "MockESign would send",
      signerCount: req.signers.length,
      contractId: req.contractId,
    });
    return {
      requestId: `mock_${Date.now()}`,
      provider: "mock",
      testMode: true,
    };
  }
}
