/**
 * Harness guard. The gateway test files run in parallel (one process each) and several start stub servers on FIXED ports.
 * Two files with the same fixed port race for it: the loser's `listen()` never calls back, its `before` hook never settles and the whole
 * `tsx --test src/__tests__/*.test.ts` run hangs (seen on the Frontend 2.0 integration branch: 5 files shared 4041/4042, 3 files 4051-4053).
 * This fails fast, in a few ms, if any fixed listen port is used by more than one file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("no two gateway test files listen on the same fixed port", () => {
  const dir = path.resolve(__dirname);
  const owners = new Map<string, Set<string>>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".test.ts"))) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/\.listen\(\s*(\d{4,5})\b/g)) {
      if (!owners.has(m[1])) owners.set(m[1], new Set());
      owners.get(m[1])!.add(f);
    }
  }
  const clashes = [...owners].filter(([, files]) => files.size > 1).map(([port, files]) => `${port}: ${[...files].join(", ")}`);
  assert.deepEqual(clashes, [], `fixed ports shared by several test files:\n${clashes.join("\n")}`);
});
