/**
 * Exercise demo media.
 *
 * The catalog has no GIFs: `exercises.video_url` holds a still JPG from the free-exercise-db
 * dataset, and every exercise there ships exactly two frames — `0.jpg` (start of the movement) and
 * `1.jpg` (end). Web's `ExerciseMediaPreview.tsx` fakes the animation by cross-fading the two, and
 * this is the same rule ported so both clients show the same thing.
 *
 * Any other URL is left alone: it is whatever an admin or a PT entered, and rewriting its last path
 * segment would break it.
 */

const FREE_EXERCISE_DB = "yuhonas/free-exercise-db";

export type ExerciseFrames = {
  first: string | null;
  /** Null when the source has no known second frame — the preview then shows a still image. */
  second: string | null;
  canAnimate: boolean;
};

/** `.../Adductor/0.jpg` + frame 1 → `.../Adductor/1.jpg`. Non-dataset URLs come back unchanged. */
export function exerciseMediaFrame(
  videoUrl: string | null | undefined,
  frame: 0 | 1,
): string | null {
  if (!videoUrl) return null;
  if (videoUrl.includes(FREE_EXERCISE_DB) && videoUrl.endsWith(".jpg")) {
    return videoUrl.replace(/\/[^/]+$/, `/${frame}.jpg`);
  }
  return videoUrl;
}

export function exerciseMediaFrames(videoUrl: string | null | undefined): ExerciseFrames {
  const first = exerciseMediaFrame(videoUrl, 0);
  const second = exerciseMediaFrame(videoUrl, 1);
  return {
    first,
    second: second && second !== first ? second : null,
    canAnimate: !!first && !!second && second !== first,
  };
}
