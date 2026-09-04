import { ContractStatus } from "../generated/prisma";
import { contractRepository } from "../repositories/contract.repository";

function normalizeEmail(email?: string | null): string {
  return (email || "").toLowerCase().trim();
}

export const dropboxSignWebhookService = {
  async handleEvent(event: any): Promise<void> {
    const eventType: string = event.event?.eventType;
    const requestId: string | undefined =
      event.signatureRequest?.signatureRequestId;
    if (!requestId) return;

    const contract = await contractRepository.findByESignRequestId(requestId);
    if (!contract) return; // unknown requestId — ignore for security

    if (eventType === "signature_request_signed") {
      const signatures: any[] = event.signatureRequest?.signatures || [];

      // Dropbox Sign doesn't fire all_signed when two signers share the same email address.
      // Detect this case: if every signature slot is signed, activate immediately.
      const allSigned =
        signatures.length > 0 &&
        signatures.every((s: any) => s.statusCode === "signed") &&
        contract.status === ContractStatus.PENDING_SIGNATURE;

      if (allSigned) {
        // Phase 4: signed contracts go to PENDING_PAYMENT (not ACTIVE) — payment is still
        // required. startDate is set later, on actual activation after payment.
        const updates: Record<string, unknown> = {
          eSignStatus: "SIGNED",
          status: ContractStatus.PENDING_PAYMENT,
          fullySignedAt: new Date(),
        };
        for (const sig of signatures) {
          const signedAt = sig.signedAt
            ? new Date(sig.signedAt * 1000)
            : new Date();
          const sigEmail = normalizeEmail(sig.signerEmailAddress);
          if (
            sigEmail === normalizeEmail(contract.clientSignerEmail) &&
            !contract.clientSignedAt
          ) {
            updates.clientSignedAt = signedAt;
          }
          if (
            sigEmail === normalizeEmail(contract.ptSignerEmail) &&
            !contract.ptSignedAt
          ) {
            updates.ptSignedAt = signedAt;
          }
        }
        await contractRepository.updateESignFields(contract.id, updates);
        return;
      }

      const updates: Record<string, unknown> = {
        eSignStatus: "PARTIALLY_SIGNED",
      };
      for (const sig of signatures) {
        if (sig.statusCode !== "signed") continue;
        const signedAt = sig.signedAt
          ? new Date(sig.signedAt * 1000)
          : new Date();
        const sigEmail = normalizeEmail(sig.signerEmailAddress);

        if (sigEmail === normalizeEmail(contract.clientSignerEmail)) {
          updates.clientSignedAt = signedAt;
        } else if (sigEmail === normalizeEmail(contract.ptSignerEmail)) {
          updates.ptSignedAt = signedAt;
        }
      }

      await contractRepository.updateESignFields(contract.id, updates);
    }

    if (eventType === "signature_request_all_signed") {
      // Idempotency: skip if already past signing (webhook may fire more than once).
      // Phase 4: signed → PENDING_PAYMENT (payment still required before ACTIVE).
      if (
        contract.status === ContractStatus.PENDING_PAYMENT ||
        contract.status === ContractStatus.ACTIVE
      )
        return;
      // Safety: only transition from PENDING_SIGNATURE → PENDING_PAYMENT
      // TODO: add Dropbox Sign HMAC event hash verification for production hardening
      if (contract.status !== ContractStatus.PENDING_SIGNATURE) return;

      const updates: Record<string, unknown> = {
        eSignStatus: "SIGNED",
        status: ContractStatus.PENDING_PAYMENT,
        fullySignedAt: new Date(),
      };

      // Backfill individual signedAt if not already recorded
      const signatures: any[] = event.signatureRequest?.signatures || [];
      for (const sig of signatures) {
        const signedAt = sig.signedAt
          ? new Date(sig.signedAt * 1000)
          : new Date();
        const sigEmail = normalizeEmail(sig.signerEmailAddress);

        if (
          sigEmail === normalizeEmail(contract.clientSignerEmail) &&
          !contract.clientSignedAt
        ) {
          updates.clientSignedAt = signedAt;
        }
        if (
          sigEmail === normalizeEmail(contract.ptSignerEmail) &&
          !contract.ptSignedAt
        ) {
          updates.ptSignedAt = signedAt;
        }
      }

      await contractRepository.updateESignFields(contract.id, updates);
    }

    if (eventType === "signature_request_declined") {
      await contractRepository.updateESignFields(contract.id, {
        eSignStatus: "DECLINED",
      });
    }

    if (eventType === "signature_request_expired") {
      await contractRepository.updateESignFields(contract.id, {
        eSignStatus: "EXPIRED",
      });
    }
  },
};
