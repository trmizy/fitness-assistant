import * as DropboxSign from "@dropbox/sign";
import fs from "fs";
import path from "path";
import {
  ESignProvider,
  ESignSendRequest,
  ESignSendResult,
} from "../types/esign.types";

export class DropboxSignProvider implements ESignProvider {
  private api: DropboxSign.SignatureRequestApi;

  constructor() {
    if (!process.env.DROPBOX_SIGN_API_KEY) {
      throw new Error(
        "DROPBOX_SIGN_API_KEY is required for DropboxSignProvider",
      );
    }
    this.api = new DropboxSign.SignatureRequestApi();
    this.api.username = process.env.DROPBOX_SIGN_API_KEY;
  }

  async send(req: ESignSendRequest): Promise<ESignSendResult> {
    const absPath = path.isAbsolute(req.pdfPath)
      ? req.pdfPath
      : path.join(process.cwd(), req.pdfPath);

    // In test mode, Dropbox Sign only allows sending to the account owner's email.
    // Set DROPBOX_SIGN_TEST_SIGNER_EMAIL to override all signer addresses (use your
    // Dropbox Sign account email so you can sign both requests from one inbox).
    const testOverrideEmail = req.testMode
      ? process.env.DROPBOX_SIGN_TEST_SIGNER_EMAIL
      : undefined;

    const response = await this.api.signatureRequestSend({
      testMode: req.testMode,
      title: req.title,
      subject: req.subject,
      message: req.message,
      signers: req.signers.map((s, i) => ({
        name: s.name,
        emailAddress: testOverrideEmail ?? s.email,
        order: i,
      })),
      files: [fs.createReadStream(absPath)],
    });

    const signatureRequestId =
      response.body.signatureRequest?.signatureRequestId;
    if (!signatureRequestId) {
      throw new Error("Dropbox Sign did not return a signatureRequestId");
    }

    return {
      requestId: signatureRequestId,
      provider: "dropbox_sign",
      testMode: req.testMode,
    };
  }
}
