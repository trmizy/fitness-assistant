// Points the CloudFront chat origin at the CURRENT chat ALB (its DNS name changes every time dev-start recreates the ALB).
// Why a Node script: the aws CLI returns the distribution config as JSON and update-distribution wants the SAME shape back. Windows
// PowerShell 5.1 ConvertTo-Json can flatten single-item arrays, which CloudFront rejects, so the edit is done on the raw JSON here.
//
// Usage: node cloudfront-chat-origin.cjs <get-distribution-config.json> <out-distribution-config.json> <albDns> [originId=chat-alb-origin]
// Output (stdout, one JSON line): { changed, originId, from, to }. Writes <out> ONLY when changed.
// Exit: 0 ok (changed or already current), 2 bad arguments/ALB name, 3 origin missing or ambiguous.
"use strict";
const fs = require("fs");

function patchChatOrigin(getConfigJson, albDns, originId = "chat-alb-origin") {
  if (!/^[a-z0-9-]+\.[a-z0-9-]+\.elb\.amazonaws\.com$/i.test(albDns ?? "")) { const e = new Error(`not an ELB DNS name: ${albDns}`); e.exitCode = 2; throw e; }
  const cfg = getConfigJson?.DistributionConfig;
  const matches = (cfg?.Origins?.Items ?? []).filter((o) => o.Id === originId);
  if (matches.length !== 1) { const e = new Error(`expected exactly one origin '${originId}', found ${matches.length}`); e.exitCode = 3; throw e; }
  const origin = matches[0], from = origin.DomainName;
  if (from === albDns) return { changed: false, originId, from, to: albDns, config: cfg };
  origin.DomainName = albDns;
  return { changed: true, originId, from, to: albDns, config: cfg };
}
module.exports = { patchChatOrigin };

if (require.main === module) {
  const [inFile, outFile, albDns, originId] = process.argv.slice(2);
  try {
    if (!inFile || !outFile || !albDns) { const e = new Error("usage: cloudfront-chat-origin.cjs <in.json> <out.json> <albDns> [originId]"); e.exitCode = 2; throw e; }
    const r = patchChatOrigin(JSON.parse(fs.readFileSync(inFile, "utf8").replace(/^﻿/, "")), albDns, originId);
    if (r.changed) fs.writeFileSync(outFile, JSON.stringify(r.config));
    console.log(JSON.stringify({ changed: r.changed, originId: r.originId, from: r.from, to: r.to }));
  } catch (e) { console.error(String(e.message)); process.exit(e.exitCode ?? 1); }
}
