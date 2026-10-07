import test from "node:test";
import assert from "node:assert/strict";
import { foldSearchName, profileNameFields } from "../utils/profileName.util";

test("a name is stored with an accent-folded, lower-cased twin for search", () => {
  assert.deepEqual(profileNameFields("Nguyễn", "Văn Đức"), {
    firstName: "Nguyễn",
    lastName: "Văn Đức",
    firstNameNormalized: "nguyen",
    lastNameNormalized: "van đuc",
  });
  assert.equal(foldSearchName("Hoàng Thảo"), "hoang thao");
});

test("blank or missing names produce nothing to write, and one half may be absent", () => {
  assert.equal(profileNameFields(null, undefined), null);
  assert.equal(profileNameFields("  ", ""), null);
  assert.deepEqual(profileNameFields(" QA ", null), {
    firstName: "QA",
    lastName: null,
    firstNameNormalized: "qa",
    lastNameNormalized: null,
  });
});
