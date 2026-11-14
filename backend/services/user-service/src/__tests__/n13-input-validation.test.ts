/**
 * N13A-05 / N13A-08 / N13B-03 / N13B-04 / N13B-05 - input validation fixes.
 *
 *  N13A-05 / N13B-03  a file whose BYTES are not an allowed image / PDF is refused 400 and deleted from disk, whatever its name or declared type says
 *  N13B-04            availability time must be a real clock time 00:00-23:59 ("25:00" refused)
 *  N13B-05            yearsOfExperience: whole number 0-60 or one of the UI band tokens; free text / fractions refused
 *  N13A-08            marking a notification read with an id that is not a UUID is 404
 *
 * TEST FIXTURE (temp files, a fake response object); nothing here touches a database or the network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireRealAvatarImage, requireRealPtDocument, sniffFileOnDisk } from "../utils/uploaded-file-sniff";
import { availabilityService } from "../services/availability.service";
import { validateYearsOfExperienceField } from "../services/pt_application.service";
import { notificationController } from "../controllers/notification.controller";
import { notificationService } from "../services/notification.service";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "n13-sniff-"));
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpg-body")]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 ")]);
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");
const TEXT = Buffer.from("this is plain text pretending to be an image");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

function stage(name: string, bytes: Buffer): string {
  const p = path.join(DIR, `${Math.random().toString(36).slice(2)}-${name}`);
  fs.writeFileSync(p, bytes);
  return p;
}

async function run(mw: (req: any, res: any, next: any) => Promise<void>, filePath: string | null) {
  const out: { status?: number; body?: any; nexted: boolean } = { nexted: false };
  const res = {
    status(s: number) {
      out.status = s;
      return this;
    },
    json(b: unknown) {
      out.body = b;
      return this;
    },
  };
  await mw({ file: filePath ? { path: filePath } : undefined }, res, () => {
    out.nexted = true;
  });
  return out;
}

test("sniffFileOnDisk: the type comes from the bytes, not the name", async () => {
  assert.equal(await sniffFileOnDisk(stage("a.png", PNG)), "image/png");
  assert.equal(await sniffFileOnDisk(stage("a.png", JPG)), "image/jpeg", "a JPEG named .png is still a JPEG");
  assert.equal(await sniffFileOnDisk(stage("a.webp", WEBP)), "image/webp");
  assert.equal(await sniffFileOnDisk(stage("a.pdf", PDF)), "application/pdf");
  assert.equal(await sniffFileOnDisk(stage("a.png", TEXT)), null);
  assert.equal(await sniffFileOnDisk(path.join(DIR, "does-not-exist")), null);
});

test("N13A-05: avatar accepts real JPG/PNG/WEBP only; text named .png, SVG and PDF are refused 400 and removed from disk", async () => {
  for (const [name, bytes] of [["x.jpg", JPG], ["x.png", PNG], ["x", WEBP]] as const) {
    const p = stage(name, bytes);
    const r = await run(requireRealAvatarImage, p);
    assert.equal(r.nexted, true, name);
    assert.ok(fs.existsSync(p), "an accepted file stays");
  }
  for (const [name, bytes] of [["fake.png", TEXT], ["evil.svg", SVG], ["doc.pdf", PDF], ["empty.png", Buffer.alloc(0)]] as const) {
    const p = stage(name, bytes);
    const r = await run(requireRealAvatarImage, p);
    assert.equal(r.nexted, false, name);
    assert.equal(r.status, 400, name);
    assert.equal(r.body.code, "INVALID_IMAGE_FILE");
    assert.match(r.body.error, /JPG, PNG hoặc WEBP/);
    assert.equal(fs.existsSync(p), false, `${name} was deleted`);
  }
  assert.equal((await run(requireRealAvatarImage, null)).nexted, true, "no file: the controller answers its own error");
});

test("N13B-03: PT application documents accept real JPG/PNG/PDF only; text bytes named .png are refused 400 and removed", async () => {
  for (const [name, bytes] of [["id.png", PNG], ["id.jpeg", JPG], ["cert.pdf", PDF]] as const) {
    assert.equal((await run(requireRealPtDocument, stage(name, bytes))).nexted, true, name);
  }
  for (const [name, bytes] of [["fake.png", TEXT], ["w.png", WEBP], ["evil.png", SVG]] as const) {
    const p = stage(name, bytes);
    const r = await run(requireRealPtDocument, p);
    assert.deepEqual([r.nexted, r.status, r.body.code], [false, 400, "INVALID_DOCUMENT_FILE"], name);
    assert.equal(fs.existsSync(p), false);
  }
});

test("N13B-04: availability times are real clock times (25:00, 24:00, 99:99, 12:60, 9:00 refused); end must be after start", () => {
  const ok = (startTime: string, endTime: string) => availabilityService.validateAvailabilityBlocks([{ dayOfWeek: "MONDAY", startTime, endTime }]);
  assert.doesNotThrow(() => ok("00:00", "23:59"));
  assert.doesNotThrow(() => ok("06:00", "11:30"));
  for (const [s, e] of [["08:00", "25:00"], ["08:00", "24:00"], ["08:00", "99:99"], ["08:00", "12:60"], ["9:00", "10:00"], ["08:00", "8:30"], ["-1:00", "10:00"]]) {
    assert.throws(() => ok(s, e), (err: any) => err.status === 400 && /HH:MM trong khoảng 00:00 đến 23:59/.test(err.message), `${s}-${e}`);
  }
  assert.throws(() => ok("10:00", "10:00"), (err: any) => err.status === 400 && /Giờ kết thúc phải sau giờ bắt đầu/.test(err.message));
  assert.throws(() => ok("11:00", "10:00"), (err: any) => err.status === 400);
  assert.throws(() => availabilityService.validateAvailabilityBlocks([{ dayOfWeek: "MONDAY", startTime: null as any, endTime: "10:00" }]), (err: any) => err.status === 400);
});

test("N13B-05: yearsOfExperience - whole number 0-60 or a UI band; 'abc', '3.5', 61, -1, objects refused 400 INVALID_YEARS_OF_EXPERIENCE", () => {
  for (const good of [undefined, null, "", "  ", "0", "3", "60", 7, "<1", "1-3", "3-5", "5-10", "10+"]) {
    assert.doesNotThrow(() => validateYearsOfExperienceField({ yearsOfExperience: good }), String(good));
  }
  assert.doesNotThrow(() => validateYearsOfExperienceField({}));
  for (const bad of ["abc", "3.5", "61", "-1", "100", "1-2", "ba năm", "5 năm", 3.5, 61, -1, {}, [], true]) {
    assert.throws(
      () => validateYearsOfExperienceField({ yearsOfExperience: bad }),
      (e: any) => e.status === 400 && e.code === "INVALID_YEARS_OF_EXPERIENCE" && /từ 0 đến 60/.test(e.message),
      JSON.stringify(bad),
    );
  }
});

test("N13A-08: mark-read with a malformed id is 404 and never reaches the repository; a real UUID still answers 200", async () => {
  const marks: string[] = [];
  const original = notificationService.markRead;
  (notificationService as any).markRead = async (id: string) => {
    marks.push(id);
    return { count: 1 };
  };
  const call = async (id: string) => {
    const out: { status: number; body?: any } = { status: 200 };
    const res: any = {
      status(s: number) {
        out.status = s;
        return res;
      },
      json(b: unknown) {
        out.body = b;
        return res;
      },
    };
    await notificationController.markRead({ headers: { "x-user-id": "u1" }, params: { id } }, res);
    return out;
  };
  try {
    for (const bad of ["not-a-uuid", "123", "'; DROP TABLE x;--", "../etc/passwd"]) {
      const r = await call(bad);
      assert.deepEqual([r.status, r.body.code], [404, "NOTIFICATION_NOT_FOUND"], bad);
    }
    assert.deepEqual(marks, []);
    const ok = await call("0b3f6a52-7a8e-4c1d-9a55-3d7c8f1e2b10");
    assert.deepEqual([ok.status, ok.body], [200, { success: true }]);
    assert.equal(marks.length, 1);
  } finally {
    (notificationService as any).markRead = original;
  }
});
