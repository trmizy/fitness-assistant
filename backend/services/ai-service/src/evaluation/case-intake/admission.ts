import { digest } from "../evaluation-kit/identity";
import { convertFrozenIntake, bindIntakeGeneration, IntakeFakeFileSchema } from "./converter";
import { admitD1Candidate, type CandidateDocuments } from "./candidate";

/** Run at the existing file admission boundary; private labels never go to generation. */
export function validateIntakeAdmission(generationValue:unknown,sidecarValue:unknown) {
  const generation=IntakeFakeFileSchema.parse(generationValue);
  if(digest(sidecarValue)!==generation.provenanceHash)throw new Error("IntakeSidecarHashMismatch");
  const sidecar=sidecarValue as ReturnType<typeof convertFrozenIntake>["privateSidecar"] & {candidateAdmission?:{documents:CandidateDocuments;pins:{manifestHash:string}}};
  const base=convertFrozenIntake(sidecar.source.manifest,sidecar.source.canonical,sidecar.source.pins);
  const expected=sidecar.candidateAdmission?admitD1Candidate(base,sidecar.candidateAdmission.documents,sidecar.candidateAdmission.pins):base;
  if(digest(expected.privateSidecar)!==digest(sidecarValue))throw new Error("IntakeSidecarSourceOrClusterMismatch");
  if(digest(bindIntakeGeneration(base.generation,expected.privateSidecar,base.privateSidecar.source.pins.manifestHash))!==digest(generation))throw new Error("IntakeGenerationSourceMismatch");
  return generation;
}
