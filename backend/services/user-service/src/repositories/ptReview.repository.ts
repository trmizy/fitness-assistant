import { prisma } from "./profile.repository";

export interface PtRating {
  /** null (not 0) when the PT has never been rated — "no rating yet" is not "zero stars". */
  avgRating: number | null;
  ratingCount: number;
}

export interface PtReviewComment {
  rating: number;
  comment: string;
  createdAt: Date;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Ratings for many PTs in ONE grouped query — mirrors gym-service's
 * reviewRepository.aggregateForGyms so a 20-PT listing costs one aggregate, not 20
 * lookups. Computed on read rather than kept in a column on the profile: nothing to
 * re-sync when a review is edited or deleted.
 *
 * Raw SQL because SessionReview stores sessionId, not ptUserId — the PT is reached through
 * `sessions`, and Prisma's groupBy cannot group by a joined column.
 */
export const ptReviewRepository = {
  async aggregateForPts(ptUserIds: string[]): Promise<Map<string, PtRating>> {
    const map = new Map<string, PtRating>();
    if (ptUserIds.length === 0) return map;

    const rows = await prisma.$queryRaw<
      { ptUserId: string; avg: number; count: bigint }[]
    >`
      SELECT s.pt_user_id AS "ptUserId",
             AVG(r.rating)::float AS "avg",
             COUNT(*) AS "count"
      FROM session_reviews r
      JOIN sessions s ON s.id = r.session_id
      WHERE s.pt_user_id = ANY(${ptUserIds}::text[])
      GROUP BY s.pt_user_id
    `;

    for (const row of rows) {
      map.set(row.ptUserId, {
        avgRating: round1(Number(row.avg)),
        ratingCount: Number(row.count),
      });
    }
    return map;
  },

  async aggregateForPt(ptUserId: string): Promise<PtRating> {
    const map = await this.aggregateForPts([ptUserId]);
    return map.get(ptUserId) ?? { avgRating: null, ratingCount: 0 };
  },

  /** Latest commented reviews for a PT's detail page (blank comments carry nothing). */
  async recentCommentsForPt(
    ptUserId: string,
    limit = 5,
  ): Promise<PtReviewComment[]> {
    const rows = await prisma.$queryRaw<
      { rating: number; comment: string; createdAt: Date }[]
    >`
      SELECT r.rating, r.comment, r.created_at AS "createdAt"
      FROM session_reviews r
      JOIN sessions s ON s.id = r.session_id
      WHERE s.pt_user_id = ${ptUserId}
        AND r.comment IS NOT NULL
        AND btrim(r.comment) <> ''
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({ ...r, rating: Number(r.rating) }));
  },

  /** How many 1★/2★/.../5★ ratings a PT has — the bar-chart breakdown next to the overall
   *  average on the discovery detail modal's "Đánh giá" tab. Always returns all 5 keys (0 for
   *  a star count with no reviews) so the frontend never has to guess a default. */
  async ratingDistributionForPt(
    ptUserId: string,
  ): Promise<Record<1 | 2 | 3 | 4 | 5, number>> {
    const dist: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    const rows = await prisma.$queryRaw<{ rating: number; count: bigint }[]>`
      SELECT r.rating, COUNT(*) AS count
      FROM session_reviews r
      JOIN sessions s ON s.id = r.session_id
      WHERE s.pt_user_id = ${ptUserId}
      GROUP BY r.rating
    `;
    for (const row of rows) {
      const r = Number(row.rating) as 1 | 2 | 3 | 4 | 5;
      if (r in dist) dist[r] = Number(row.count);
    }
    return dist;
  },
};

/** Attaches avgRating/ratingCount to a list of profiles in one aggregate query. */
export async function attachPtRatings<T extends { userId: string }>(
  profiles: T[],
): Promise<(T & PtRating)[]> {
  const ratings = await ptReviewRepository.aggregateForPts(
    profiles.map((p) => p.userId),
  );
  return profiles.map((p) => ({
    ...p,
    ...(ratings.get(p.userId) ?? { avgRating: null, ratingCount: 0 }),
  }));
}
