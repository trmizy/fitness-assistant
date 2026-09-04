/**
 * InBody local-vision migration (docs/features/INBODY_LOCAL_VISION_MIGRATION.md)
 * — real integration test against a live Ollama instance with the
 * configured vision model pulled. Requires:
 *
 *   docker exec gymcoach-ollama ollama pull qwen2.5vl:3b   (or whatever
 *   INBODY_VISION_OLLAMA_MODEL/.env resolves to)
 *
 * and OLLAMA_BASE_URL/LLM_BASE_URL reachable from wherever this runs (the
 * dev laptop's own `ollama serve`, or the `gymcoach-ollama` container).
 *
 * This test deliberately does NOT use a real InBody report photo (none
 * exists in this repo, and a fabricated one bundled as a "real" medical
 * report image would misrepresent actual patient data) — it proves the
 * PLUMBING (Ollama reachable, structured-output schema accepted, response
 * parsed and normalized into the exact VisionResult shape
 * inbody.service.ts expects) using a minimal synthetic image. It does NOT
 * prove extraction ACCURACY on a real InBody printout — that needs a real
 * photo run through the actual running app by a human.
 *
 * Run inside the user-service container (or from the host with
 * OLLAMA_BASE_URL pointed at the reachable Ollama instance):
 *   npx tsx --test src/__tests__/inbody-vision-ollama.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { extractInBodyVision } from "../services/inbody-vision.service";

// inbody-vision.service.ts already defaults INBODY_VISION_PROVIDER to
// "ollama" when unset — this test relies on that default rather than
// setting the env var itself, so it exercises exactly what a real deploy
// with no override configured actually does.

// Minimal valid 1x1 transparent PNG — enough to be a well-formed image
// Ollama's vision pipeline will actually decode, without bundling any real
// (or fake-but-realistic-looking) medical report as test fixture data.
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

let tmpImagePath: string;

test.before(() => {
  tmpImagePath = path.join(os.tmpdir(), `inbody-vision-plumbing-test-${Date.now()}.png`);
  fs.writeFileSync(tmpImagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
});

test.after(() => {
  fs.rmSync(tmpImagePath, { force: true });
});

test("extractInBodyVision (ollama): round-trips a real Ollama call and returns the exact VisionResult shape", async () => {
  const result = await extractInBodyVision(tmpImagePath);

  // Shape, not content — a 1x1 blank image has no real metrics to read,
  // so every field is expected to come back null. What this proves is
  // that the request reached Ollama, the structured-output schema was
  // honored (or normalizeVisionResult() filled in the gaps), and nothing
  // threw for a legitimately "nothing readable here" image — the same
  // path a genuinely blurry/wrong-photo upload takes in production.
  assert.ok("measurement_date" in result);
  assert.ok("weight" in result);
  assert.ok("height" in result);
  assert.ok("skeletal_muscle_mass" in result);
  assert.ok("body_fat_mass" in result);

  for (const segment of ["segmental_lean_analysis", "segmental_fat_analysis"] as const) {
    assert.ok(result[segment], `expected ${segment} to be a real object, not null/undefined`);
    for (const key of ["right_arm", "left_arm", "trunk", "right_leg", "left_leg"] as const) {
      const value = result[segment][key];
      assert.ok(
        value === null || typeof value === "number",
        `expected ${segment}.${key} to be null or a number, got ${typeof value}`,
      );
    }
  }
});
