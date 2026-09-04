import { prisma } from '../repositories/prisma';
import { reviewRepository } from '../repositories/review.repository';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const reviewService = {
  async listForGym(gymId: string) {
    const [reviews, agg] = await Promise.all([
      reviewRepository.listForGym(gymId),
      reviewRepository.aggregateForGym(gymId),
    ]);
    return { averageRating: round2(agg.averageRating), count: agg.count, reviews };
  },

  /**
   * Create/update the caller's single review for a gym. Eligibility: the client must have at least
   * one *paid* membership (status ACTIVE or EXPIRED) at this gym — PENDING_PAYMENT does not count.
   */
  async submit(gymId: string, clientId: string, rating: number, comment?: string) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw err('rating must be an integer 1..5', 400);

    const paid = await prisma.gymMembershipContract.findFirst({
      where: { gymId, clientId, status: { in: ['ACTIVE', 'EXPIRED'] } },
    });
    if (!paid) throw err('NOT_A_MEMBER', 403);

    return reviewRepository.upsert(gymId, clientId, rating, comment?.trim() || null);
  },

  async remove(gymId: string, clientId: string) {
    await reviewRepository.deleteOwn(gymId, clientId);
    return { ok: true };
  },
};
