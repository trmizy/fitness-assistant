/**
 * Unit conversion for onboarding's body-metric inputs — ported verbatim from web's
 * `utils/units.ts` (the four body-metric functions; the distance/energy ones join with the screens
 * that use them).
 *
 * These exist ONLY so onboarding can accept ft/in and lb as INPUT. Everything is converted to and
 * from the same canonical cm/kg the backend stores; nothing else in the app changes units.
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
