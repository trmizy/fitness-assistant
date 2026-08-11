const { profileRepository } = require('./src/repositories/profile.repository.ts');
const { PrismaClient } = require('./src/generated/prisma');
const prisma = new PrismaClient();
async function main() {
  console.log('Testing findPTs...');
  const pts = await profileRepository.findPTs({
    sessionMode: 'HYBRID',
    specialties: ['Yoga']
  });
  console.log('Found:', pts.length);
  if(pts.length > 0) console.log(pts[0].id, pts[0].specialties);
}
main().catch(console.error).finally(() => prisma.$disconnect());
