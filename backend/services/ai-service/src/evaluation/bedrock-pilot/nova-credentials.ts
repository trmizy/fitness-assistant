import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { loadSharedConfigFiles } from "@smithy/core/config";
import { NovaScopeSchema, PilotError } from "./config";
import { assertNovaEndpointEnvironment, assertNovaProfileEndpoint } from "./nova-endpoint";
import { bindNovaAuthority, novaAuthorityContext, novaGuardedCallback, type NovaAuthorityContext } from "./nova-clock";
import { installNovaStsBoundary } from "./nova-sts-boundary";

export interface NovaStaticCredentials { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date }
type Files = Awaited<ReturnType<typeof loadSharedConfigFiles>>;
type Assume = (source: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }, input: ConstructorParameters<typeof AssumeRoleCommand>[0], assertCurrent: () => void) => Promise<NovaStaticCredentials>;
/** Only used with FAKE_TEST_ONLY rehearsal authority or direct unit tests, never supplied by config/CLI. */
export interface NovaCredentialFixture { loadFiles: () => Promise<Files>; assumeRole: Assume; metadataDisabled?: string }
export interface NovaCredentialReceipt { readonly status: "PRE_RESOLVED_NOVA_CREDENTIALS" }
const resolved = new WeakMap<NovaCredentialReceipt, { binding: string; credentials: NovaStaticCredentials; assertCurrent: () => void; authority: NovaAuthorityContext; consumed: boolean; fixture: boolean }>();

const assumeRole: Assume = async (source, input, assertCurrent) => {
  // No default provider, source-profile recursion, environment credentials, IMDS, SSO or background refresh.
  const client = new STSClient({ region: "us-east-1", endpoint: "https://sts.us-east-1.amazonaws.com", credentials: source,
    maxAttempts: 1, useFipsEndpoint: false, useDualstackEndpoint: false, ignoreConfiguredEndpointUrls: true });
  installNovaStsBoundary(client, source.accessKeyId, input, assertCurrent);
  try {
    assertCurrent(); const response = await client.send(new AssumeRoleCommand(input)), c = response.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) throw new PilotError("NOVA_CREDENTIAL_RESPONSE_INVALID");
    const role = /^arn:aws:iam::(\d{12}):role\/(.+)$/.exec(input.RoleArn ?? "");
    const expectedArn = role && `arn:aws:sts::${role[1]}:assumed-role/${role[2].split("/").at(-1)}/${input.RoleSessionName}`;
    if (!expectedArn || response.AssumedRoleUser?.Arn !== expectedArn) throw new PilotError("NOVA_CREDENTIAL_IDENTITY_MISMATCH");
    return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
  } finally { client.destroy(); }
};

/**
 * Safety margin between the end of the credential lease and the STS credential expiration (same 5-minute window the SDK
 * uses before it would refresh). Dispatch is refused once the lease ends; credentials are never refreshed.
 */
export const NOVA_CREDENTIAL_MARGIN_MS = 5 * 60 * 1000;
/**
 * Strict equivalent of a one-hop fromIni AssumeRole profile. Files are read ONCE; provider dispatch uses that snapshot.
 * phaseWindowMs bounds the credential lease to the phase being executed (calls x timeout + slack), so one-hour STS
 * credentials do not have to outlive a multi-hour signed approval; the lease ends at min(validUntil, admission + window).
 */
export async function resolveNovaCredentials(args: { profile: string; binding: string; validUntil: string; assertAuthority: () => void; expiryCategory?: "LiveNotApproved" | "INFERENCE_RELEASE_EXPIRED"; phaseWindowMs?: number; approvalExpiresAt?: string }, fixture?: NovaCredentialFixture): Promise<NovaCredentialReceipt> {
  // ONE authority context per signed admission: shared by this lease, the session's checks and the HTTP boundary.
  const authority = novaAuthorityContext(true), clock = authority.now, until = Date.parse(args.validUntil);
  // Optional separate approval deadline (precedence over the release category); absent = only validUntil is judged.
  const approvalUntil = args.approvalExpiresAt === undefined ? Infinity : Date.parse(args.approvalExpiresAt);
  if (args.phaseWindowMs !== undefined && (!Number.isSafeInteger(args.phaseWindowMs) || args.phaseWindowMs <= 0)) throw new PilotError("NOVA_CREDENTIAL_LEASE_INVALID");
  const leaseEnd = args.phaseWindowMs === undefined ? until : Math.min(until, clock() + args.phaseWindowMs);
  // The (monotonic-projected) clock is observed BEFORE the throwable authority callback (P1). The callback keeps its
  // historical precedence; if it fails with a non-terminal category the observed deadline is still latched.
  const deadlines = (now: number) => {
    if (Number.isNaN(approvalUntil) || now >= approvalUntil) throw new PilotError("LiveNotApproved");
    if (!Number.isFinite(until) || now >= until) throw new PilotError(args.expiryCategory ?? "LiveNotApproved");
  };
  const assertCurrent = () => authority.check((now) => { novaGuardedCallback(authority, args.assertAuthority, () => deadlines(now)); deadlines(now); deadlines(clock()); });
  assertCurrent(); assertNovaEndpointEnvironment();
  if (!NovaScopeSchema.shape.awsProfile.safeParse(args.profile).success) throw new PilotError("NOVA_PROFILE_INVALID");
  if ((fixture?.metadataDisabled ?? process.env.AWS_EC2_METADATA_DISABLED) !== "true") throw new PilotError("NOVA_IMDS_MUST_BE_DISABLED");
  let files: Files;
  try { files = await (fixture?.loadFiles ?? (() => loadSharedConfigFiles({ ignoreCache: true })))(); }
  catch { throw new PilotError("NOVA_CREDENTIAL_RESOLUTION_FAILED"); }
  assertCurrent();
  const profiles = Object.fromEntries([...new Set([...Object.keys(files.configFile), ...Object.keys(files.credentialsFile)])].map(name => [name, { ...files.configFile[name], ...files.credentialsFile[name] }]));
  const p = profiles[args.profile], source = p?.source_profile ? profiles[p.source_profile] : undefined;
  if (p) assertNovaProfileEndpoint(p); if (source) assertNovaProfileEndpoint(source);
  const roleKeys = ["role_arn", "source_profile", "region", "role_session_name", "external_id", "duration_seconds", "output", "use_fips_endpoint", "use_dualstack_endpoint"];
  const sourceKeys = ["aws_access_key_id", "aws_secret_access_key", "region", "output", "use_fips_endpoint", "use_dualstack_endpoint"];
  if (!p || !source || !/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/.test(p.role_arn ?? "") || p.source_profile === args.profile ||
      Object.keys(p).some(k => !roleKeys.includes(k)) || Object.keys(source).some(k => !sourceKeys.includes(k)) ||
      !source.aws_access_key_id || !source.aws_secret_access_key || [p.region, source.region].some(r => r && r !== "us-east-1")) throw new PilotError("NOVA_CREDENTIAL_PROFILE_UNSUPPORTED");
  const duration = Number(p.duration_seconds ?? 3600);
  if (!Number.isInteger(duration) || duration < 900 || duration > 43200) throw new PilotError("NOVA_CREDENTIAL_PROFILE_UNSUPPORTED");
  const sourceCredentials = { accessKeyId: source.aws_access_key_id, secretAccessKey: source.aws_secret_access_key, ...(source.aws_session_token ? { sessionToken: source.aws_session_token } : {}) };
  let credentials: NovaStaticCredentials;
  try {
    assertCurrent(); credentials = await (fixture?.assumeRole ?? assumeRole)(sourceCredentials, { RoleArn: p.role_arn,
      RoleSessionName: p.role_session_name ?? "gymini-e3-nova-eval", DurationSeconds: duration, ...(p.external_id ? { ExternalId: p.external_id } : {}) }, assertCurrent);
  } catch (e) { if (e instanceof PilotError) throw e; throw new PilotError("NOVA_STS_ASSUME_ROLE_FAILED"); }
  // An already-dispatched STS call may finish after expiry; discard it before ANY ledger claim/reservation.
  assertCurrent();
  const expires = credentials?.expiration instanceof Date ? credentials.expiration.getTime() : NaN;
  if (!credentials?.accessKeyId || !credentials.secretAccessKey || !credentials.sessionToken || !Number.isFinite(expires)) throw new PilotError("NOVA_CREDENTIAL_RESPONSE_INVALID");
  if (expires <= clock()) throw new PilotError("NOVA_CREDENTIALS_EXPIRED");
  if (!Number.isFinite(leaseEnd) || expires < leaseEnd + NOVA_CREDENTIAL_MARGIN_MS) throw new PilotError("NOVA_CREDENTIAL_VALIDITY_INSUFFICIENT");
  // The credentials carry the admission's authority context: a client (and its HTTP boundary) built from them shares it.
  const frozen = bindNovaAuthority(Object.freeze({ ...credentials, expiration: new Date(expires) }), authority);
  // Historical precedence (576d498c): authority callback > signed deadlines > endpoint environment > credential margin > lease.
  const leaseCurrent = () => authority.check((observed) => {
    novaGuardedCallback(authority, assertCurrent, () => { deadlines(observed); if (observed >= expires - NOVA_CREDENTIAL_MARGIN_MS) throw new PilotError("NOVA_CREDENTIALS_EXPIRED"); if (observed >= leaseEnd) throw new PilotError("NOVA_CREDENTIAL_LEASE_EXPIRED"); });
    assertNovaEndpointEnvironment(); const now = clock();
    if (now >= expires - NOVA_CREDENTIAL_MARGIN_MS) throw new PilotError("NOVA_CREDENTIALS_EXPIRED");
    if (now >= leaseEnd) throw new PilotError("NOVA_CREDENTIAL_LEASE_EXPIRED");
  });
  const receipt = Object.freeze({ status: "PRE_RESOLVED_NOVA_CREDENTIALS" as const });
  resolved.set(receipt, { binding: args.binding, credentials: frozen, assertCurrent: leaseCurrent, authority, consumed: false, fixture: !!fixture }); return receipt;
}
export function consumeNovaCredentials(receipt: NovaCredentialReceipt | undefined, binding: string, fixtureAuthority = false) {
  const value = receipt && resolved.get(receipt);
  if (!value || value.binding !== binding || value.consumed || value.fixture !== fixtureAuthority) throw new PilotError("NOVA_PRE_RESOLVED_CREDENTIALS_REQUIRED");
  value.assertCurrent(); value.consumed = true;
  return { credentials: value.credentials, assertCurrent: value.assertCurrent, authority: value.authority };
}
