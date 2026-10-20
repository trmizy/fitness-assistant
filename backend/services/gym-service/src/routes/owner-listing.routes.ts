import { Router } from 'express';
import { gymListingController as c } from '../controllers/gym-listing.controller';
import { amenityController } from '../controllers/amenity.controller';
import { noStorePrivate } from '../middleware/no-store.middleware';

/**
 * /owner/gyms/:id/listing/* and /owner/amenities/* - the branch listing workflow (plan §3).
 * Mounted by owner.routes.ts AFTER extractUser + requireRoles('GYM_OWNER') + resolvePartnerContext + the operational gate,
 * and each mount carries `requirePartnerOwner` (a MANAGER gets 403). Ownership of the branch is checked per request
 * (a branch that is not the caller's answers 404). Every response is `Cache-Control: no-store, private`.
 */
export const ownerListingRouter = Router({ mergeParams: true });
ownerListingRouter.use(noStorePrivate);
ownerListingRouter.get('/', c.get);
ownerListingRouter.post('/draft', c.createDraft);
ownerListingRouter.put('/draft', c.saveDraft);
ownerListingRouter.post('/submit', c.submit);
ownerListingRouter.post('/withdraw', c.withdraw);
ownerListingRouter.post('/discard', c.discard);
ownerListingRouter.post('/rebase', c.rebase);
ownerListingRouter.get('/preview', c.preview);
// Also the add-branch wizard's replacement for the retired disk-photo route: works on a DRAFT branch too.
ownerListingRouter.post('/photos/presign', c.presign);
ownerListingRouter.post('/photos/confirm', c.confirm);
// wizard (DRAFT branch) order + cover of its STAGED photos; any other branch uses the revision payload (409 GYM_NOT_DRAFT)
ownerListingRouter.put('/photos/reorder', c.reorderPhotos);
ownerListingRouter.patch('/photos/:photoId/cover', c.setCover);
ownerListingRouter.delete('/photos/:photoId', c.deletePhoto);

export const ownerAmenityRouter = Router();
ownerAmenityRouter.use(noStorePrivate);
ownerAmenityRouter.get('/', amenityController.ownerCatalog);
ownerAmenityRouter.post('/proposals', amenityController.propose);
ownerAmenityRouter.patch('/proposals/:id', amenityController.updateProposal);
ownerAmenityRouter.delete('/proposals/:id', amenityController.cancelProposal);
