import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { conversationRepository, prisma } from "../repositories/conversation.repository";

const originalFindMany = prisma.conversation.findMany;

afterEach(() => {
  prisma.conversation.findMany = originalFindMany;
});

describe("conversationRepository.findMany — excludeThumbsDown", () => {
  it("builds a where clause that keeps unrated (null) rows, excludes only feedback=-1", async () => {
    let capturedWhere: any;
    prisma.conversation.findMany = (async (args: any) => {
      capturedWhere = args.where;
      return [];
    }) as any;

    await conversationRepository.findMany(
      { userId: "u1", excludeThumbsDown: true },
      5,
    );

    assert.equal(capturedWhere.userId, "u1");
    assert.ok(!("excludeThumbsDown" in capturedWhere), "internal flag must not leak into the Prisma where clause");
    assert.deepEqual(capturedWhere.OR, [
      { feedback: null },
      { feedback: { not: -1 } },
    ]);
  });

  it("does not add an OR clause when excludeThumbsDown is not set", async () => {
    let capturedWhere: any;
    prisma.conversation.findMany = (async (args: any) => {
      capturedWhere = args.where;
      return [];
    }) as any;

    await conversationRepository.findMany({ userId: "u1" }, 5);

    assert.equal(capturedWhere.OR, undefined);
  });
});
