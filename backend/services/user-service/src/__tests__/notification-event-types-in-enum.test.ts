import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression (real phone, 7/10): a trainer reported a session as delivered and the client was
 * never told. The code sent `eventType: "SESSION_PENDING_CONFIRMATION"`, a value the Prisma
 * enum did not have, so the insert threw and every caller's `.catch(() => {})` hid it — seven
 * event types had been going nowhere. Any notification type written in this service must be a
 * value of the enum that the notifications table is typed with.
 */

const root = path.resolve(__dirname, "..");
const schema = fs.readFileSync(path.resolve(root, "../prisma/schema.prisma"), "utf8");

function enumValues(name: string): Set<string> {
  const body = schema.match(new RegExp(String.raw`enum ${name} \{([\s\S]*?)\r?\n\}`))?.[1];
  assert.ok(body, `enum ${name} not found in schema.prisma`);
  return new Set(
    body
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter(Boolean),
  );
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return ["generated", "__tests__"].includes(entry.name) ? [] : sourceFiles(full);
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/** Every `notificationService.create({...})` / `deps.notify({...})` object literal in the service. */
function notificationCalls(): { file: string; eventType: string; entityType: string }[] {
  const calls: { file: string; eventType: string; entityType: string }[] = [];
  for (const file of sourceFiles(root)) {
    const text = fs.readFileSync(file, "utf8");
    const opener = /(?:notificationService\s*\.\s*create|deps\.notify)\s*\(\s*\{/g;
    for (let m = opener.exec(text); m; m = opener.exec(text)) {
      const block = text.slice(m.index, text.indexOf("})", m.index));
      const eventType = block.match(/eventType:\s*"([A-Z_]+)"/)?.[1];
      const entityType = block.match(/entityType:\s*"([A-Z_]+)"/)?.[1];
      if (eventType && entityType) calls.push({ file: path.relative(root, file), eventType, entityType });
    }
  }
  return calls;
}

test("every stored notification uses an event type and entity type the database enum has", () => {
  const eventTypes = enumValues("NotificationEventType");
  const entityTypes = enumValues("NotificationEntityType");
  const calls = notificationCalls();
  // The scan itself must keep finding the call sites it exists to guard.
  assert.ok(calls.length >= 20, `expected to find the notification call sites, found ${calls.length}`);
  assert.ok(calls.some((c) => c.eventType === "SESSION_PENDING_CONFIRMATION"));

  const unknown = calls.filter((c) => !eventTypes.has(c.eventType) || !entityTypes.has(c.entityType));
  assert.deepEqual(unknown, []);
});
