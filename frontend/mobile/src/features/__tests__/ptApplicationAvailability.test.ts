import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { availabilityError, formFromServer, normalizeBlocks, submitErrorMessage } from "../ptApplication/ptApplication";

describe("PT-05: lịch rảnh khôi phục từ bản nháp trên máy chủ", () => {
  const server = [
    { dayOfWeek: "MONDAY", startTime: "08:00:00", endTime: "10:00:00" },
    { dayOfWeek: "SUNDAY", startTime: "17:00", endTime: "19:00" },
  ];

  it("đổi MONDAY… thành khoá Mon… của màn hình và cắt giây", () => {
    const blocks = normalizeBlocks(server);
    assert.deepEqual(
      blocks.map((b) => [b.dayOfWeek, b.startTime, b.endTime]),
      [
        ["Mon", "08:00", "10:00"],
        ["Sun", "17:00", "19:00"],
      ],
    );
  });

  it("formFromServer trả khung giờ đã chuẩn hoá và hợp lệ", () => {
    const { form } = formFromServer({ availabilityBlocks: server } as never);
    assert.equal(form.availabilityBlocks?.[0].dayOfWeek, "Mon");
    assert.equal(availabilityError(form.availabilityBlocks ?? [], 60), null);
  });

  it("thông báo lỗi dùng nhãn tiếng Việt, không lộ khoá thô", () => {
    const msg = availabilityError([{ dayOfWeek: "MONDAY", startTime: "10:00", endTime: "09:00" }], 60) ?? "";
    assert.match(msg, /Thứ 2/);
    assert.doesNotMatch(msg, /MONDAY/);
    assert.equal(submitErrorMessage({ message: "Missing required field for submission: someNewField" }), "Còn thiếu một mục bắt buộc.");
  });
});
