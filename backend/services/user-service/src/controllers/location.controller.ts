import { Request, Response } from "express";
import { locationRepository } from "../repositories/location.repository";

export const locationController = {
  getProvinces: async (_req: Request, res: Response) => {
    try {
      const provinces = await locationRepository.findAllProvinces();
      res.json(provinces);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch provinces" });
    }
  },

  getWardsByProvince: async (req: Request, res: Response): Promise<void> => {
    try {
      const provinceCode = parseInt(req.params.provinceCode, 10);
      if (isNaN(provinceCode)) {
        res.status(400).json({ error: "provinceCode phải là số nguyên" });
        return;
      }

      const province =
        await locationRepository.findProvinceByCode(provinceCode);
      if (!province) {
        res
          .status(404)
          .json({ error: `Tỉnh/thành có code ${provinceCode} không tồn tại` });
        return;
      }

      const wards = await locationRepository.findWardsByProvince(provinceCode);
      res.json(wards);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch wards" });
    }
  },

  searchLocations: async (req: Request, res: Response): Promise<void> => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q) {
        res.status(400).json({ error: "Query param q is required" });
        return;
      }

      const wards = await locationRepository.searchLocations(q);
      const results = wards.map((w: any) => ({
        type: "ward" as const,
        provinceCode: w.provinceCode,
        provinceName: w.province.name,
        wardCode: w.code,
        wardName: w.name,
      }));
      res.json(results);
    } catch (err) {
      res.status(500).json({ error: "Failed to search locations" });
    }
  },
};
