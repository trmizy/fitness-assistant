/**
 * Phase 4.7R6A.2 — `human-audit`: validate ONE human annotator's file (A01) + provenance + attestation.
 *
 *   npx tsx src/scripts/routingSingleAudit.ts --annotator=A01 --annotation=pilot_A01.csv --provenance=pilot_A01.provenance.json \
 *       --attestation=attestation_A01.md --batch=pilot_batch.csv --freeze=ANNOTATION_GUIDELINES_V1.freeze.json [--manifest=out.json]
 *
 * Output never contains agreement / kappa / disagreement / adjudication (single annotator = no inter-annotator evidence).
 * The two-human `human-intake` command in routingAnnotationTool.ts is NOT changed and still fails closed without A02.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseCsv, forbiddenColumns } from "../llm/query-routing-data/routing-data-tools";
import { auditAnnotationFile, canonicalBatchHash, checkSameBatch, validateHumanProvenance, verifyGuidelineFreeze } from "../llm/query-routing-data/routing-provenance";
import { auditSecondaryFields, checkNormalizationDisclosure, descriptiveCounts, validateAttestation } from "../llm/query-routing-data/routing-single-intake";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=") as [string, string]));
const out = (o: object, code: number) => { console.log(JSON.stringify(o, null, 1)); process.exitCode = code; };
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function main() {
  const missing = ["annotation", "provenance", "attestation", "batch", "freeze"].filter((k) => !args[k] || !fs.existsSync(args[k]));
  if (!args.annotator || missing.length) return out({ verdict: "A01_HUMAN_INPUT_NOT_FOUND", missing }, 3);
  const annotatorId = args.annotator;

  const freeze = JSON.parse(fs.readFileSync(args.freeze, "utf8"));
  const g = verifyGuidelineFreeze(freeze, fs.readFileSync(path.join(path.dirname(args.freeze), freeze.file)));
  if (!g.ok) return out({ verdict: "A01_HUMAN_INTAKE_BLOCKED", guidelineHash: "MISMATCH", code: g.code, errors: g.errors }, 3);

  const [bh, ...br] = parseCsv(fs.readFileSync(args.batch, "utf8"));
  const batch = br.map((r) => ({ id: r[bh.indexOf("id")], text: r[bh.indexOf("text")] }));
  const batchHash = canonicalBatchHash(batch);

  const [head, ...rest] = parseCsv(fs.readFileSync(args.annotation, "utf8"));
  const bad = forbiddenColumns(head);
  if (bad.length) return out({ verdict: "A01_HUMAN_INTAKE_BLOCKED", privacyAudit: "FAIL", forbiddenColumns: bad }, 3);
  const rows = rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))) as Array<Record<string, string>>;

  const provJson = JSON.parse(fs.readFileSync(args.provenance, "utf8"));
  const prov = validateHumanProvenance(provJson, { annotatorId, batchHash, guidelineVersion: freeze.version, guidelineHash: freeze.sha256 });
  const disclosure = checkNormalizationDisclosure(provJson.notes);
  const att = validateAttestation(fs.readFileSync(args.attestation, "utf8"), annotatorId);
  const audit = auditAnnotationFile(rows, head, batch, annotatorId);
  const rowsAsBatch = rows.map((r) => ({ id: r.id, text: r.text }));
  const sameBatch = checkSameBatch(batch, rowsAsBatch, rowsAsBatch);
  const secondary = auditSecondaryFields(rows);

  const warnings: string[] = [];
  const start = provJson.annotationTimestampRange?.start;
  if (start && Date.parse(start) < Date.parse("2026-10-11T00:00:00+07:00"))
    warnings.push(`annotationTimestampRange.start (${start}) precedes the batch/guideline creation date 2026-10-11; recorded as declared, not altered`);

  const gates = { provenance: prov, normalizationDisclosure: disclosure, attestation: att, annotationAudit: audit, batchIntegrity: sameBatch, secondaryFields: secondary };
  const pass = Object.values(gates).every((x) => x.ok);
  const fileHashes = { annotation: sha(args.annotation), provenance: sha(args.provenance), attestation: sha(args.attestation) };
  const result = {
    authority: pass ? "SINGLE_HUMAN_ANNOTATOR_VALIDATED" : "NONE",
    verdict: pass ? "A01_HUMAN_INTAKE_PASS" : "A01_HUMAN_INTAKE_BLOCKED",
    annotator: annotatorId,
    rows: rows.length,
    uniqueIds: new Set(rows.map((r) => r.id)).size,
    annotatorValues: [...new Set(rows.map((r) => r.annotator))],
    guidelineHash: "PASS",
    batchIntegrity: sameBatch.ok ? "PASS" : "FAIL",
    provenance: prov.ok && disclosure.ok ? "PASS" : "FAIL",
    attestation: att.ok ? "PASS" : "FAIL",
    privacyAudit: "PASS",
    secondaryFields: secondary.ok ? "PASS" : "FAIL",
    primaryLabels: "UNCHANGED (read-only validation)",
    nextRequiredAnnotator: annotatorId === "A01" ? "A02" : "A01",
    agreement: "NOT_AVAILABLE", kappa: "NOT_AVAILABLE", disagreementTable: "NOT_AVAILABLE", adjudication: "NOT_RUN", R6B: "NOT_READY",
    batchHash, guidelineSha256: freeze.sha256, fileHashes,
    descriptiveCounts: { safetyLabel: descriptiveCounts(rows, "safetyLabel"), programmingLabel: descriptiveCounts(rows, "programmingLabel") },
    warnings, gates,
  };
  if (pass && args.manifest) {
    fs.writeFileSync(args.manifest, JSON.stringify({
      annotatorId, authority: "SINGLE_HUMAN_ANNOTATOR_VALIDATED", projectState: "A01_HUMAN_VALIDATED_AWAITING_A02",
      note: "single annotator only; NOT inter-annotator evidence; agreement / kappa / adjudication not available; primary labels are immutable raw evidence",
      rowCount: result.rows, uniqueIdCount: result.uniqueIds, batchHash, guidelineVersion: freeze.version, guidelineHash: freeze.sha256,
      annotationFileHash: fileHashes.annotation, provenanceFileHash: fileHashes.provenance, attestationFileHash: fileHashes.attestation,
      auditStatus: "PASS", normalizationDisclosure: provJson.notes, warnings, validatedAt: new Date().toISOString(),
    }, null, 2));
  }
  out(result, pass ? 0 : 3);
}
main();
