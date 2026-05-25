import * as DropboxSign from '@dropbox/sign';
import fs from 'fs';
import { ESignProvider, ESignSendRequest, ESignSendResult } from '../types/esign.types';

export class DropboxSignProvider implements ESignProvider {
  private api: DropboxSign.SignatureRequestApi;

  constructor() {
    if (!process.env.DROPBOX_SIGN_API_KEY) {
      throw new Error('DROPBOX_SIGN_API_KEY is required for DropboxSignProvider');
    }
    this.api = new DropboxSign.SignatureRequestApi();
    this.api.username = process.env.DROPBOX_SIGN_API_KEY;
  }

  async send(req: ESignSendRequest): Promise<ESignSendResult> {
    const response = await this.api.signatureRequestSend({
      testMode: req.testMode,
      title: req.title,
      subject: req.subject,
      message: req.message,
      signers: req.signers.map((s, i) => ({
        name: s.name,
        emailAddress: s.email,
        order: i,
      })),
      files: [fs.createReadStream(req.pdfPath)],
    });

    const signatureRequestId = response.body.signatureRequest?.signatureRequestId;
    if (!signatureRequestId) {
      throw new Error('Dropbox Sign did not return a signatureRequestId');
    }

    return {
      requestId: signatureRequestId,
      provider: 'dropbox_sign',
      testMode: req.testMode,
    };
  }
}
