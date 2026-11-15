/**
 * M7-P5A2 — G1 / G2 / G3 of the Codex verification of af66b3a3 (docs/ai-v2/m7/annotation-pilot/08-G1-G3-official-workflow-blockers).
 * TEST FIXTURE only (synthetic data, OS temp dirs, offline, no network / DB / Redis). Every attack must fail closed.
 *   G1 rollback is by lstat IDENTITY: a replaced / renamed / symlinked destination or member is never deleted by name
 *   G2 a source change found AFTER the success marker invalidates the bundle (notice file) and the command exits non-zero
 *   G3 a consumer accepts a bundle only if PUBLISHED.json is well-formed, lists EXACTLY the expected members, and every hash
 *      equals the bytes read; the marker is re-checked during the run. The marker is consistency metadata, NOT authentication.
 * Symlink / junction cases are skipped (visibly) where the OS refuses to create one (Windows without developer mode).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { INVALIDATION_NOTICE, PUBLICATION_MARKER, testHooks } from "./m7-benchmark/annotation-cli";
import {
  acceptArgs, acceptanceDraftArgs, agreementArgs, cleanup, mergeArgs, pipeline, prepareArgs, reseal, run, sha, workspace,
  type Obj, type Ws,
} from "./m7-benchmark/annotation-test-scenario";

const has = (codes: string[], ...want: string[]) => { for (const c of want) assert.ok(codes.includes(c), `${c} expected in ${codes.join(",")}`); };
const noStaging = (w: Ws) => assert.deepEqual(fs.readdirSync(w.dir).filter((f) => f.includes(".partial-")), [], "no staging left behind");
const listing = (p: string) => fs.readdirSync(p).sort();
const stagingOf = (w: Ws, prefix: string) => path.join(w.dir, fs.readdirSync(w.dir).find((n) => n.startsWith(prefix))!);
const readJson = (p: string): Obj => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p: string, o: unknown) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
const clearHooks = () => { for (const k of Object.keys(testHooks)) delete (testHooks as Record<string, unknown>)[k]; };
/** Appends one byte to a file once (the first time the hook fires). */
const touchOnce = (file: string) => { let done = false; return () => { if (!done) { done = true; fs.appendFileSync(file, "\n"); } }; };
/** Runs `fn` while every hard link into a PUBLISHED.json first calls `before` (the window between the last check and the marker). */
function withMarkerLinkInterposer<T>(before: (dest: string) => void, fn: () => T): T {
  const fsw = fs as unknown as { linkSync: typeof fs.linkSync };
  const real = fsw.linkSync;
  fsw.linkSync = ((a: fs.PathLike, b: fs.PathLike) => { if (String(b).endsWith(PUBLICATION_MARKER)) before(String(b)); return real(a, b); }) as typeof fs.linkSync;
  try { return fn(); } finally { fsw.linkSync = real; }
}
/** Creates a symlink/junction, or returns false when the platform refuses (the caller skips the test, visibly). */
function trySymlink(target: string, p: string, type?: "dir" | "file" | "junction"): boolean {
  try { fs.symlinkSync(target, p, type); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === "EPERM" || (e as NodeJS.ErrnoException).code === "EACCES") return false; throw e; }
}
const prepared = (): Ws => { const w = workspace(); run(prepareArgs(w)); run(acceptArgs(w)); return w; };

// ── G1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("G1-a rollback never removes a directory a competitor put at the output name (renamed away + replaced mid-publication)", () => {
  const w = prepared();
  try {
    testHooks.failAfterLinks = 1;
    testHooks.afterLink = (target, name) => { if (name === "dataset.jsonl") { fs.renameSync(target, `${target}.moved`); fs.mkdirSync(target); fs.writeFileSync(`${target}.competitor-note`, "the competitor created m/ (empty)"); } };
    const r = run(mergeArgs(w));
    clearHooks();
    assert.equal(r.code, 1); has(r.codes, "WRITE_FAILED", "PUBLICATION_ABANDONED");
    assert.ok(fs.statSync(w.p("m")).isDirectory(), "the competitor's replacement directory still exists");
    assert.deepEqual(listing(w.p("m")), [], "and is untouched");
    assert.deepEqual(listing(w.p("m.moved")), ["dataset.jsonl"], "the moved original is not ours by name any more: left alone");
    assert.ok(!fs.existsSync(w.p(`m/${PUBLICATION_MARKER}`)), "no success marker"); noStaging(w);
  } finally { clearHooks(); cleanup(w); }
});

test("G1-b a competitor's NON-empty replacement directory (even holding a same-named file) is left untouched", () => {
  const w = prepared();
  try {
    testHooks.failAfterLinks = 1;
    testHooks.afterLink = (target, name) => {
      if (name === "dataset.jsonl") { fs.renameSync(target, `${target}.moved`); fs.mkdirSync(target); fs.writeFileSync(path.join(target, "dataset.jsonl"), "COMPETITOR\n"); }
    };
    const r = run(mergeArgs(w));
    clearHooks();
    assert.equal(r.code, 1); has(r.codes, "PUBLICATION_ABANDONED");
    assert.equal(fs.readFileSync(w.p("m/dataset.jsonl"), "utf8"), "COMPETITOR\n"); noStaging(w);
  } finally { clearHooks(); cleanup(w); }
});

test("G1-c a symlink planted at a member name that points at the staged inode is not 'ours' (lstat, not stat)", (t) => {
  const w = prepared();
  try {
    let skipped = false;
    testHooks.failAfterLinks = 1;
    testHooks.afterLink = (target, name) => {
      if (name !== "dataset.jsonl") return;
      const staged = path.join(stagingOf(w, ".m.partial-"), "dataset.jsonl");
      fs.unlinkSync(path.join(target, "dataset.jsonl"));
      if (!trySymlink(staged, path.join(target, "dataset.jsonl"), "file")) { skipped = true; fs.linkSync(staged, path.join(target, "dataset.jsonl")); }
    };
    const r = run(mergeArgs(w));
    clearHooks();
    if (skipped) { t.skip("this OS refuses to create file symlinks (EPERM)"); return; }
    assert.equal(r.code, 1); has(r.codes, "PUBLICATION_ABANDONED");
    assert.ok(fs.lstatSync(w.p("m/dataset.jsonl")).isSymbolicLink(), "the competitor's symlink was not removed"); noStaging(w);
  } finally { clearHooks(); cleanup(w); }
});

test("G1-d the output name replaced by a directory symlink / junction onto a decoy that hard-links the staged inode: the decoy is not touched", (t) => {
  const w = prepared();
  try {
    let skipped = false;
    fs.mkdirSync(w.p("decoy"));
    testHooks.failAfterLinks = 1;
    testHooks.afterLink = (target, name) => {
      if (name !== "dataset.jsonl") return;
      const staged = path.join(stagingOf(w, ".m.partial-"), "dataset.jsonl");
      fs.renameSync(target, `${target}.moved`);
      fs.linkSync(staged, w.p("decoy/dataset.jsonl")); // same inode as ours, reachable through the replaced name
      if (!trySymlink(w.p("decoy"), target, "junction")) { skipped = true; fs.mkdirSync(target); }
    };
    const r = run(mergeArgs(w));
    clearHooks();
    if (skipped) { t.skip("this OS refuses to create directory symlinks / junctions"); return; }
    assert.equal(r.code, 1); has(r.codes, "PUBLICATION_ABANDONED");
    assert.ok(fs.existsSync(w.p("decoy/dataset.jsonl")), "the decoy's file (same inode as ours) was NOT unlinked through the replaced name");
    assert.ok(fs.lstatSync(w.p("m")).isSymbolicLink(), "the replaced name still points where the competitor pointed it"); noStaging(w);
  } finally { clearHooks(); cleanup(w); }
});

test("G1-e failure right after the claim (nothing linked yet) rolls back to nothing; a competitor file written there is kept", () => {
  const w = prepared();
  try {
    testHooks.failAfterLinks = 0;
    const r = run(mergeArgs(w, "m0"));
    clearHooks();
    assert.equal(r.code, 1); assert.deepEqual(r.codes, ["WRITE_FAILED"]);
    assert.ok(!fs.existsSync(w.p("m0")), "the empty directory this run claimed is removed"); noStaging(w);
    // a competitor file dropped into the claimed directory before the failing link loop continues: the directory is kept
    testHooks.failAfterLinks = 1;
    testHooks.afterLink = (target) => fs.writeFileSync(path.join(target, "zz-competitor.txt"), "C\n");
    const r2 = run(mergeArgs(w, "m1"));
    clearHooks();
    assert.equal(r2.code, 1); has(r2.codes, "PUBLICATION_ABANDONED");
    assert.deepEqual(listing(w.p("m1")), ["zz-competitor.txt"], "ours unlinked by identity, the competitor's file and directory kept"); noStaging(w);
  } finally { clearHooks(); cleanup(w); }
});

test("G1-f single-file output: after a source change the output is removed only if it is still OUR inode (a planted symlink is kept)", (t) => {
  const w = prepared();
  try {
    let skipped = false;
    const B0 = fs.readFileSync(w.p("B.jsonl"));
    testHooks.afterLink = (target) => {
      fs.appendFileSync(w.p("B.jsonl"), "\n");
      const tmp = stagingOf(w, ".ag-sym.json.partial-");
      fs.unlinkSync(target);
      if (!trySymlink(tmp, target, "file")) { skipped = true; fs.linkSync(tmp, target); }
    };
    const r = run(agreementArgs(w, "ag-sym.json"));
    clearHooks(); fs.writeFileSync(w.p("B.jsonl"), B0);
    if (skipped) { t.skip("this OS refuses to create file symlinks (EPERM)"); return; }
    assert.equal(r.code, 1); has(r.codes, "SOURCE_CHANGED_DURING_RUN");
    assert.ok(fs.lstatSync(w.p("ag-sym.json")).isSymbolicLink(), "the planted symlink was not removed (it is not our inode)");
  } finally { clearHooks(); cleanup(w); }
});

test("G1-g the directory is swapped in the window between this run's own unlinks and the rmdir: the identity is rechecked, the competitor's empty directory survives", () => {
  const w = prepared();
  try {
    testHooks.failAfterLinks = 1;
    testHooks.beforeRollbackRemove = (target) => { fs.renameSync(target, `${target}.moved`); fs.mkdirSync(target); };
    const r = run(mergeArgs(w));
    clearHooks();
    assert.equal(r.code, 1); has(r.codes, "WRITE_FAILED", "PUBLICATION_ABANDONED");
    assert.ok(fs.statSync(w.p("m")).isDirectory(), "the competitor's empty directory was not rmdir'd by name"); assert.deepEqual(listing(w.p("m")), []);
    noStaging(w);
  } finally { clearHooks(); cleanup(w); }
});

test("G1-h the private staging directory is removed only while it is still the directory this run created", () => {
  const w = prepared();
  try {
    testHooks.beforePublish = () => {
      const staging = stagingOf(w, ".m.partial-");
      fs.renameSync(staging, `${staging}.moved`); fs.mkdirSync(staging); fs.writeFileSync(path.join(staging, "keep.txt"), "competitor\n");
    };
    const r = run(mergeArgs(w));
    clearHooks();
    assert.equal(r.code, 1); has(r.codes, "WRITE_FAILED");
    const kept = fs.readdirSync(w.dir).filter((n) => n.startsWith(".m.partial-") && !n.endsWith(".moved"));
    assert.equal(kept.length, 1); assert.deepEqual(listing(path.join(w.dir, kept[0])), ["keep.txt"], "the replacement 'staging' directory was not removed by name");
  } finally { clearHooks(); cleanup(w); }
});

test("G1-i a single-file run's temp file is unlinked only while it is still this run's inode", () => {
  const w = prepared();
  try {
    const B0 = fs.readFileSync(w.p("B.jsonl"));
    testHooks.afterLink = () => {
      fs.appendFileSync(w.p("B.jsonl"), "\n"); // forces the failure path
      const tmp = stagingOf(w, ".ag-tmp.json.partial-");
      fs.unlinkSync(tmp); fs.writeFileSync(tmp, "competitor\n"); // a different file now has the temp name
    };
    const r = run(agreementArgs(w, "ag-tmp.json"));
    clearHooks(); fs.writeFileSync(w.p("B.jsonl"), B0);
    assert.equal(r.code, 1); has(r.codes, "SOURCE_CHANGED_DURING_RUN");
    const tmp = stagingOf(w, ".ag-tmp.json.partial-");
    assert.equal(fs.readFileSync(tmp, "utf8"), "competitor\n", "the competitor's file at the temp name survives");
  } finally { clearHooks(); cleanup(w); }
});

test("G1-j single-file output: after a source change a DIFFERENT regular file that now has the output name is not removed (identity, not name)", () => {
  const w = prepared();
  try {
    const B0 = fs.readFileSync(w.p("B.jsonl"));
    testHooks.afterLink = (target) => { fs.appendFileSync(w.p("B.jsonl"), "\n"); fs.unlinkSync(target); fs.writeFileSync(target, "competitor\n"); };
    const r = run(agreementArgs(w, "ag-swap.json"));
    clearHooks(); fs.writeFileSync(w.p("B.jsonl"), B0);
    assert.equal(r.code, 1); has(r.codes, "SOURCE_CHANGED_DURING_RUN");
    assert.equal(fs.readFileSync(w.p("ag-swap.json"), "utf8"), "competitor\n", "the competitor's file at the output name survives");
  } finally { clearHooks(); cleanup(w); }
});

// ── G2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("G2-a a source changed between the last recheck and the marker link: non-zero exit, PUBLICATION_INVALIDATED, notice written, consumers refuse it", () => {
  const w = prepared();
  try {
    const B0 = fs.readFileSync(w.p("B.jsonl"));
    const r = withMarkerLinkInterposer(() => fs.appendFileSync(w.p("B.jsonl"), "\n"), () => run(mergeArgs(w)));
    assert.equal(r.code, 1, "a success exit (0 or 3) can never coexist with a detected source change");
    has(r.codes, "SOURCE_CHANGED_DURING_RUN", "PUBLICATION_INVALIDATED");
    assert.ok(r.out.some((l) => l.includes("SOURCE_CHANGED_DURING_RUN") && l.includes("after the success marker was linked")));
    assert.ok(fs.existsSync(w.p(`m/${INVALIDATION_NOTICE}`)), "the invalidation is recorded in the bundle"); noStaging(w);
    fs.writeFileSync(w.p("B.jsonl"), B0);
    const d = run(acceptanceDraftArgs(w, "draft.json", { m: "m" }));
    assert.equal(d.code, 1); has(d.codes, "PUBLICATION_INVALIDATED"); assert.ok(!fs.existsSync(w.p("draft.json")));
    // the invalidated name is never reused; a new directory works once the source is stable again
    assert.deepEqual(run(mergeArgs(w, "m")).codes, ["OUTPUT_EXISTS"]);
    assert.ok([0, 3].includes(run(mergeArgs(w, "m-new")).code));
  } finally { clearHooks(); cleanup(w); }
});

test("G2-b the invalidation is recorded only in the directory THIS run claimed: a replaced directory gets no notice, the command still fails", () => {
  const w = prepared();
  try {
    const r = withMarkerLinkInterposer((dest) => {
      fs.appendFileSync(w.p("B.jsonl"), "\n");
      const target = path.dirname(dest);
      fs.renameSync(target, `${target}.moved`); fs.mkdirSync(target); // the marker link below lands in the competitor's directory
    }, () => run(mergeArgs(w)));
    assert.equal(r.code, 1); has(r.codes, "PUBLICATION_INVALIDATED");
    assert.ok(r.out.some((l) => l.includes("could NOT be recorded")), r.out.join("\n"));
    assert.ok(!fs.existsSync(w.p(`m/${INVALIDATION_NOTICE}`)), "no write into a directory this run does not own");
  } finally { clearHooks(); cleanup(w); }
});

test("G2-c RESIDUAL (pinned, stated in the header): a change after the LAST recheck is not detected by the publishing run; the output still names the bytes used", () => {
  const w = prepared();
  try {
    testHooks.afterPublish = touchOnce(w.p("B.jsonl")); // the hook fires after the final recheck
    const r = run(mergeArgs(w, "m-late"));
    clearHooks();
    assert.equal(r.code, 3, "no lock / immutable source store: this window is open and documented");
    assert.ok(fs.existsSync(w.p(`m-late/${PUBLICATION_MARKER}`))); assert.ok(!fs.existsSync(w.p(`m-late/${INVALIDATION_NOTICE}`)));
    assert.equal(readJson(w.p("m-late/merge-manifest.json")).inputs.annotatorBSha256, readJson(w.p("subs.json")).annotatorB.sha256);
  } finally { clearHooks(); cleanup(w); }
});

test("G2-d single-file outputs: a change before the link is detected after staging, after the link the file is removed (own inode) — unchanged contract", () => {
  const w = prepared();
  try {
    const B0 = fs.readFileSync(w.p("B.jsonl"));
    testHooks.afterLink = touchOnce(w.p("B.jsonl"));
    const r = run(agreementArgs(w, "ag-late.json"));
    clearHooks(); fs.writeFileSync(w.p("B.jsonl"), B0);
    assert.equal(r.code, 1); has(r.codes, "SOURCE_CHANGED_DURING_RUN"); assert.ok(!fs.existsSync(w.p("ag-late.json"))); noStaging(w);
  } finally { clearHooks(); cleanup(w); }
});

// ── G3 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const editMarker = (dir: string, f: (o: Obj) => void) => { const p = path.join(dir, PUBLICATION_MARKER); const o = readJson(p); f(o); writeJson(p, o); };
/** Copies the genuine prepare bundle to prep2, lets the attacker change it, then asks accept-submissions to consume it. */
const forgedPrepare = (w: Ws, mutate: (dir: string) => void) => { fs.cpSync(w.p("prep"), w.p("prep2"), { recursive: true }); mutate(w.p("prep2")); return run(acceptArgs(w, "subs2.json", "prep2")); };
const refused = (w: Ws, r: { code: number; codes: string[] }, ...codes: string[]) => { assert.equal(r.code, 1); has(r.codes, ...codes); assert.ok(!fs.existsSync(w.p("subs2.json")), "nothing accepted from an inconsistent bundle"); };

const PREPARE_CASES: Array<[string, string[], (dir: string) => void]> = [
  ["zeroed hashes in the marker", ["PUBLICATION_HASH_INVALID"], (d) => editMarker(d, (o) => { for (const f of o.files) f.sha256 = "0".repeat(64); })],
  ["malformed (non-hex) hash", ["PUBLICATION_HASH_INVALID"], (d) => editMarker(d, (o) => { o.files[0].sha256 = "xyz"; })],
  ["missing hash field", ["PUBLICATION_MARKER_MALFORMED"], (d) => editMarker(d, (o) => { delete o.files[0].sha256; })],
  ["well-formed but wrong hash", ["PUBLICATION_HASH_MISMATCH"], (d) => editMarker(d, (o) => { o.files[2].sha256 = "1".repeat(64); })],
  ["marker lists only some members (hand-written one-file marker)", ["PUBLICATION_MEMBER_MISSING"], (d) => editMarker(d, (o) => { o.files = o.files.slice(2); })],
  ["marker lists an extra member", ["PUBLICATION_MEMBER_EXTRA"], (d) => editMarker(d, (o) => { o.files.push({ name: "extra.jsonl", sha256: "a".repeat(64) }); })],
  ["an extra file on disk", ["PUBLICATION_MEMBER_EXTRA"], (d) => fs.writeFileSync(path.join(d, "extra.txt"), "x\n")],
  ["a listed member missing on disk", ["PUBLICATION_MEMBER_MISSING"], (d) => fs.rmSync(path.join(d, "for-annotator-B.jsonl"))],
  ["a member that is a directory, not a file", ["PUBLICATION_MEMBER_MISSING"], (d) => { fs.rmSync(path.join(d, "for-annotator-B.jsonl")); fs.mkdirSync(path.join(d, "for-annotator-B.jsonl")); }],
  ["a task file edited after publication (a sibling the consumer does not read)", ["PUBLICATION_HASH_MISMATCH"], (d) => fs.appendFileSync(path.join(d, "for-annotator-A.jsonl"), "\n")],
  ["the consumed receipt edited after publication", ["PUBLICATION_HASH_MISMATCH"], (d) => fs.appendFileSync(path.join(d, "prepare-manifest.json"), " ")],
  ["marker is not JSON", ["PUBLICATION_MARKER_MALFORMED"], (d) => fs.writeFileSync(path.join(d, PUBLICATION_MARKER), "not json")],
  ["marker is a JSON array", ["PUBLICATION_MARKER_MALFORMED"], (d) => fs.writeFileSync(path.join(d, PUBLICATION_MARKER), "[]")],
  ["marker kind is wrong", ["PUBLICATION_MARKER_MALFORMED"], (d) => editMarker(d, (o) => { o.kind = "something-else"; })],
  ["marker tool is wrong", ["PUBLICATION_MARKER_MALFORMED"], (d) => editMarker(d, (o) => { o.tool = "another-tool"; })],
  ["marker schemaVersion is wrong", ["PUBLICATION_MARKER_MALFORMED"], (d) => editMarker(d, (o) => { o.schemaVersion = "v0"; })],
  ["marker has an unexpected field", ["PUBLICATION_MARKER_MALFORMED"], (d) => editMarker(d, (o) => { o.extra = true; })],
  ["marker files is not a list", ["PUBLICATION_MARKER_MALFORMED"], (d) => editMarker(d, (o) => { o.files = { a: 1 }; })],
  ["marker lists a member twice", ["PUBLICATION_MARKER_MALFORMED"], (d) => editMarker(d, (o) => { o.files.push({ ...o.files[0] }); })],
  ["marker is a directory", ["PUBLICATION_MARKER_MALFORMED"], (d) => { fs.rmSync(path.join(d, PUBLICATION_MARKER)); fs.mkdirSync(path.join(d, PUBLICATION_MARKER)); }],
  ["no marker at all (interrupted / foreign output)", ["PUBLICATION_INCOMPLETE"], (d) => fs.rmSync(path.join(d, PUBLICATION_MARKER))],
  ["an invalidation notice is present", ["PUBLICATION_INVALIDATED"], (d) => fs.writeFileSync(path.join(d, INVALIDATION_NOTICE), "{}\n")],
];
for (const [name, codes, mutate] of PREPARE_CASES) {
  test(`G3-prepare ${name}: refused with ${codes.join(",")}`, () => {
    const w = workspace();
    try { run(prepareArgs(w)); refused(w, forgedPrepare(w, mutate), ...codes); } finally { cleanup(w); }
  });
}

test("G3-foreign the Codex reproducer: a hand-written one-file marker beside a copied receipt is refused (member set + hashes)", () => {
  const w = workspace();
  try {
    run(prepareArgs(w));
    fs.mkdirSync(w.p("foreign")); fs.copyFileSync(w.p("prep/prepare-manifest.json"), w.p("foreign/prepare-manifest.json"));
    fs.writeFileSync(w.p("foreign/PUBLISHED.json"), JSON.stringify({ kind: "m7-p5a2-publication", files: [{ name: "prepare-manifest.json" }] }));
    const r = run(acceptArgs(w, "subs-foreign.json", "foreign"));
    assert.equal(r.code, 1); has(r.codes, "PUBLICATION_MARKER_MALFORMED"); assert.ok(!fs.existsSync(w.p("subs-foreign.json")));
  } finally { cleanup(w); }
});

test("G3-kind a member of the OTHER bundle kind (or a renamed file) is never consumed as a prepare receipt", () => {
  const w = workspace();
  try {
    const key = pipeline(w); void key;
    const args = acceptArgs(w, "subs-kind.json"); args[args.indexOf("--prepare-manifest") + 1] = w.p("m/merge-manifest.json");
    const r = run(args);
    assert.equal(r.code, 1); has(r.codes, "PUBLICATION_MEMBER_EXTRA"); assert.ok(!fs.existsSync(w.p("subs-kind.json")));
  } finally { cleanup(w); }
});

test("G3-positive a genuine bundle (and a byte-for-byte copy of it) is accepted; the marker is NOT authentication, a re-sealed forgery passes THIS check", () => {
  const w = workspace();
  try {
    run(prepareArgs(w));
    assert.equal(run(acceptArgs(w)).code, 0);
    fs.cpSync(w.p("prep"), w.p("prep-copy"), { recursive: true });
    assert.equal(run(acceptArgs(w, "subs-copy.json", "prep-copy")).code, 0);
    // a forger who controls the directory re-seals the marker consistently: the marker check cannot tell (consistency, not authenticity)
    fs.cpSync(w.p("prep"), w.p("prep-forged"), { recursive: true });
    const rc = readJson(w.p("prep-forged/prepare-manifest.json")); rc.questions[0].writerKey = "owner01";
    writeJson(w.p("prep-forged/prepare-manifest.json"), rc); reseal(w.p("prep-forged"));
    const r = run(acceptArgs(w, "subs-forged.json", "prep-forged"));
    assert.ok(!r.codes.some((c) => c.startsWith("PUBLICATION_")), "the marker stage passes");
    has(r.codes, "RECEIPT_INCONSISTENT"); // the content checks (the receipt's own batchId) still refuse this particular forgery
  } finally { cleanup(w); }
});

const MERGE_CASES: Array<[string, string[], (dir: string) => void]> = [
  ["zeroed hashes", ["PUBLICATION_HASH_INVALID"], (d) => editMarker(d, (o) => { for (const f of o.files) f.sha256 = "0".repeat(64); })],
  ["a member dropped from the marker", ["PUBLICATION_MEMBER_MISSING"], (d) => editMarker(d, (o) => { o.files = o.files.slice(1); })],
  ["an extra file on disk", ["PUBLICATION_MEMBER_EXTRA"], (d) => fs.writeFileSync(path.join(d, "notes.txt"), "x\n")],
  ["the dataset edited after publication", ["PUBLICATION_HASH_MISMATCH"], (d) => fs.appendFileSync(path.join(d, "dataset.jsonl"), "\n")],
  ["marker malformed", ["PUBLICATION_MARKER_MALFORMED"], (d) => fs.writeFileSync(path.join(d, PUBLICATION_MARKER), "{")],
  ["a prepare-kind member set", ["PUBLICATION_MEMBER_EXTRA", "PUBLICATION_MEMBER_MISSING"], (d) => editMarker(d, (o) => { o.files = [{ name: "for-annotator-A.jsonl", sha256: "b".repeat(64) }]; })],
];
for (const [name, codes, mutate] of MERGE_CASES) {
  test(`G3-merge ${name}: acceptance-draft refuses the merge bundle with ${codes.join(",")}`, () => {
    const w = workspace();
    try {
      pipeline(w);
      fs.cpSync(w.p("m"), w.p("m2"), { recursive: true }); mutate(w.p("m2"));
      const r = run(acceptanceDraftArgs(w, "draft2.json", { m: "m2" }));
      assert.equal(r.code, 1); has(r.codes, ...codes); assert.ok(!fs.existsSync(w.p("draft2.json")));
    } finally { cleanup(w); }
  });
}
test("G3-merge-positive the genuine merge bundle is consumed", () => {
  const w = workspace();
  try { pipeline(w); assert.ok([0, 3].includes(run(acceptanceDraftArgs(w, "draft.json")).code)); assert.ok(fs.existsSync(w.p("draft.json"))); } finally { cleanup(w); }
});

test("G3-recheck the marker is part of the rechecks: edited, then deleted, between the check and publication => PUBLICATION_MARKER_CHANGED, nothing published", () => {
  const w = workspace();
  try {
    run(prepareArgs(w));
    for (const [name, change] of [["edited", () => fs.appendFileSync(w.p("prep/PUBLISHED.json"), "\n")], ["deleted", () => fs.rmSync(w.p("prep/PUBLISHED.json"))]] as const) {
      const saved = fs.readFileSync(w.p("prep/PUBLISHED.json"));
      testHooks.beforePublish = change;
      const r = run(acceptArgs(w, `subs-${name}.json`));
      clearHooks(); fs.writeFileSync(w.p("prep/PUBLISHED.json"), saved);
      assert.equal(r.code, 1, name); has(r.codes, "PUBLICATION_MARKER_CHANGED"); assert.ok(!fs.existsSync(w.p(`subs-${name}.json`)), name); noStaging(w);
    }
    // the same for a bundle output (merge): marker changed while the members are being linked => rolled back, nothing published
    run(acceptArgs(w));
    const saved = fs.readFileSync(w.p("prep/PUBLISHED.json"));
    testHooks.afterLink = touchOnce(w.p("prep/PUBLISHED.json"));
    const r = run(mergeArgs(w, "m-mk"));
    clearHooks(); fs.writeFileSync(w.p("prep/PUBLISHED.json"), saved);
    assert.equal(r.code, 1); has(r.codes, "PUBLICATION_MARKER_CHANGED"); assert.ok(!fs.existsSync(w.p("m-mk"))); noStaging(w);
    // and AFTER the output's own marker was linked (G2 + G3 together)
    const r2 = withMarkerLinkInterposer(() => fs.appendFileSync(w.p("prep/PUBLISHED.json"), "\n"), () => run(mergeArgs(w, "m-mk2")));
    fs.writeFileSync(w.p("prep/PUBLISHED.json"), saved);
    assert.equal(r2.code, 1); has(r2.codes, "PUBLICATION_MARKER_CHANGED", "PUBLICATION_INVALIDATED");
  } finally { clearHooks(); cleanup(w); }
});

test("G3-sha a published marker records the sha256 of exactly the bytes on disk, in member order, for both bundle kinds", () => {
  const w = workspace();
  try {
    pipeline(w);
    for (const [dir, names] of [["prep", ["for-annotator-A.jsonl", "for-annotator-B.jsonl", "prepare-manifest.json"]], ["m", ["dataset.jsonl", "adjudication.jsonl", "merge-manifest.json"]]] as const) {
      const o = readJson(w.p(`${dir}/${PUBLICATION_MARKER}`));
      assert.deepEqual(o.files.map((f: Obj) => f.name), names);
      for (const f of o.files) assert.equal(f.sha256, sha(w.p(`${dir}/${f.name}`)));
      assert.deepEqual(listing(w.p(dir)), [...names, PUBLICATION_MARKER].sort());
    }
  } finally { cleanup(w); }
});

test("G3-bytes-read the consumed member is compared by the bytes this run actually READ, so a change after the read is reported as a source change, not a marker mismatch", () => {
  const w = workspace();
  try {
    run(prepareArgs(w));
    testHooks.afterLoad = (file) => { if (file.endsWith("prepare-manifest.json")) { testHooks.afterLoad = undefined; fs.appendFileSync(file, " "); } };
    const r = run(acceptArgs(w, "subs-read.json"));
    clearHooks();
    assert.equal(r.code, 1); has(r.codes, "SOURCE_CHANGED_DURING_RUN"); assert.ok(!r.codes.includes("PUBLICATION_HASH_MISMATCH"), r.codes.join());
    assert.ok(!fs.existsSync(w.p("subs-read.json")));
  } finally { clearHooks(); cleanup(w); }
});

test("G3-symlink-member a member that is a symlink to a byte-identical copy is not a regular file: refused (symlinks are never followed)", (t) => {
  const w = workspace();
  try {
    run(prepareArgs(w));
    fs.cpSync(w.p("prep"), w.p("prep2"), { recursive: true });
    fs.copyFileSync(w.p("prep2/for-annotator-B.jsonl"), w.p("copy-of-B.jsonl")); fs.rmSync(w.p("prep2/for-annotator-B.jsonl"));
    if (!trySymlink(w.p("copy-of-B.jsonl"), w.p("prep2/for-annotator-B.jsonl"), "file")) { t.skip("this OS refuses to create file symlinks (EPERM)"); return; }
    refused(w, run(acceptArgs(w, "subs2.json", "prep2")), "PUBLICATION_MEMBER_MISSING");
  } finally { cleanup(w); }
});
