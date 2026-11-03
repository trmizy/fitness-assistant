/** Offline converter CLI. No server, dataset mutation, provider or runner execution. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { canonical } from "../evaluation-kit/identity";
import { convertFrozenIntake } from "./converter";
import { admitD1Candidate } from "./candidate";

export function convertSnapshotDirectory(snapshotDirectory: string, outputDirectory: string, pins: {manifestHash:string;canonicalHash:string}, candidate?:{directory:string;manifestHash:string}) {
  const source=fs.realpathSync(snapshotDirectory), requested=path.resolve(outputDirectory), target=path.join(fs.realpathSync(path.dirname(requested)),path.basename(requested)), dataRoot=path.resolve(source,"../..");
  const rel=path.relative(dataRoot,target);
  if (!rel || !rel.startsWith(".."+path.sep) && rel!==".." && !path.isAbsolute(rel)) throw new Error("OutputMustBeOutsideOwnerDataset");
  const manifestBytes=fs.readFileSync(path.join(source,"manifest.json")), caseBytes=fs.readFileSync(path.join(source,"cases.canonical.json"));
  const byteHash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
  if (byteHash(caseBytes)!==pins.canonicalHash) throw new Error("IntakeCanonicalBytesMismatch");
  const base=convertFrozenIntake(JSON.parse(manifestBytes.toString("utf8")),JSON.parse(caseBytes.toString("utf8")),pins);
  const readCandidate=(name:string)=>JSON.parse(fs.readFileSync(path.join(candidate!.directory,name),"utf8"));
  const converted=candidate?admitD1Candidate(base,{manifest:readCandidate("manifest.json"),requests:readCandidate("requests.json"),annotations:readCandidate("owner-annotations.exploratory.json")},{manifestHash:candidate.manifestHash}):base;
  // Deliberately refuse an existing output directory; source and prior exports are never overwritten.
  fs.mkdirSync(target);
  fs.mkdirSync(path.join(target,"generation")); fs.mkdirSync(path.join(target,"private"));
  const write=(name:string,value:unknown)=>fs.writeFileSync(path.join(target,name),canonical(value),{flag:"wx"});
  write("generation/cases.fake.json",converted.generation);
  write("private/sidecar.json",converted.privateSidecar);
  write("private/source-byte-hashes.json",{manifestSha256:byteHash(manifestBytes),canonicalSha256:byteHash(caseBytes)});
  write("summary.json",converted.summary);
  return converted.summary;
}
if(require.main===module){
  try {
    const [source,target,manifestHash,canonicalHash,candidateDir,candidateHash,...extra]=process.argv.slice(2);
    if(!source||!target||!manifestHash||!canonicalHash||extra.length||!!candidateDir!==!!candidateHash) throw new Error("USAGE_snapshotDir_newOutputDir_trustedManifestHash_trustedCanonicalHash_optionalCandidateDirAndHash");
    process.stdout.write(JSON.stringify(convertSnapshotDirectory(source,target,{manifestHash,canonicalHash},candidateDir?{directory:candidateDir,manifestHash:candidateHash!}:undefined))+"\n");
  } catch(e) {process.stderr.write(JSON.stringify({error:(e as Error).message})+"\n");process.exitCode=1;}
}
