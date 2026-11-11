import { prisma } from '../repositories/prisma';
import { reviewRepository } from '../repositories/review.repository';
import { isGymPubliclyVisible } from './gym-public';
import { resolveDisplayNames } from './display-name.service';
import { reviewerLabel } from './reviewer-label';
import { assertNotSynthetic, syntheticNotTransactableError } from './synthetic-guard';

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/** N09C-03: a review comment is a short opinion, not a document (the web form shows the same cap). */
export const REVIEW_COMMENT_MAX = 1000;

/** At most this many authors are looked up per request (one auth-service call each); the rest read "Hội viên". */
const NAME_LOOKUP_LIMIT = 50;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const reviewService = {
  /**
   * Public list. B45: it used to return the raw rows, i.e. every reviewer's user id (clientId) to anyone who is not logged
   * in. Now each review is { id, gymId, rating, comment, createdAt, updatedAt, reviewerName, isMine } - a short author label
   * ("Phạm T.") and an `isMine` flag computed from the (optional) caller. `clientId` appears ONLY on the caller's own review
   * (so apps built before this change, which compared clientId with the signed-in user, still find "their" review).
   */
  async listForGym(gymId: string, viewerId?: string | null) {
    const [rows, agg] = await Promise.all([
      reviewRepository.listForGym(gymId),
      reviewRepository.aggregateForGym(gymId),
    ]);
    const names = await resolveDisplayNames(rows.slice(0, NAME_LOOKUP_LIMIT).map((r) => r.clientId), { max: NAME_LOOKUP_LIMIT });
    const reviews = rows.map((r) => {
      const isMine = !!viewerId && r.clientId === viewerId;
      return {
        id: r.id,
        gymId: r.gymId,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        reviewerName: reviewerLabel(names.get(r.clientId)),
        isMine,
        ...(isMine ? { clientId: r.clientId } : {}),
      };
    });
    return { averageRating: round2(agg.averageRating), count: agg.count, reviews };
  },

  /**
   * Create/update the caller's single review for a gym. Eligibility: the client must have at least
   * one *paid* membership (status ACTIVE or EXPIRED) at this gym — PENDING_PAYMENT does not count.
   */
  async submit(gymId: string, clientId: string, rating: number, comment?: string) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw err('Số sao phải là số nguyên từ 1 đến 5', 400, 'INVALID_RATING');
    if (comment !== undefined && comment !== null && typeof comment !== 'string') throw err('Nhận xét phải là văn bản', 400, 'INVALID_COMMENT');
    if (typeof comment === 'string' && comment.trim().length > REVIEW_COMMENT_MAX) {
      throw err(`Nhận xét tối đa ${REVIEW_COMMENT_MAX} ký tự`, 400, 'COMMENT_TOO_LONG');
    }

    // B46: a review is written about a branch that is open to the public - APPROVED and operationally OPEN (and whose
    // partner is not hidden). A suspended / closed / unapproved branch refuses it.
    const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { id: true, dataOrigin: true } });
    if (!gym) throw err('Không tìm thấy phòng gym', 404, 'GYM_NOT_FOUND');
    assertNotSynthetic(gym);
    if (!(await isGymPubliclyVisible(gymId))) {
      throw err('Phòng gym hiện không nhận đánh giá (đang đóng cửa hoặc chưa hoạt động)', 409, 'GYM_NOT_ACCEPTING_REVIEWS');
    }

    const paid = await prisma.gymMembershipContract.findFirst({
      where: { gymId, clientId, dataOrigin: 'REAL', status: { in: ['ACTIVE', 'EXPIRED'] } },
    });
    if (!paid) {
      const syntheticPaid = await prisma.gymMembershipContract.findFirst({
        where: { gymId, clientId, dataOrigin: 'SYNTHETIC', status: { in: ['ACTIVE', 'EXPIRED'] } },
        select: { id: true },
      });
      if (syntheticPaid) throw syntheticNotTransactableError();
      throw err('NOT_A_MEMBER', 403);
    }

    // B46: tell the caller whether this created a review (201) or edited their existing one (200).
    const existing = await reviewRepository.findOwn(gymId, clientId);
    const review = await reviewRepository.upsert(gymId, clientId, rating, comment?.trim() || null);
    return { review, created: !existing };
  },

  /** B46: deleting a review that does not exist is a 404, not a silent 200. */
  async remove(gymId: string, clientId: string) {
    const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { dataOrigin: true } });
    assertNotSynthetic(gym);
    const own = await reviewRepository.findOwn(gymId, clientId);
    if (own) assertNotSynthetic(own);
    const { count } = await reviewRepository.deleteOwn(gymId, clientId);
    if (count === 0) throw err('Bạn chưa có đánh giá nào cho phòng gym này', 404, 'REVIEW_NOT_FOUND');
    return { ok: true };
  },
};
