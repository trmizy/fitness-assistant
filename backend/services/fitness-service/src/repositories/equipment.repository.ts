import { prisma } from "./prisma";

export const equipmentRepository = {
  async listCatalog(activeOnly = true) {
    return prisma.equipment.findMany({
      where: activeOnly ? { active: true } : undefined,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  },

  async listUserEquipmentIds(userId: string): Promise<string[]> {
    const rows = await prisma.userEquipment.findMany({
      where: { userId },
      select: { equipmentId: true },
    });
    return rows.map((r) => r.equipmentId);
  },

  /** Replaces the user's full equipment set atomically (onboarding/settings
   * "save my selection" semantics — not an incremental add/remove API). */
  async replaceUserEquipment(userId: string, equipmentIds: string[]) {
    await prisma.$transaction([
      prisma.userEquipment.deleteMany({ where: { userId } }),
      ...(equipmentIds.length > 0
        ? [
            prisma.userEquipment.createMany({
              data: equipmentIds.map((equipmentId) => ({ userId, equipmentId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  },

  async countValidEquipmentIds(equipmentIds: string[]): Promise<number> {
    if (equipmentIds.length === 0) return 0;
    return prisma.equipment.count({ where: { id: { in: equipmentIds }, active: true } });
  },

  async findValidEquipment(equipmentIds: string[]): Promise<Array<{ id: string; name: string }>> {
    if (equipmentIds.length === 0) return [];
    return prisma.equipment.findMany({
      where: { id: { in: equipmentIds }, active: true },
      select: { id: true, name: true },
    });
  },
};
