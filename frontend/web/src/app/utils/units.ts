/**
 * Gym-onboarding project follow-up §13 — unit conversion for onboarding's
 * body-metric inputs. Pure functions, no framework dependency, so they're
 * testable with plain node:test (this project has no frontend test runner
 * configured — see units.test.ts's header for why that's the deliberate
 * choice here rather than adding one).
 *
 * The rest of the app (InBody, Profile, backend) is cm/kg-only — these
 * functions exist ONLY to let onboarding accept ft/in and lb as INPUT,
 * always converting to/from the same canonical cm/kg the backend already
 * stores. No internal calculation anywhere else changes.
 */

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

export function cmFromFeetInches(feet: number, inches: number): number {
  const totalInches = feet * 12 + inches;
  return Math.round(totalInches * CM_PER_INCH * 10) / 10; // 1 decimal place
}

export function feetInchesFromCm(cm: number): { feet: number; inches: number } {
  const totalInches = cm / CM_PER_INCH;
  const feet = Math.floor(totalInches / 12);
  // Round inches to the nearest whole inch; carry into feet on overflow
  // (e.g. 71.6 in -> 5ft 11.6in should not display as "5ft 12in").
  let inches = Math.round(totalInches - feet * 12);
  let carriedFeet = feet;
  if (inches >= 12) {
    inches -= 12;
    carriedFeet += 1;
  }
  return { feet: carriedFeet, inches };
}

export function kgFromLb(lb: number): number {
  return Math.round(lb * KG_PER_LB * 10) / 10;
}

export function lbFromKg(kg: number): number {
  return Math.round((kg / KG_PER_LB) * 10) / 10;
}
