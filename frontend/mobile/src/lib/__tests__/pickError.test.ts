import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { PICK_FAILED_MESSAGE, pickErrorMessage } from "../pickError";

describe("pickErrorMessage", () => {
  it("replaces the picker's raw English failure with the Vietnamese sentence", () => {
    assert.equal(pickErrorMessage(new Error("Failed to read a file 'file:///data/user/0/x/cache/a.jpg")), PICK_FAILED_MESSAGE);
    assert.equal(
      pickErrorMessage(new Error("Call to function 'ExponentImagePicker.launchImageLibraryAsync' has been rejected.\n→ Caused by: java.io.IOException")),
      PICK_FAILED_MESSAGE,
    );
  });
  it("keeps our own Vietnamese errors (size cap, permission)", () => {
    assert.equal(pickErrorMessage(new Error("Ảnh quá lớn (tối đa 8 MB).")), "Ảnh quá lớn (tối đa 8 MB).");
    assert.equal(pickErrorMessage(new Error("Cần quyền truy cập ảnh.")), "Cần quyền truy cập ảnh.");
  });
  it("is safe on missing or odd values", () => {
    assert.equal(pickErrorMessage(undefined), PICK_FAILED_MESSAGE);
    assert.equal(pickErrorMessage(null), PICK_FAILED_MESSAGE);
    assert.equal(pickErrorMessage("boom"), PICK_FAILED_MESSAGE);
    assert.equal(pickErrorMessage(new Error("")), PICK_FAILED_MESSAGE);
  });
  it("mentions the accepted formats and never shows file paths", () => {
    assert.match(PICK_FAILED_MESSAGE, /JPEG, PNG hoặc WebP/);
    assert.doesNotMatch(PICK_FAILED_MESSAGE, /file:/);
  });
});
