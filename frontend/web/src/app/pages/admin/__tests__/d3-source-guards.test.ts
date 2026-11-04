/**
 * D3 - source guards over the files this batch owns (`disputes/actions/*` and `disputes/workspace/actionSlots.tsx`).
 * Evidence label: CODE AUDIT (a test that reads source text; it proves what the source says, not how the page behaves).
 * Run: npx tsx --test src/app/pages/admin/__tests__/d3-source-guards.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const adminDir = join(here, "..");
const actionsDir = join(adminDir, "disputes", "actions");
const owned = [...readdirSync(actionsDir).filter((n) => /\.(ts|tsx)$/.test(n)).map((n) => join(actionsDir, n)), join(adminDir, "disputes", "workspace", "actionSlots.tsx")];

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const code = (p: string) => stripComments(readFileSync(p, "utf8"));
const rel = (p: string) => relative(adminDir, p).replace(/\\/g, "/");

describe("D3 source guards", () => {
  it("covers the expected files", () => {
    const names = owned.map(rel);
    for (const f of ["disputes/actions/actionModel.ts", "disputes/actions/actionKit.tsx", "disputes/actions/ApprovalActions.tsx", "disputes/actions/ShareForm.tsx", "disputes/workspace/actionSlots.tsx"]) assert.ok(names.includes(f), f);
    assert.ok(owned.length >= 12, `only ${owned.length} files`);
  });

  it("no hard-coded colours (zinc/amber/... utilities, hex, rgb literals)", () => {
    const bad = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline)-(?:zinc|amber|slate|gray|neutral|stone|red|green|blue|yellow|orange|emerald|rose|sky|indigo|violet|purple|pink|teal|cyan|lime|fuchsia)-\d{2,3}\b|#[0-9a-fA-F]{3,8}\b(?![\w-])|\brgba?\(/;
    for (const p of owned) {
      const m = bad.exec(code(p).replace(/&#\d+;/g, ""));
      assert.equal(m, null, `${rel(p)}: ${m?.[0]}`);
    }
  });

  it("never reads the old decision/proposal execution constant, the ledger result or the storage key", () => {
    for (const p of owned) {
      const src = code(p);
      assert.doesNotMatch(src, /(?:decision|proposal|p)\??\.execution\b/, rel(p));
      assert.doesNotMatch(src, /SLICE_2_NOT_ENABLED/, rel(p));
      assert.doesNotMatch(src, /ledger\??\.result\b/, rel(p));
      assert.doesNotMatch(src, /storedFile\??\.key\b/, rel(p));
    }
  });

  it("no evidence-file call (still not proxied)", () => {
    for (const p of owned) {
      const src = code(p);
      assert.doesNotMatch(src, /evidence-files|readEvidenceFile/, rel(p));
    }
  });

  it("the Execution slot is wired to the capability-gated action component", () => {
    const src = code(join(adminDir, "disputes", "workspace", "actionSlots.tsx"));
    assert.match(src, /export function ExecutionActionsSlot\(props: ActionSlotProps\): ReactElement/);
    assert.match(src, /createElement\(ExecutionActions, props\)/);
  });

  it("no body can carry an actor or an amount: no userId / adminId / approvedBy / amount / outcome property is built in the forms", () => {
    for (const p of owned.filter((f) => /Actions\.tsx$|ShareForm\.tsx$|actionKit\.tsx$/.test(f))) {
      const src = code(p);
      assert.doesNotMatch(src, /\b(?:userId|adminId|approvedBy|approverId|proposerId|clientId|amount)\s*:/, rel(p));
    }
    const model = code(join(actionsDir, "actionModel.ts"));
    for (const fn of ["assignBody", "transitionBody", "requestMoreBody", "claimBody", "issueBody", "assessmentBody", "findingBody", "proposalBody", "approvalBody", "shareBody"]) {
      const at = model.indexOf(`function ${fn}`) >= 0 ? model.indexOf(`function ${fn}`) : model.indexOf(`const ${fn}`);
      assert.ok(at >= 0, fn);
      const body = model.slice(at, at + 700);
      assert.doesNotMatch(body, /\b(?:userId|adminId|approvedBy|amount|outcome)\b/, fn);
    }
  });

  it("every write goes through useWrite (idempotent hook) - no direct disputeCaseApi call outside a submit callback", () => {
    for (const p of owned.filter((f) => /Actions\.tsx$|ShareForm\.tsx$/.test(f))) {
      const src = code(p);
      for (const m of src.matchAll(/disputeCaseApi\.(\w+)\(/g)) {
        const before = src.slice(Math.max(0, (m.index ?? 0) - 160), m.index);
        assert.match(before, /\(key(?:, b)?\)\s*=>\s*$|\(key, b\) =>\s*$|\(key: string, b: \{ reason: string \}\) =>\s*$/, `${rel(p)}: disputeCaseApi.${m[1]} is not inside a submit callback`);
      }
    }
  });

  it("no automatic resend and no polling: no setInterval, no refetchInterval, no setTimeout, retry only from a click", () => {
    for (const p of owned) {
      const src = code(p);
      assert.doesNotMatch(src, /setInterval\s*\(|setTimeout\s*\(|refetchInterval\s*:\s*[^f\s]/, rel(p));
    }
    const kit = code(join(actionsDir, "actionKit.tsx"));
    // `retry` / `reload` are only ever wired to onClick handlers of ActionButton
    assert.doesNotMatch(kit, /useEffect\([^)]*(?:retry|submit)\(/, "no effect calls submit/retry");
  });

  it("every <ActionButton> has an onClick; every raw <button> has onClick or type=submit", () => {
    for (const p of owned.filter((f) => f.endsWith(".tsx"))) {
      const src = code(p);
      for (const m of src.matchAll(/<ActionButton\b([\s\S]*?)>/g)) {
        // `=>` inside the props must not end the tag early: look at the opening tag up to the first `>` that is not part of `=>`
        const tag = (m[1] ?? "").replace(/=>/g, "=_");
        assert.ok(/onClick=/.test(tag) || /onClick=/.test(src.slice(m.index ?? 0, (m.index ?? 0) + 400)), `${rel(p)}: ActionButton without onClick: ${tag.slice(0, 100)}`);
      }
      for (const m of src.matchAll(/<button\b([\s\S]*?)>/g)) {
        const tag = (m[1] ?? "").replace(/=>/g, "=_");
        assert.ok(/onClick=|type="submit"|type=\{type\}/.test(tag) || /onClick=/.test(src.slice(m.index ?? 0, (m.index ?? 0) + 300)), `${rel(p)}: button without handler`);
      }
    }
  });

  it("the free-typed investigator id does not exist: the assign form has no text input for an id", () => {
    const src = code(join(actionsDir, "OverviewActions.tsx"));
    const assign = src.slice(src.indexOf("function AssignForm"), src.indexOf("function TransitionCard"));
    assert.doesNotMatch(assign, /<input\b|<TextArea\b|type="text"/);
    assert.match(assign, /listAdminOptions/);
  });

  it("the share forms never offer a second target: one picker, one body builder", () => {
    const src = code(join(actionsDir, "ShareForm.tsx"));
    assert.match(src, /shareBody\(kind, form\)/);
    assert.equal((src.match(/<Select\b/g) ?? []).length, 2, "one target picker + one role picker");
  });

  it("D3 does not import the party-side screens or touch the routes (another worker's files)", () => {
    for (const p of owned) {
      const src = code(p);
      assert.doesNotMatch(src, /from "[./]*pages\/disputes|from "\.\.\/\.\.\/\.\.\/disputes|routes"/, rel(p));
    }
  });

  it("no raw internal names in visible strings (D77, B-1, FH-, I6, DESIGN_REQUIRED...)", () => {
    for (const p of owned) {
      const src = code(p);
      const literals = [...src.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? "");
      for (const lit of literals) {
        if (/^[A-Z0-9_:.\- ]+$/.test(lit)) continue;
        if (/^[\w./:-]+$/.test(lit)) continue;
        assert.doesNotMatch(lit, /\bD77\b|\bB-\d\b|\bFH-\d|\bI6\b|DESIGN_REQUIRED|SERVER_OBSERVED|TECH_GAP|D-NEW/, `${rel(p)}: ${lit}`);
      }
    }
  });

  it("queries stay on the user-scoped root key", () => {
    for (const p of owned) {
      for (const m of code(p).matchAll(/queryKey:\s*\[?\s*"([^"]+)"/g)) assert.equal(m[1], "dispute-case", `${rel(p)}: ${m[0]}`);
    }
    assert.match(code(join(actionsDir, "OverviewActions.tsx")), /queryKey: keys \? \[\.\.\.keys\.all, "admins"\]/);
  });

  it("dialogs: portal + role=dialog + aria-modal + useModalA11y; the safe/dangerous buttons are 44px apart on phones", () => {
    const kit = code(join(actionsDir, "actionKit.tsx"));
    assert.match(kit, /createPortal/);
    assert.match(kit, /role="dialog"/);
    assert.match(kit, /aria-modal="true"/);
    assert.match(kit, /useModalA11y\(/);
    assert.match(kit, /max-sm:gap-11/);
  });
});
