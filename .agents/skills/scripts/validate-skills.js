#!/usr/bin/env node
// Zero-dependency validator for .claude/skills/*/SKILL.md.
// Run: node .claude/skills/scripts/validate-skills.js
"use strict";
const fs = require("fs");
const path = require("path");

const skillsDir = path.join(__dirname, "..");
const entries = fs
  .readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "scripts");

const nameRe = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const seenNames = new Set();
let errors = 0;

for (const entry of entries) {
  const dir = path.join(skillsDir, entry.name);
  const skillPath = path.join(dir, "SKILL.md");
  const prefix = `[${entry.name}]`;

  if (!fs.existsSync(skillPath)) {
    console.error(`${prefix} MISSING SKILL.md`);
    errors++;
    continue;
  }

  const raw = fs.readFileSync(skillPath, "utf8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    console.error(`${prefix} No YAML frontmatter found`);
    errors++;
    continue;
  }

  const fm = fmMatch[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);

  if (!nameMatch) {
    console.error(`${prefix} frontmatter missing 'name'`);
    errors++;
  } else {
    const name = nameMatch[1].trim();
    if (name !== entry.name) {
      console.error(`${prefix} frontmatter name "${name}" does not match directory name`);
      errors++;
    }
    if (!nameRe.test(name)) {
      console.error(`${prefix} name "${name}" is not lowercase-hyphen format`);
      errors++;
    }
    if (/claude|anthropic/i.test(name)) {
      console.error(`${prefix} name must not contain "claude" or "anthropic"`);
      errors++;
    }
    if (seenNames.has(name)) {
      console.error(`${prefix} duplicate skill name "${name}"`);
      errors++;
    }
    seenNames.add(name);
  }

  if (!descMatch || !descMatch[1].trim()) {
    console.error(`${prefix} frontmatter missing or empty 'description'`);
    errors++;
  }

  // Verify every `references/...` path mentioned in the body resolves to a real file.
  const refMatches = raw.matchAll(/`(references\/[a-zA-Z0-9_.\/-]+\.md)`/g);
  for (const m of refMatches) {
    const refPath = path.join(dir, m[1]);
    if (!fs.existsSync(refPath)) {
      console.error(`${prefix} references missing file: ${m[1]}`);
      errors++;
    }
  }
}

console.log(`\nChecked ${entries.length} skill(s), ${seenNames.size} unique name(s), ${errors} error(s).`);
process.exit(errors > 0 ? 1 : 0);
