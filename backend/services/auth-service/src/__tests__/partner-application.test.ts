import test from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { logger } from "@gym-coach/shared";
import { authRepository } from "../repositories/auth.repository";
import { partnerApplicationRepository as repo } from "../repositories/partner-application.repository";
import { partnerApplicationService } from "../services/partner-application.service";

/**
 * Đối tác Gym tự đăng ký (auth-service). Cùng cách làm với registration-otp.test.ts: không cần DB,
 * mọi phương thức repository chạm tới đều bị thay tạm trong từng test. Không đặt SMTP_* nên email
 * thật rơi vào nhánh dev (delivered: false) — response mang `devVerifyLink` CHỈ khi bật cờ
 * PARTNER_APPLICATION_DEV_ECHO, và đó cũng là cách lấy lại token gốc ở đây.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const BASE = "https://web.example.test/";

function tokenRow(over: Record<string, unknown> = {}) {
  return {
    id: "tok-1",
    email: "owner@gym.test",
    tokenHash: "h",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    verifiedAt: null,
    usedAt: null,
    supersededAt: null,
    setupTokenHash: null,
    setupExpiresAt: null,
    createdUserId: null,
    createdAt: new Date(),
    ...over,
  };
}

async function withDevEcho<T>(fn: () => Promise<T>): Promise<T> {
  process.env.PARTNER_APPLICATION_DEV_ECHO = "true";
  try {
    return await fn();
  } finally {
    delete process.env.PARTNER_APPLICATION_DEV_ECHO;
  }
}

function rawTokenFromLink(link: string): string {
  const m = link.match(/#token=([A-Za-z0-9_-]+)$/);
  assert.ok(m, "link phải mang token trong FRAGMENT (#token=…), không phải query");
  return m![1];
}

// ── start ────────────────────────────────────────────────────────────────────────────────────

test("start() chặn email đã là Customer/PT/Admin — không tạo token, không gửi link", async () => {
  let created = 0;
  const restores = [
    patch(authRepository, "findUserByEmail", async () => ({ id: "u1", role: "CUSTOMER" })),
    patch(repo, "createToken", async () => {
      created += 1;
      return tokenRow();
    }),
  ];
  try {
    await assert.rejects(partnerApplicationService.start("cust@x.test", BASE), (e: any) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, "EMAIL_IN_USE");
      // Không tiết lộ vai trò cụ thể của tài khoản kia.
      assert.doesNotMatch(e.message, /customer|khách hàng|PT|admin/i);
      return true;
    });
    assert.equal(created, 0);
  } finally {
    restores.forEach((r) => r());
  }
});

test("start() báo riêng khi email đã là tài khoản đối tác (GYM_OWNER)", async () => {
  const restore = patch(authRepository, "findUserByEmail", async () => ({ id: "u2", role: "GYM_OWNER" }));
  try {
    await assert.rejects(partnerApplicationService.start("owner@x.test", BASE), (e: any) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, "EMAIL_ALREADY_PARTNER");
      return true;
    });
  } finally {
    restore();
  }
});

test("start() lưu BĂM token, link mang token ở fragment, và vô hiệu link cũ", async () => {
  const stored: any[] = [];
  const superseded: any[] = [];
  const restores = [
    patch(authRepository, "findUserByEmail", async () => null),
    patch(repo, "listRecentByEmail", async () => []),
    patch(repo, "createToken", async (data: any) => {
      stored.push(data);
      return tokenRow({ id: "new-1", ...data });
    }),
    patch(repo, "supersedeOthers", async (email: string, keepId: string) => {
      superseded.push({ email, keepId });
      return { count: 1 };
    }),
  ];
  try {
    const res = await withDevEcho(() => partnerApplicationService.start("owner@gym.test", BASE));
    assert.equal(res.email, "owner@gym.test");
    assert.ok(res.devVerifyLink, "cờ DEV_ECHO bật → có link cho E2E");
    const raw = rawTokenFromLink(res.devVerifyLink!);

    assert.ok(res.devVerifyLink!.startsWith("https://web.example.test/partner/apply/verify#token="));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].tokenHash, sha256(raw), "DB chỉ giữ sha256 của token");
    assert.notEqual(stored[0].tokenHash, raw);
    assert.equal(JSON.stringify(stored[0]).includes(raw), false, "token gốc không được vào DB");
    assert.deepEqual(superseded, [{ email: "owner@gym.test", keepId: "new-1" }]);
    const ttlHours = (stored[0].expiresAt.getTime() - Date.now()) / 3_600_000;
    assert.ok(ttlHours > 23.9 && ttlHours <= 24.01);
  } finally {
    restores.forEach((r) => r());
  }
});

test("start() KHÔNG trả link nếu cờ DEV_ECHO tắt", async () => {
  delete process.env.PARTNER_APPLICATION_DEV_ECHO;
  const restores = [
    patch(authRepository, "findUserByEmail", async () => null),
    patch(repo, "listRecentByEmail", async () => []),
    patch(repo, "createToken", async (d: any) => tokenRow(d)),
    patch(repo, "supersedeOthers", async () => ({ count: 0 })),
  ];
  try {
    const res = await partnerApplicationService.start("owner@gym.test", BASE);
    assert.equal("devVerifyLink" in res, false);
    // Không có SMTP trong test → email không "delivered".
    assert.equal(res.status, "DELIVERY_FAILED");
  } finally {
    restores.forEach((r) => r());
  }
});

test("start() áp cooldown 60s và trần số email/ngày THEO EMAIL, đọc từ DB", async () => {
  const restores = [
    patch(authRepository, "findUserByEmail", async () => null),
    patch(repo, "createToken", async () => {
      throw new Error("không được tạo token khi đang bị giới hạn");
    }),
  ];
  try {
    const restoreRecent = patch(repo, "listRecentByEmail", async () => [
      tokenRow({ createdAt: new Date(Date.now() - 10_000) }),
    ]);
    await assert.rejects(partnerApplicationService.start("owner@gym.test", BASE), (e: any) => {
      assert.equal(e.status, 429);
      assert.equal(e.code, "RESEND_COOLDOWN");
      assert.ok(e.retryAfterSeconds > 0 && e.retryAfterSeconds <= 60);
      return true;
    });
    restoreRecent();

    const many = Array.from({ length: 10 }, (_, i) =>
      tokenRow({ id: `t${i}`, createdAt: new Date(Date.now() - (2 + i) * 60 * 60 * 1000) }),
    );
    const restoreMany = patch(repo, "listRecentByEmail", async () => many);
    await assert.rejects(partnerApplicationService.start("owner@gym.test", BASE), (e: any) => {
      assert.equal(e.status, 429);
      assert.equal(e.code, "DAILY_LIMIT");
      return true;
    });
    restoreMany();
  } finally {
    restores.forEach((r) => r());
  }
});

// ── verify ───────────────────────────────────────────────────────────────────────────────────

test("verify() phân biệt INVALID / USED / EXPIRED (kể cả link đã bị 'Gửi lại' thay thế)", async () => {
  const cases: Array<[string, unknown, string]> = [
    ["không có dòng nào", null, "INVALID"],
    ["đã đặt mật khẩu", tokenRow({ usedAt: new Date() }), "USED"],
    ["quá hạn", tokenRow({ expiresAt: new Date(Date.now() - 1000) }), "EXPIRED"],
    ["bị link mới thay", tokenRow({ supersededAt: new Date() }), "EXPIRED"],
  ];
  for (const [label, row, expected] of cases) {
    const restore = patch(repo, "findByTokenHash", async () => row);
    try {
      const res = await partnerApplicationService.verify("x".repeat(43));
      assert.equal(res.status, expected, label);
      assert.equal("setupToken" in res, false, `${label}: không cấp phiên đặt mật khẩu`);
      assert.equal("email" in res, false, `${label}: không lộ email`);
    } finally {
      restore();
    }
  }
});

test("verify() VALID cấp setupToken ngắn hạn (băm), KHÔNG tiêu token email; verify lại thay phiên cũ", async () => {
  const sessions: any[] = [];
  const row = tokenRow();
  let markedUsed = 0;
  const restores = [
    patch(repo, "findByTokenHash", async () => row),
    patch(repo, "setSetupSession", async (id: string, data: any) => {
      sessions.push({ id, ...data });
      if ((data as any).usedAt) markedUsed += 1;
      return row;
    }),
  ];
  try {
    const first = await partnerApplicationService.verify("y".repeat(43));
    const second = await partnerApplicationService.verify("y".repeat(43));
    assert.equal(first.status, "VALID");
    assert.equal(first.email, "owner@gym.test");
    assert.ok(first.setupToken && second.setupToken);
    assert.notEqual(first.setupToken, second.setupToken, "mỗi lần verify sinh phiên mới");
    assert.equal(sessions[0].setupTokenHash, sha256(first.setupToken!));
    assert.equal(sessions[1].setupTokenHash, sha256(second.setupToken!));
    assert.equal(JSON.stringify(sessions).includes(first.setupToken!), false, "setupToken gốc không vào DB");
    const minutes = (sessions[0].setupExpiresAt.getTime() - Date.now()) / 60000;
    assert.ok(minutes > 14 && minutes <= 15.01);
    assert.equal(markedUsed, 0, "verify không được tiêu token email");
  } finally {
    restores.forEach((r) => r());
  }
});

// ── setPassword ──────────────────────────────────────────────────────────────────────────────

const GOOD_PASSWORD = "Sup3rSecret";

function verifiedRow(over: Record<string, unknown> = {}) {
  return tokenRow({
    verifiedAt: new Date(),
    setupTokenHash: "any",
    setupExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    ...over,
  });
}

test("setPassword() từ chối phiên không có / hết hạn / token email hết hạn hoặc bị thay", async () => {
  const bad: Array<[string, unknown]> = [
    ["không tìm thấy", null],
    ["chưa verify", verifiedRow({ verifiedAt: null })],
    ["phiên setup hết hạn", verifiedRow({ setupExpiresAt: new Date(Date.now() - 1000) })],
    ["token email hết hạn", verifiedRow({ expiresAt: new Date(Date.now() - 1000) })],
    ["bị link mới thay", verifiedRow({ supersededAt: new Date() })],
  ];
  for (const [label, row] of bad) {
    const restore = patch(repo, "findBySetupTokenHash", async () => row);
    try {
      await assert.rejects(partnerApplicationService.setPassword("z".repeat(43), GOOD_PASSWORD), (e: any) => {
        assert.equal(e.status, 400, label);
        assert.equal(e.code, "SETUP_INVALID", label);
        return true;
      });
    } finally {
      restore();
    }
  }
});

test("setPassword() → tạo User GYM_OWNER, băm mật khẩu, cấp phiên; không tạo hồ sơ bên gym-service", async () => {
  let createArgs: any = null;
  const sessions: any[] = [];
  const restores = [
    patch(repo, "findBySetupTokenHash", async () => verifiedRow()),
    patch(authRepository, "findUserByEmail", async () => null),
    patch(repo, "createApplicantAccount", async (args: any) => {
      createArgs = args;
      return { id: "user-9", email: args.email, firstName: null, lastName: null, role: "GYM_OWNER" };
    }),
    patch(authRepository, "createRefreshToken", async (d: any) => {
      sessions.push(d);
      return d;
    }),
  ];
  try {
    const res = await partnerApplicationService.setPassword("z".repeat(43), GOOD_PASSWORD);
    assert.equal(res.user.role, "GYM_OWNER");
    assert.equal(res.user.email, "owner@gym.test");
    assert.ok(res.accessToken && res.refreshToken);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].userId, "user-9");

    assert.equal(createArgs.tokenId, "tok-1");
    assert.notEqual(createArgs.passwordHash, GOOD_PASSWORD, "mật khẩu phải được băm");
    assert.ok(await bcrypt.compare(GOOD_PASSWORD, createArgs.passwordHash));
  } finally {
    restores.forEach((r) => r());
  }
});

test("setPassword() hai lần song song: chỉ một thắng, người sau nhận 409 TOKEN_USED", async () => {
  let claims = 0;
  const restores = [
    patch(repo, "findBySetupTokenHash", async () => verifiedRow()),
    patch(authRepository, "findUserByEmail", async () => null),
    patch(repo, "createApplicantAccount", async () => {
      claims += 1;
      return claims === 1 ? { id: "u", email: "owner@gym.test", firstName: null, lastName: null, role: "GYM_OWNER" } : null;
    }),
    patch(authRepository, "createRefreshToken", async (d: any) => d),
  ];
  try {
    const first = await partnerApplicationService.setPassword("z".repeat(43), GOOD_PASSWORD);
    assert.equal(first.user.role, "GYM_OWNER");
    await assert.rejects(partnerApplicationService.setPassword("z".repeat(43), GOOD_PASSWORD), (e: any) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, "TOKEN_USED");
      return true;
    });
  } finally {
    restores.forEach((r) => r());
  }
});

test("setPassword() từ chối khi token đã dùng, hoặc email vừa bị đăng ký bởi đường khác", async () => {
  {
    const restore = patch(repo, "findBySetupTokenHash", async () => verifiedRow({ usedAt: new Date() }));
    await assert.rejects(partnerApplicationService.setPassword("z".repeat(43), GOOD_PASSWORD), (e: any) => {
      assert.equal(e.code, "TOKEN_USED");
      return true;
    });
    restore();
  }
  {
    const restores = [
      patch(repo, "findBySetupTokenHash", async () => verifiedRow()),
      patch(authRepository, "findUserByEmail", async () => ({ id: "someone", role: "CUSTOMER" })),
    ];
    await assert.rejects(partnerApplicationService.setPassword("z".repeat(43), GOOD_PASSWORD), (e: any) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, "EMAIL_IN_USE");
      return true;
    });
    restores.forEach((r) => r());
  }
  {
    // Va chạm unique ở DB (đăng ký thường chen vào giữa lúc kiểm tra và lúc tạo).
    const restores = [
      patch(repo, "findBySetupTokenHash", async () => verifiedRow()),
      patch(authRepository, "findUserByEmail", async () => null),
      patch(repo, "createApplicantAccount", async () => {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }),
    ];
    await assert.rejects(partnerApplicationService.setPassword("z".repeat(43), GOOD_PASSWORD), (e: any) => {
      assert.equal(e.code, "EMAIL_IN_USE");
      return true;
    });
    restores.forEach((r) => r());
  }
});

// ── vệ sinh log ──────────────────────────────────────────────────────────────────────────────

test("không token/link/mật khẩu nào lọt vào log của luồng start → verify → setPassword", async () => {
  const captured: string[] = [];
  const grab = (...args: unknown[]) => {
    captured.push(JSON.stringify(args));
  };
  const restores = [
    patch(logger as any, "info", grab),
    patch(logger as any, "warn", grab),
    patch(logger as any, "error", grab),
    patch(authRepository, "findUserByEmail", async () => null),
    patch(repo, "listRecentByEmail", async () => []),
    patch(repo, "createToken", async (d: any) => tokenRow({ id: "log-1", ...d })),
    patch(repo, "supersedeOthers", async () => ({ count: 0 })),
    patch(authRepository, "createRefreshToken", async (d: any) => d),
  ];
  let magic = "";
  let setup = "";
  try {
    const started = await withDevEcho(() => partnerApplicationService.start("log@gym.test", BASE));
    magic = rawTokenFromLink(started.devVerifyLink!);

    const row = tokenRow({ id: "log-1", email: "log@gym.test", tokenHash: sha256(magic) });
    let current = row as any;
    const r2 = [
      patch(repo, "findByTokenHash", async () => current),
      patch(repo, "setSetupSession", async (_id: string, d: any) => {
        current = { ...current, verifiedAt: d.verifiedAt, setupTokenHash: d.setupTokenHash, setupExpiresAt: d.setupExpiresAt };
        return current;
      }),
    ];
    const v = await partnerApplicationService.verify(magic);
    setup = v.setupToken!;
    r2.forEach((r) => r());

    const r3 = [
      patch(repo, "findBySetupTokenHash", async () => current),
      patch(repo, "createApplicantAccount", async (a: any) => ({
        id: "u-log",
        email: a.email,
        firstName: null,
        lastName: null,
        role: "GYM_OWNER",
      })),
    ];
    await partnerApplicationService.setPassword(setup, GOOD_PASSWORD);
    r3.forEach((r) => r());

    const blob = captured.join("\n");
    assert.equal(blob.includes(magic), false, "token email không được vào log");
    assert.equal(blob.includes(setup), false, "setupToken không được vào log");
    assert.equal(blob.includes(GOOD_PASSWORD), false, "mật khẩu không được vào log");
  } finally {
    restores.forEach((r) => r());
  }
});
