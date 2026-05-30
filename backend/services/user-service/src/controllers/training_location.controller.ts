import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { trainingLocationRepository } from '../repositories/training_location.repository';
import { locationRepository } from '../repositories/location.repository';
import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function assertApprovedPT(userId: string, res: Response): Promise<boolean> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile?.isPT) {
    res.status(403).json({ error: 'Chỉ PT đã được duyệt mới được quản lý địa điểm' });
    return false;
  }
  const app = await prisma.pTApplication.findFirst({ where: { userProfileId: profile.id } });
  if (app?.status !== 'APPROVED') {
    res.status(403).json({ error: 'Application chưa được duyệt' });
    return false;
  }
  return true;
}

async function validateProvince(provinceCode: number, wardCode?: number | null, res?: Response): Promise<boolean> {
  const province = await locationRepository.findProvinceByCode(provinceCode);
  if (!province) {
    res?.status(400).json({ error: `provinceCode ${provinceCode} không hợp lệ` });
    return false;
  }
  if (wardCode) {
    const ward = await locationRepository.findWardByCode(wardCode);
    if (!ward || ward.provinceCode !== provinceCode) {
      res?.status(400).json({ error: `wardCode ${wardCode} không thuộc tỉnh ${provinceCode}` });
      return false;
    }
  }
  return true;
}

export const trainingLocationController = {
  getMyLocations: async (req: AuthRequest, res: Response) => {
    try {
      const locations = await trainingLocationRepository.findByPtUserId(req.user!.id);
      res.json(locations);
    } catch {
      res.status(500).json({ error: 'Failed to fetch training locations' });
    }
  },

  createLocation: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      if (!(await assertApprovedPT(userId, res))) return;

      const { provinceCode, wardCode, gymName, addressLine, legacyDistrictName, isPrimary, note } = req.body;

      if (!provinceCode) { res.status(400).json({ error: 'provinceCode bắt buộc' }); return; }
      if (!(await validateProvince(Number(provinceCode), wardCode ? Number(wardCode) : null, res))) return;
      if (gymName && String(gymName).length > 120) { res.status(400).json({ error: 'gymName tối đa 120 ký tự' }); return; }
      if (addressLine && String(addressLine).length > 255) { res.status(400).json({ error: 'addressLine tối đa 255 ký tự' }); return; }

      const location = await trainingLocationRepository.create(userId, {
        provinceCode: Number(provinceCode),
        wardCode: wardCode ? Number(wardCode) : null,
        gymName: gymName ?? null,
        addressLine: addressLine ?? null,
        legacyDistrictName: legacyDistrictName ?? null,
        isPrimary: Boolean(isPrimary),
        note: note ?? null,
      });

      res.status(201).json(location);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to create training location' });
    }
  },

  updateLocation: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      if (!(await assertApprovedPT(userId, res))) return;

      const existing = await trainingLocationRepository.findByIdAndOwner(id, userId);
      if (!existing) { res.status(403).json({ error: 'Không có quyền chỉnh sửa địa điểm này' }); return; }

      const { provinceCode, wardCode, gymName, addressLine, legacyDistrictName, isPrimary, isActive, note } = req.body;

      const updateProvinceCode = provinceCode !== undefined ? Number(provinceCode) : existing.provinceCode;
      const updateWardCode = wardCode !== undefined ? (wardCode ? Number(wardCode) : null) : existing.wardCode;

      if (provinceCode !== undefined || wardCode !== undefined) {
        if (!(await validateProvince(updateProvinceCode, updateWardCode, res))) return;
      }
      if (gymName !== undefined && String(gymName).length > 120) { res.status(400).json({ error: 'gymName tối đa 120 ký tự' }); return; }
      if (addressLine !== undefined && String(addressLine).length > 255) { res.status(400).json({ error: 'addressLine tối đa 255 ký tự' }); return; }

      const updated = await trainingLocationRepository.update(id, userId, {
        ...(provinceCode !== undefined && { provinceCode: updateProvinceCode }),
        ...(wardCode !== undefined && { wardCode: updateWardCode }),
        ...(gymName !== undefined && { gymName }),
        ...(addressLine !== undefined && { addressLine }),
        ...(legacyDistrictName !== undefined && { legacyDistrictName }),
        ...(isPrimary !== undefined && { isPrimary: Boolean(isPrimary) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        ...(note !== undefined && { note }),
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update training location' });
    }
  },

  deleteLocation: async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;

      const existing = await trainingLocationRepository.findByIdAndOwner(id, userId);
      if (!existing) { res.status(403).json({ error: 'Không có quyền xóa địa điểm này' }); return; }

      await trainingLocationRepository.softDelete(id);
      res.json({ message: 'Địa điểm đã được ẩn' });
    } catch {
      res.status(500).json({ error: 'Failed to delete training location' });
    }
  },
};
