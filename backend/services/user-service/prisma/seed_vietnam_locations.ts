// Source: https://github.com/sunshine-tech/VietnamProvinces
// File: vietnam_provinces/data/nested-divisions.json
// Imported at: 2026-05-28
// Commit: 67757d43dcbb9e1406088c185c660a115fb1f546
// Do NOT fetch from GitHub at runtime — data is vendored in prisma/data/

import { PrismaClient } from '../src/generated/prisma';
import { normalizeVietnamese } from '../src/utils/normalize';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface WardData {
  code: number;
  name: string;
  codename?: string;
  division_type?: string;
  short_codename?: string;
}

interface ProvinceData {
  code: number;
  name: string;
  codename?: string;
  division_type?: string;
  phone_code?: number;
  wards?: WardData[];
}

async function main() {
  const existing = await prisma.vietnamProvince.count();
  if (existing > 0) {
    console.log(`Vietnam locations already seeded (${existing} provinces). Skipping.`);
    return;
  }

  const dataPath = path.join(__dirname, 'data', 'vietnam_provinces.json');
  const raw = fs.readFileSync(dataPath, 'utf-8');
  const provinces: ProvinceData[] = JSON.parse(raw);

  let provinceCount = 0;
  let wardCount = 0;

  for (const province of provinces) {
    await prisma.vietnamProvince.upsert({
      where: { code: province.code },
      update: {
        name: province.name,
        nameNormalized: normalizeVietnamese(province.name),
        codename: province.codename ?? null,
        divisionType: province.division_type ?? null,
        phoneCode: province.phone_code ?? null,
      },
      create: {
        code: province.code,
        name: province.name,
        nameNormalized: normalizeVietnamese(province.name),
        codename: province.codename ?? null,
        divisionType: province.division_type ?? null,
        phoneCode: province.phone_code ?? null,
      },
    });
    provinceCount++;

    for (const ward of province.wards ?? []) {
      await prisma.vietnamWard.upsert({
        where: { code: ward.code },
        update: {
          provinceCode: province.code,
          name: ward.name,
          nameNormalized: normalizeVietnamese(ward.name),
          codename: ward.codename ?? null,
          divisionType: ward.division_type ?? null,
          shortCodename: ward.short_codename ?? null,
        },
        create: {
          code: ward.code,
          provinceCode: province.code,
          name: ward.name,
          nameNormalized: normalizeVietnamese(ward.name),
          codename: ward.codename ?? null,
          divisionType: ward.division_type ?? null,
          shortCodename: ward.short_codename ?? null,
        },
      });
      wardCount++;
    }
  }

  console.log(`Seeded ${provinceCount} provinces, ${wardCount} wards`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
