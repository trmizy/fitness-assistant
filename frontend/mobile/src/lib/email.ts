/**
 * Email fields (C1-01). A phone keyboard capitalises the first letter of a field unless told not to,
 * so "Khach@x.com" reached the server as typed and a login that worked on web failed on mobile.
 *
 * Two halves, both needed: the keyboard hints keep the capital from being typed in the first place
 * (`emailInputProps`), and `normalizeEmail` is applied to whatever is sent — typed, pasted or
 * autofilled — so a stray space or capital can never make it past the form.
 *
 * Runs with: ../../node_modules/.bin/tsx --test src/lib/__tests__/email.test.ts
 */

/** Spread onto every `<Input>` that holds an email address. */
export const emailInputProps = {
  keyboardType: "email-address",
  autoCapitalize: "none",
  autoCorrect: false,
  autoComplete: "email",
} as const;

/** Trim and lowercase — the form every email leaves the app in. Tolerates null/undefined. */
export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
