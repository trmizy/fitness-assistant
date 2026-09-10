import fs from 'fs';
import path from 'path';
import { gymPhotoRepository } from '../repositories/gym-photo.repository';
import { gymService } from './gym.service';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const UPLOAD_DIR = 'uploads/gym-photos/';
const MAX_PHOTOS = 20;

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 5 "Photos". PUBLIC gallery — deliberately no
 * auth-gated serving (see gym-photo.controller.ts's doc comment); the ownership checks here
 * are only about who may WRITE (upload/delete/reorder/set-cover) a given gym's gallery, not
 * about who may view a photo once it exists.
 */
export const gymPhotoService = {
  async listForOwner(gymId: string, ownerId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    return gymPhotoRepository.listByGym(gymId);
  },

  /** GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace. No ownership check (an admin
   * reviews any gym); these photos are public anyway, so there is nothing to gate here beyond
   * "is this caller actually an admin", already enforced by admin.routes.ts's own middleware. */
  listForAdmin(gymId: string) {
    return gymPhotoRepository.listByGym(gymId);
  },

  async upload(gymId: string, ownerId: string, fileName: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    const count = await gymPhotoRepository.countByGym(gymId);
    if (count >= MAX_PHOTOS) {
      // The file was already written to disk by multer before this check runs — clean it up
      // rather than leaving an orphaned file nothing will ever reference.
      try { fs.unlinkSync(path.join(process.cwd(), UPLOAD_DIR, fileName)); } catch { /* best effort */ }
      throw err(`Tối đa ${MAX_PHOTOS} ảnh cho mỗi chi nhánh`, 400);
    }
    return gymPhotoRepository.create({ gymId, fileName, sortOrder: count, isCover: count === 0 });
  },

  async delete(gymId: string, ownerId: string, photoId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    const photo = await gymPhotoRepository.findById(photoId);
    if (!photo || photo.gymId !== gymId) throw err('Không tìm thấy ảnh', 404);
    await gymPhotoRepository.delete(photoId);
    try { fs.unlinkSync(path.join(process.cwd(), UPLOAD_DIR, photo.fileName)); } catch { /* best effort — DB row is the source of truth */ }

    // Never leave a gallery with photos but no cover — promote the next one if the cover
    // itself was just deleted and others remain.
    if (photo.isCover) {
      const remaining = await gymPhotoRepository.listByGym(gymId);
      if (remaining.length > 0) await gymPhotoRepository.setCover(gymId, remaining[0].id);
    }
  },

  async setCover(gymId: string, ownerId: string, photoId: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    const photo = await gymPhotoRepository.findById(photoId);
    if (!photo || photo.gymId !== gymId) throw err('Không tìm thấy ảnh', 404);
    await gymPhotoRepository.setCover(gymId, photoId);
    return gymPhotoRepository.listByGym(gymId);
  },

  async reorder(gymId: string, ownerId: string, orderedPhotoIds: string[]) {
    await gymService.getOwnedGym(gymId, ownerId);
    const existing = await gymPhotoRepository.listByGym(gymId);
    if (orderedPhotoIds.length !== existing.length || !existing.every((p) => orderedPhotoIds.includes(p.id))) {
      throw err('Danh sách sắp xếp phải chứa đúng các ảnh hiện có', 400);
    }
    await Promise.all(orderedPhotoIds.map((id, index) => gymPhotoRepository.updateSortOrder(id, index)));
    return gymPhotoRepository.listByGym(gymId);
  },
};
