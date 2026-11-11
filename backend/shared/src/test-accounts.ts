/**
 * One definition of a "test account", shared by every service.
 *
 * A test account is an email on a reserved, never-deliverable domain (RFC 2606 / RFC 6761, plus the mDNS `.local`):
 * the TLDs .test / .example / .invalid / .localhost / .local and the domains example.com / .net / .org. Every seeder,
 * harness and E2E script in this repo already uses one of them (gymini-test.local, seed.gymini.test, example.com,
 * demo.gymini.invalid, partner-e2e.test, ...). Nobody can receive mail there, so treating them as test accounts can
 * never block or hide a real user — which is why the rule is the domain only, never a "test" word in the local part.
 */
const RESERVED_TLDS = new Set(["test", "example", "invalid", "localhost", "local"]);
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

export function isTestAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
  if (!domain) return false;
  if (RESERVED_DOMAINS.has(domain) || [...RESERVED_DOMAINS].some((d) => domain.endsWith(`.${d}`))) return true;
  return RESERVED_TLDS.has(domain.slice(domain.lastIndexOf(".") + 1));
}

/**
 * Whether this process must refuse to CREATE test accounts. On by default on AWS Lambda (the deployed server), off in
 * local/dev/test stacks so the repo's own suites keep working. Overrides: TEST_ACCOUNTS_POLICY=block forces it on
 * anywhere; TEST_ACCOUNTS_POLICY=allow turns it off on the server (a deliberate, temporary smoke test only).
 */
export function testAccountsBlocked(env: NodeJS.ProcessEnv = process.env): boolean {
  const policy = (env.TEST_ACCOUNTS_POLICY ?? "").trim().toLowerCase();
  if (policy === "block") return true;
  if (policy === "allow") return false;
  return Boolean(env.AWS_LAMBDA_FUNCTION_NAME);
}

export const TEST_ACCOUNT_BLOCKED_MESSAGE = "Email này thuộc tên miền dành cho thử nghiệm và không thể dùng để tạo tài khoản. Vui lòng dùng địa chỉ email thật.";
