import { Router } from 'express';
import { gymListingController as c } from '../controllers/gym-listing.controller';
import { amenityController } from '../controllers/amenity.controller';
import { noStorePrivate } from '../middleware/no-store.middleware';

/**
 * /admin/listings/gyms/* and /admin/amenities/* - mounted by admin.routes.ts AFTER its
 * `extractUser + requireAuth + requireRoles('ADMIN')`, so every route here is ADMIN-only. The acting admin is req.user.userId.
 */
export const adminGymListingRouter = Router();
adminGymListingRouter.use(noStorePrivate);
adminGymListingRouter.get('/', c.adminList);
adminGymListingRouter.get('/revisions/:rid', c.adminGetRevision);
adminGymListingRouter.get('/revisions/:rid/preview', c.adminPreview);
adminGymListingRouter.post('/revisions/:rid/approve', c.adminApprove);
adminGymListingRouter.post('/revisions/:rid/reject', c.adminReject);
adminGymListingRouter.post('/revisions/:rid/request-changes', c.adminRequestChanges);
adminGymListingRouter.post('/:gymId/direct-edit', c.adminDirectEdit);
adminGymListingRouter.post('/:gymId/photos/presign', c.adminPresign);
adminGymListingRouter.post('/:gymId/photos/confirm', c.adminConfirm);
adminGymListingRouter.post('/:gymId/photos/:photoId/retire', c.adminRetirePhoto);
adminGymListingRouter.get('/:gymId/history', c.adminHistory);
adminGymListingRouter.get('/:gymId', c.adminGetPublished);

export const adminAmenityRouter = Router();
adminAmenityRouter.use(noStorePrivate);
adminAmenityRouter.get('/', amenityController.adminList);
adminAmenityRouter.post('/', amenityController.adminCreate);
// literal "proposals" routes BEFORE the /:id ones
adminAmenityRouter.get('/proposals', amenityController.adminListProposals);
adminAmenityRouter.post('/proposals/approve', amenityController.adminApprove);
adminAmenityRouter.post('/proposals/reject', amenityController.adminReject);
adminAmenityRouter.post('/proposals/merge', amenityController.adminMerge);
adminAmenityRouter.patch('/:id', amenityController.adminUpdate);
adminAmenityRouter.get('/:id/history', amenityController.adminHistory);
