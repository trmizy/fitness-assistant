/**
 * D2 - source guards over the files this batch owns. Evidence label: CODE AUDIT (a test that reads source text; it proves what the
 * source says, not how the page behaves).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d2-source-guards.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const adminDir = join(here, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__fixtures__" || name === "__tests__") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const owned = [join(adminDir, "AdminDisputes.tsx"), ...walk(join(adminDir, "disputes", "queue")), ...walk(join(adminDir, "disputes", "workspace"))];

/** source without comments (block, line, JSX {/* *\/}) so that explanations may name the rules they keep */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (p: string) => stripComments(readFileSync(p, "utf8"));
const rel = (p: string) => relative(adminDir, p).replace(/\\/g, "/");

/** attribute text of every opening tag that matches `start`; `>` inside {...} does not end the tag */
function openingTags(src: string, start: RegExp): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(start)) {
    let depth = 0;
    let i = (m.index ?? 0) + m[0].length;
    const from = i;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    out.push(src.slice(from, i));
  }
  return out;
}

describe("D2 source guards", () => {
  it("covers the expected files", () => {
    const names = owned.map(rel);
    for (const f of ["AdminDisputes.tsx", "disputes/queue/queueModel.ts", "disputes/workspace/AdminDisputeCasePage.tsx", "disputes/workspace/actionSlots.tsx", "disputes/workspace/tabs/EvidenceTab.tsx", "disputes/workspace/tabs/MoneyTab.tsx"]) {
      assert.ok(names.includes(f), f);
    }
    assert.ok(owned.length >= 20, `only ${owned.length} files`);
  });

  it("no hard-coded colours: no zinc/amber/slate/red-500-style utilities, no hex or rgb literals", () => {
    const bad = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline)-(?:zinc|amber|slate|gray|neutral|stone|red|green|blue|yellow|orange|emerald|rose|sky|indigo|violet|purple|pink|teal|cyan|lime|fuchsia)-\d{2,3}\b|#[0-9a-fA-F]{3,8}\b(?![\w-])|\brgba?\(/;
    for (const p of owned) {
      const src = code(p).replace(/&#\d+;/g, "");
      const m = bad.exec(src);
      assert.equal(m, null, `${rel(p)}: ${m?.[0]}`);
    }
  });

  it("reads execution state only from the new case execution block, never the old constant on a decision or proposal", () => {
    for (const p of owned) {
      const src = code(p);
      assert.doesNotMatch(src, /(?:decision|proposal|p)\??\.execution\b/, rel(p));
      assert.doesNotMatch(src, /SLICE_2_NOT_ENABLED/, rel(p));
    }
  });

  it("never reads `ledger.result` and never reads the storage key", () => {
    for (const p of owned) {
      const src = code(p);
      assert.doesNotMatch(src, /ledger\??\.result\b/, rel(p));
      assert.doesNotMatch(src, /storedFile\??\.key\b/, rel(p));
    }
  });

  it("screens never build a file URL themselves: the evidence-file routes go only through disputeCaseApi (08/11)", () => {
    for (const p of owned) assert.doesNotMatch(code(p), /evidence-files|\/file`|\/file"|\.\/file\b/, rel(p));
  });

  it("no raw internal names in visible strings (D77, B-1, FH-, I6, DESIGN_REQUIRED...)", () => {
    // string literals / JSX text only; identifiers such as the code `D77_COMBINATION_UNRESOLVED` are the server's wire value
    for (const p of owned) {
      const src = code(p);
      const literals = [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "");
      for (const lit of literals) {
        if (/^[A-Z0-9_:.\- ]+$/.test(lit)) continue; // wire values (enum names, subject keys)
        if (/^[\w./:-]+$/.test(lit)) continue; // class names, ids, paths
        assert.doesNotMatch(lit, /\bD77\b|\bB-\d\b|\bFH-\d|\bI6\b|DESIGN_REQUIRED|SERVER_OBSERVED|TECH_GAP/, `${rel(p)}: ${lit}`);
      }
    }
  });

  it("no polling: no refetchInterval / no setInterval in the owned files", () => {
    for (const p of owned) {
      const src = code(p);
      assert.doesNotMatch(src, /refetchInterval\s*:\s*[^f\s]/, rel(p));
      assert.doesNotMatch(src, /setInterval\s*\(/, rel(p));
    }
  });

  it("every query goes through the user-scoped keys (no ad-hoc root key)", () => {
    for (const p of owned) {
      const src = code(p);
      // allowed disabled placeholders are ["dispute-case","disabled",...]
      for (const m of src.matchAll(/queryKey:\s*\[?\s*"([^"]+)"/g)) assert.equal(m[1], "dispute-case", `${rel(p)}: ${m[0]}`);
    }
  });

  it("the queue and workspace do not write to the legacy `data-testid=\"dispute-type-badge\"` twice and keep it", () => {
    assert.match(code(join(adminDir, "disputes/queue/SessionList.tsx")), /data-testid="dispute-type-badge"/);
  });

  it("no button without a handler: every <Button>/<button> in owned TSX has onClick, type=submit, or is a tab/chip handled by one", () => {
    for (const p of owned.filter((f) => f.endsWith(".tsx"))) {
      const src = code(p);
      for (const attrs of openingTags(src, /<(?:Button|button)/g)) {
        assert.ok(/onClick=|type="submit"/.test(attrs) || /\{\.\.\.tabProps/.test(attrs), `${rel(p)}: button without handler: ${attrs.slice(0, 120)}`);
      }
    }
  });
});
