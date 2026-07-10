import {
  ESignProvider,
  ESignSendRequest,
  ESignSendResult,
} from "../types/esign.types";

export class MockESignProvider implements ESignProvider {
  async send(req: ESignSendRequest): Promise<ESignSendResult> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log(
      `[MockESign] Would send to ${req.signers.length} signers for contract ${req.contractId}`,
    );
    return {
      requestId: `mock_${Date.now()}`,
      provider: "mock",
      testMode: true,
    };
  }
}
