import { Router } from 'express';
import { locationController } from '../controllers/location.controller';

const router = Router();

router.get('/provinces', locationController.getProvinces);
router.get('/provinces/:provinceCode/wards', locationController.getWardsByProvince);
router.get('/search', locationController.searchLocations);

export default router;
