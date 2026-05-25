import { ContractStatus } from '../generated/prisma';
import { contractRepository } from '../repositories/contract.repository';

function normalizeEmail(email?: string | null): string {
  return (email || '').toLowerCase().trim();
}

export const dropboxSignWebhookService = {
  async handleEvent(event: any): Promise<void> {
    const eventType: string = event.event?.eventType;
    const requestId: string | undefined = event.signatureRequest?.signatureRequestId;
    if (!requestId) return;

    const contract = await contractRepository.findByESignRequestId(requestId);
    if (!contract) return; // unknown requestId — ignore for security

    if (eventType === 'signature_request_signed') {
      const updates: Record<string, unknown> = { eSignStatus: 'PARTIALLY_SIGNED' };
      const signatures: any[] = event.signatureRequest?.signatures || [];

      for (const sig of signatures) {
        if (sig.statusCode !== 'signed') continue;
        const signedAt = sig.signedAt ? new Date(sig.signedAt * 1000) : new Date();
        const sigEmail = normalizeEmail(sig.signerEmailAddress);

        if (sigEmail === normalizeEmail(contract.clientSignerEmail)) {
          updates.clientSignedAt = signedAt;
        } else if (sigEmail === normalizeEmail(contract.ptSignerEmail)) {
          updates.ptSignedAt = signedAt;
        }
      }

      await contractRepository.updateESignFields(contract.id, updates);
    }

    if (eventType === 'signature_request_all_signed') {
      const updates: Record<string, unknown> = {
        eSignStatus: 'SIGNED',
        status: ContractStatus.ACTIVE,
        fullySignedAt: new Date(),
      };

      // Backfill individual signedAt if not already recorded
      const signatures: any[] = event.signatureRequest?.signatures || [];
      for (const sig of signatures) {
        const signedAt = sig.signedAt ? new Date(sig.signedAt * 1000) : new Date();
        const sigEmail = normalizeEmail(sig.signerEmailAddress);

        if (sigEmail === normalizeEmail(contract.clientSignerEmail) && !contract.clientSignedAt) {
          updates.clientSignedAt = signedAt;
        }
        if (sigEmail === normalizeEmail(contract.ptSignerEmail) && !contract.ptSignedAt) {
          updates.ptSignedAt = signedAt;
        }
      }

      await contractRepository.updateESignFields(contract.id, updates);
    }

    if (eventType === 'signature_request_declined') {
      await contractRepository.updateESignFields(contract.id, { eSignStatus: 'DECLINED' });
    }

    if (eventType === 'signature_request_expired') {
      await contractRepository.updateESignFields(contract.id, { eSignStatus: 'EXPIRED' });
    }
  },
};
