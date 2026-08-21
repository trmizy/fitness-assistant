import { equipmentRepository } from "../repositories/equipment.repository";
import { syncAvailableEquipmentToUserProfile } from "../clients/user.client";

class ValidationError extends Error {
  status = 400;
}

export const equipmentService = {
  async getCatalog() {
    const equipment = await equipmentRepository.listCatalog(true);
    return equipment;
  },

  async getUserEquipment(userId: string) {
    return equipmentRepository.listUserEquipmentIds(userId);
  },

  /** Users may only ever set THEIR OWN equipment — userId always comes from
   * the authenticated request context (req.user.id), never a client-supplied
   * field, so there is no cross-user write path to guard against here.
   *
   * UserEquipment (this table) is the sole canonical source of truth for
   * equipment-availability decisions (candidate filtering, substitution).
   * user-service's UserProfile.availableEquipment is synced here, backend-
   * to-backend, purely as a legacy/human-readable compatibility copy still
   * read by the AI coach chat's advisory prompt — callers of this method
   * never need to separately write that field themselves (see
   * docs notes on single-source-of-truth for equipment, gym-onboarding
   * project follow-up pass). */
  async setUserEquipment(userId: string, equipmentIds: string[]) {
    const unique = Array.from(new Set(equipmentIds.filter((id) => typeof id === "string" && id.length > 0)));
    let validEquipment: Array<{ id: string; name: string }> = [];
    if (unique.length > 0) {
      validEquipment = await equipmentRepository.findValidEquipment(unique);
      if (validEquipment.length !== unique.length) {
        throw new ValidationError("One or more equipment ids are not valid/active catalog entries");
      }
    }
    await equipmentRepository.replaceUserEquipment(userId, unique);
    // Fire-and-forget from the caller's perspective (awaited here so any
    // transient failure is logged before responding, but never throws —
    // see syncAvailableEquipmentToUserProfile's own try/catch).
    await syncAvailableEquipmentToUserProfile(userId, validEquipment.map((e) => e.name));
    return equipmentRepository.listUserEquipmentIds(userId);
  },
};
