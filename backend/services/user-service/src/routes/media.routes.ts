import { Router } from "express";
import { ptListingController } from "../controllers/pt-listing.controller";

/** Public media (no auth). Only GET is declared here and at the gateway. */
const router = Router();
router.get("/pt-physique/:photoId", ptListingController.media);

export default router;
