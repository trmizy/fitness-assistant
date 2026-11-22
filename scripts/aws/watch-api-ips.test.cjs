"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { newUnknownIps } = require("./watch-api-ips.cjs");

const line = (ip, extra = {}) => ({ ip, time: "22/Nov/2026:12:45:09 +0000", method: "GET", path: "/x", status: "200", ua: "ua", ...extra });

test("allowed IPs are never reported", () => {
  assert.deepEqual(newUnknownIps([line("1.1.1.1"), line("1.1.1.1")], new Set(["1.1.1.1"]), new Set()), []);
});

test("an unknown IP is summarised once with its count, paths, statuses and agents", () => {
  const r = newUnknownIps([line("9.9.9.9", { path: "/a", status: "503" }), line("9.9.9.9", { path: "/b", status: "401", ua: "bot" })], new Set(["1.1.1.1"]), new Set());
  assert.equal(r.length, 1);
  assert.equal(r[0].ip, "9.9.9.9");
  assert.equal(r[0].count, 2);
  assert.deepEqual([...r[0].paths].sort(), ["GET /a", "GET /b"]);
  assert.deepEqual([...r[0].statuses].sort(), ["401", "503"]);
  assert.deepEqual([...r[0].agents].sort(), ["bot", "ua"]);
});

test("an IP already reported in this run is not reported again", () => {
  assert.deepEqual(newUnknownIps([line("9.9.9.9")], new Set(), new Set(["9.9.9.9"])), []);
});

test("lines without an ip are ignored; several unknown IPs give several summaries", () => {
  const r = newUnknownIps([{ path: "/x" }, line("8.8.8.8"), line("7.7.7.7")], new Set(), new Set());
  assert.deepEqual(r.map((s) => s.ip).sort(), ["7.7.7.7", "8.8.8.8"]);
});
