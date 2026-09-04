import { prisma } from "./profile.repository";

export interface ClientRating {
  /** null (not 0) when the client has never been rated — "no rating yet" is not "zero stars". */
  avgRating: number | null;
  ratingCount: number;
}

export interface ClientReviewComment {
  rating: number;
  comment: string;
  createdAt: Date;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Ratings for many CLIENTS in one grouped query — the mirror-image of
 * ptReview.repository.ts's aggregateForPts, in the opposite direction (PT rates client instead
 * of client rates PT). Used so a PT reviewing a NEW contract request can see how that client
 * behaved in past contracts with OTHER PTs before deciding to accept.
 *
 * Raw SQL for the same reason as ptReview.repository.ts: ClientReview stores sessionId, not
 * clientUserId directly — the client is reached through `sessions`.
 */
export const clientReviewRepository = {
  async aggregateForClients(
    clientUserIds: string[],
  ): Promise<Map<string, ClientRating>> {
    const map = new Map<string, ClientRating>();
    if (clientUserIds.length === 0) return map;

    const rows = await prisma.$queryRaw<
      { clientUserId: string; avg: number; count: bigint }[]
    >`
      SELECT s.client_user_id AS "clientUserId",
             AVG(r.rating)::float AS "avg",
             COUNT(*) AS "count"
      FROM client_reviews r
      JOIN sessions s ON s.id = r.session_id
      WHERE s.client_user_id = ANY(${clientUserIds}::text[])
      GROUP BY s.client_user_id
    `;

    for (const row of rows) {
      map.set(row.clientUserId, {
        avgRating: round1(Number(row.avg)),
        ratingCount: Number(row.count),
      });
    }
    return map;
  },

  async aggregateForClient(clientUserId: string): Promise<ClientRating> {
    const map = await this.aggregateForClients([clientUserId]);
    return map.get(clientUserId) ?? { avgRating: null, ratingCount: 0 };
  },

  /** Latest commented reviews for a client, shown to a PT deciding on a new request. */
  async recentCommentsForClient(
    clientUserId: string,
    limit = 5,
  ): Promise<ClientReviewComment[]> {
    const rows = await prisma.$queryRaw<
      { rating: number; comment: string; createdAt: Date }[]
    >`
      SELECT r.rating, r.comment, r.created_at AS "createdAt"
      FROM client_reviews r
      JOIN sessions s ON s.id = r.session_id
      WHERE s.client_user_id = ${clientUserId}
        AND r.comment IS NOT NULL
        AND btrim(r.comment) <> ''
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => ({ ...r, rating: Number(r.rating) }));
  },
};

/** Attaches avgRating/ratingCount to a list of client-keyed rows in one aggregate query. */
export async function attachClientRatings<T extends { clientUserId: string }>(
  rows: T[],
): Promise<(T & { clientRating: ClientRating })[]> {
  const ratings = await clientReviewRepository.aggregateForClients(
    rows.map((r) => r.clientUserId),
  );
  return rows.map((r) => ({
    ...r,
    clientRating: ratings.get(r.clientUserId) ?? {
      avgRating: null,
      ratingCount: 0,
    },
  }));
}
