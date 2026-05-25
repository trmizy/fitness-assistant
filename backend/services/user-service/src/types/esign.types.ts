export interface ESignSendRequest {
  contractId: string;
  testMode: boolean;
  signers: { email: string; name: string; role: 'client' | 'pt' }[];
  pdfPath: string;
  title: string;
  subject: string;
  message: string;
}

export interface ESignSendResult {
  requestId: string;
  provider: string;
  testMode: boolean;
}

export interface ESignProvider {
  send(req: ESignSendRequest): Promise<ESignSendResult>;
}
