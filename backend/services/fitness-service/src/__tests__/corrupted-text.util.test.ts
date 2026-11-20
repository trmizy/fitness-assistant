import test from "node:test";
import assert from "node:assert/strict";
import { isCorruptedText } from "../utils/corrupted-text.util";

/**
 * Regression: CORRUPTED_TEXT_PATTERN had the `i` flag, so the real Vietnamese letters "ã", "â", "ó", "è" matched the Latin-1 mojibake lead
 * bytes "Ã", "Â", "Ó", "È". "Chân + Mông" / "Thân dưới" were replaced by the fallback title "Nguc + Vai + Tay sau".
 */

const mojibakeLatin1 = (s: string) => Buffer.from(s, "utf8").toString("latin1");
const mojibakeCp1252 = (s: string) => new TextDecoder("windows-1252").decode(Buffer.from(s, "utf8"));

const REAL_VIETNAMESE = [
  "Chân + Mông",
  "Thân dưới",
  "Thân trên",
  "Ngực + Vai + Tay sau",
  "Lưng + Tay trước",
  "Core + Cardio",
  "Hồi phục chủ động",
  "CHÂN + MÔNG",
  "THÂN DƯỚI",
  "Ngã, óc, èo uột, Ã, Â, Ó, È, É",
  "Tập trung vào kỹ thuật đúng, kiểm soát nhịp tập và tăng tiến từ từ.",
  // every Vietnamese letter and tone mark
  "aàáảãạ ăằắẳẵặ âầấẩẫậ eèéẻẽẹ êềếểễệ iìíỉĩị oòóỏõọ ôồốổỗộ ơờớởỡợ uùúủũụ ưừứửữự yỳýỷỹỵ đ",
  "AÀÁẢÃẠ ĂẰẮẲẴẶ ÂẦẤẨẪẬ EÈÉẺẼẸ ÊỀẾỂỄỆ IÌÍỈĨỊ OÒÓỎÕỌ ÔỒỐỔỖỘ ƠỜỚỞỠỢ UÙÚỦŨỤ ƯỪỨỬỮỰ YỲÝỶỸỴ Đ",
  "Quyền Anh – bài tập “thân dưới” có tạ",
];

const MOJIBAKE = [
  ...["Chân + Mông", "Thân dưới", "Ngực + Vai + Tay sau", "Lưng + Tay trước", "đẹp, ưu tiên, ạ ự"].flatMap((s) => [
    mojibakeLatin1(s),
    mojibakeCp1252(s),
  ]),
  "Ã¢", // â
  "Ä‘", // đ
  "Æ°", // ư
  "Ã ", // à
  "áº¡", // ạ
  "á»±", // ự
  "â€™",
  "Ch�n + M�ng",
  "Ch?n + M?ng",
  "Bad\u0001control",
];

test("real Vietnamese is never flagged as corrupted", () => {
  for (const text of REAL_VIETNAMESE) {
    assert.equal(isCorruptedText(text), false, `false positive: ${text}`);
  }
});

test("known mojibake / lossy text is still flagged", () => {
  for (const text of MOJIBAKE) {
    assert.equal(isCorruptedText(text), true, `missed: ${JSON.stringify(text)}`);
  }
});

test("lowercase real letters that look like mojibake lead bytes are fine on their own", () => {
  for (const ch of ["ã", "â", "ó", "è", "ê", "ô", "ơ"]) {
    assert.equal(isCorruptedText(`xin ${ch}m`), false, ch);
  }
});
