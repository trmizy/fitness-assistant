/**
 * Listing Management D1 - the 30 amenity icon keys map to Phosphor in ONE place, and media URLs resolve.
 * Run: npx tsx --test src/app/utils/__tests__/amenityIcons.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AMENITY_CATEGORIES,
  AMENITY_CATEGORY_LABEL,
  AMENITY_ICON_KEYS,
  AMENITY_ICON_LABEL_VI,
  AMENITY_ICON_PHOSPHOR,
  amenityCategoryLabel,
  isKnownAmenityIcon,
} from "../amenityIcons";
import { AMENITY_ICON_COMPONENTS, amenityIconFor } from "../../components/listing/amenityIconMap";
import { gymPhotoPublicPath, ptPhysiquePublicPath, resolveListingMediaUrl } from "../listingMedia";

/** gym-service/src/services/amenity-catalog.ts#AMENITY_ICON_KEYS, copied verbatim (18 SYSTEM seeds, then 12 general). */
const SERVER_KEYS = [
  "dumbbell", "heart-pulse", "activity", "users", "flower", "waves", "user-check", "scan-line", "lock", "shower-head",
  "flame", "shirt", "car", "wifi", "snowflake", "droplets", "baby", "cup-soda",
  "bike", "coffee", "sparkles", "sun", "music", "star", "footprints", "trophy", "timer", "zap", "medal", "utensils",
];

describe("amenity icon allowlist", () => {
  it("is exactly the server's 30 keys, in the server's order", () => {
    assert.equal(AMENITY_ICON_KEYS.length, 30);
    assert.deepEqual([...AMENITY_ICON_KEYS], SERVER_KEYS);
    assert.equal(new Set(AMENITY_ICON_KEYS).size, 30);
  });

  it("every key has a Phosphor mapping, a Vietnamese label and a real component", () => {
    for (const key of AMENITY_ICON_KEYS) {
      assert.ok(AMENITY_ICON_PHOSPHOR[key], `phosphor name for ${key}`);
      assert.ok(AMENITY_ICON_LABEL_VI[key], `label for ${key}`);
      const Comp = AMENITY_ICON_COMPONENTS[key];
      assert.ok(Comp, `component for ${key}`);
      assert.notEqual(typeof Comp, "undefined");
    }
    assert.equal(Object.keys(AMENITY_ICON_PHOSPHOR).length, 30);
    assert.equal(Object.keys(AMENITY_ICON_COMPONENTS).length, 30);
  });

  it("an unknown key falls back to a neutral icon instead of crashing", () => {
    assert.ok(amenityIconFor("brand-new-key"));
    assert.ok(amenityIconFor(null));
    assert.equal(isKnownAmenityIcon("wifi"), true);
    assert.equal(isKnownAmenityIcon("nope"), false);
  });
});

describe("amenity categories", () => {
  it("the four categories each have a Vietnamese label, never the enum", () => {
    assert.deepEqual([...AMENITY_CATEGORIES], ["FACILITY", "TRAINING_ZONE", "SERVICE", "RECOVERY"]);
    for (const c of AMENITY_CATEGORIES) assert.doesNotMatch(AMENITY_CATEGORY_LABEL[c], /_|^[A-Z]+$/);
    assert.equal(amenityCategoryLabel("SOMETHING"), "Khác");
  });
});

describe("resolveListingMediaUrl", () => {
  it("prefixes the API base for gateway-relative /media paths", () => {
    assert.equal(resolveListingMediaUrl("/media/pt-physique/abc", "/api"), "/api/media/pt-physique/abc");
    assert.equal(resolveListingMediaUrl("/media/gym-photos/abc", "https://api.example.com/"), "https://api.example.com/media/gym-photos/abc");
  });
  it("leaves presigned (absolute) links and blob previews alone; null stays null", () => {
    assert.equal(resolveListingMediaUrl("http://localhost:9000/b/k?sig=1", "/api"), "http://localhost:9000/b/k?sig=1");
    assert.equal(resolveListingMediaUrl("blob:abc", "/api"), "blob:abc");
    assert.equal(resolveListingMediaUrl(null, "/api"), null);
    assert.equal(resolveListingMediaUrl("", "/api"), null);
  });
  it("public path builders", () => {
    assert.equal(ptPhysiquePublicPath("x"), "/media/pt-physique/x");
    assert.equal(gymPhotoPublicPath("x"), "/media/gym-photos/x");
  });
});
