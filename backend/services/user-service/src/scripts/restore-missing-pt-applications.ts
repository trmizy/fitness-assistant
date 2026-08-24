import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Đang quét và khôi phục PTApplication bị thiếu ---');

  // 1. Tìm tất cả userProfiles có isPT = true
  const pts = await prisma.userProfile.findMany({
    where: { isPT: true },
    select: { id: true, userId: true, firstName: true, lastName: true }
  });

  console.log(`Tìm thấy ${pts.length} PT.`);

  let restoredCount = 0;

  for (const pt of pts) {
    // 2. Kiểm tra xem PTApplication đã có chưa
    const app = await prisma.pTApplication.findUnique({
      where: { userProfileId: pt.id }
    });

    if (!app) {
      console.log(`[Khôi phục] PT bị thiếu PTApplication: ${pt.firstName} ${pt.lastName} (ID: ${pt.id})`);
      
      // 3. Tạo record giả để đảm bảo luồng bán hàng không bị kẹt.
      // Dùng giá trị mặc định để sau này PT có thể cập nhật.
      await prisma.pTApplication.create({
        data: {
          userProfileId: pt.id,
          status: 'APPROVED',
          packagePrice: 500000,
          sessionsPerPackage: 10,
          sessionDurationMinutes: 60,
          serviceMode: 'OFFLINE',
          phoneNumber: '0909000000',
          approvedAt: new Date(),
        }
      });
      restoredCount++;
    }
  }

  console.log(`--- Đã khôi phục thành công ${restoredCount} PTApplication ---`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
