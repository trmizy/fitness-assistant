"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { summarize, render } = require("./cost-report.cjs");

const day = (date, groups) => ({
  TimePeriod: { Start: date, End: date },
  Groups: Object.entries(groups).map(([k, v]) => ({ Keys: [k], Metrics: { UnblendedCost: { Amount: String(v) } } })),
});

test("sums per day, per service and in total; services sorted by cost", () => {
  const s = summarize([day("2026-11-20", { RDS: 5, NAT: 1 }), day("2026-11-21", { RDS: 2.5, Secrets: 0.25 })]);
  assert.deepEqual(s.days, [["2026-11-20", 6], ["2026-11-21", 2.75]]);
  assert.deepEqual(s.services.map(([n]) => n), ["RDS", "NAT", "Secrets"]);
  assert.equal(s.total, 8.75);
});

test("empty or missing results give zeros, never throw", () => {
  assert.deepEqual(summarize([]), { days: [], services: [], total: 0 });
  assert.deepEqual(summarize(undefined), { days: [], services: [], total: 0 });
  assert.equal(summarize([{ TimePeriod: { Start: "2026-11-01", End: "2026-11-02" } }]).total, 0);
});

test("render shows the month total, recent days, top N services and the lag warning", () => {
  const month = summarize([day("2026-11-20", { RDS: 5, NAT: 1, S3: 0.1 })]);
  const text = render(month, { days: month.days }, 2);
  assert.match(text, /Month-to-date.*6\.10 USD/);
  assert.match(text, /11-20=6\.10/);
  assert.match(text, /RDS/);
  assert.match(text, /NAT/);
  assert.ok(!/S3/.test(text), "only the top 2 services are listed");
  assert.match(text, /lags ~1 day/);
});
