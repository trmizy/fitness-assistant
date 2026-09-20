/**
 * Exercise demo media. The catalog stores two JPG frames per exercise, not a GIF — the rule that
 * derives the second frame is the one web already ships, so a wrong rewrite here would show a
 * different movement than the web client for the same exercise.
 *
 * Runs with: npx tsx --test src/features/__tests__/exerciseMedia.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { exerciseMediaFrame, exerciseMediaFrames } from "../library/exerciseMedia";

/** A real `exercises.video_url` value from the fitness DB. */
const datasetUrl =
  "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Adductor/0.jpg";

describe("exerciseMediaFrame", () => {
  it("derives both frames of a free-exercise-db entry", () => {
    assert.equal(
      exerciseMediaFrame(datasetUrl, 0),
      "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Adductor/0.jpg",
    );
    assert.equal(
      exerciseMediaFrame(datasetUrl, 1),
      "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/Adductor/1.jpg",
    );
  });

  it("rewrites whichever frame the stored URL happens to point at", () => {
    const storedSecond = datasetUrl.replace("/0.jpg", "/1.jpg");
    assert.equal(exerciseMediaFrame(storedSecond, 0), datasetUrl);
  });

  it("leaves a URL that is not a dataset JPG exactly as it is", () => {
    assert.equal(exerciseMediaFrame("https://cdn.example.com/squat.mp4", 1), "https://cdn.example.com/squat.mp4");
    assert.equal(
      exerciseMediaFrame("https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/x.png", 1),
      "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/x.png",
    );
  });

  it("has nothing to show without a URL — 217 of 1090 catalog rows have none", () => {
    assert.equal(exerciseMediaFrame(null, 0), null);
    assert.equal(exerciseMediaFrame(undefined, 1), null);
    assert.equal(exerciseMediaFrame("", 0), null);
  });
});

describe("exerciseMediaFrames", () => {
  it("a dataset entry animates between two different frames", () => {
    assert.deepEqual(exerciseMediaFrames(datasetUrl), {
      first: datasetUrl,
      second: datasetUrl.replace("/0.jpg", "/1.jpg"),
      canAnimate: true,
    });
  });

  it("a single-URL source is a still image, never a one-frame animation", () => {
    const frames = exerciseMediaFrames("https://cdn.example.com/squat.jpg");
    assert.equal(frames.first, "https://cdn.example.com/squat.jpg");
    assert.equal(frames.second, null);
    assert.equal(frames.canAnimate, false);
  });

  it("no URL means no media at all", () => {
    assert.deepEqual(exerciseMediaFrames(null), { first: null, second: null, canAnimate: false });
  });
});
