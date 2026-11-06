import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { loadSharedConfigFiles } from "@smithy/core/config";
import { NovaScopeSchema, PilotError } from "./config";
import { assertNovaEndpointEnvironment, assertNovaProfileEndpoint } from "./nova-endpoint";
import { novaAuthorityClock } from "./nova-clock";

export interface NovaStaticCredentials { accessKeyId: string; secretAccessKey: string; sessionToken: string; expiration: Date }
type Files = Awaited<ReturnType<typeof loadSharedConfigFiles>>;
type Assume = (source: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }, input: ConstructorParameters<typeof AssumeRoleCommand>[0], assertCurrent: () => void) => Promise<NovaStaticCredentials>;
/** Only used with FAKE_TEST_ONLY rehearsal authority or direct unit tests, never supplied by config/CLI. */
export interface NovaCredentialFixture { loadFiles: () => Promise<Files>; assumeRole: Assume; metadataDisabled?: string }
export interface NovaCredentialReceipt { readonly status: "PRE_RESOLVED_NOVA_CREDENTIALS" }
const resolved = new WeakMap<NovaCredentialReceipt, { binding: string; credentials: NovaStaticCredentials; assertCurrent: () => void; consumed: boolean; fixture: boolean }>();

const assumeRole: Assume = async (source, input, assertCurrent) => {
  // No default provider, source-profile recursion, environment credentials, IMDS, SSO or background refresh.
  const client = new STSClient({ region: "us-east-1", endpoint: "https://sts.us-east-1.amazonaws.com", credentials: source,
    maxAttempts: 1, useFipsEndpoint: false, useDualstackEndpoint: false, ignoreConfiguredEndpointUrls: true });
  const delegate = client.config.requestHandler, dispatch = delegate.handle.bind(delegate);
  client.config.requestHandler = new Proxy(delegate, { get(target, key) {
    if (key === "handle") return (request: Parameters<typeof delegate.handle>[0], options: Parameters<typeof delegate.handle>[1]) => {
      if (request.protocol !== "https:" || request.hostname !== "sts.us-east-1.amazonaws.com" || (request.port !== undefined && request.port !== 443)) throw new PilotError("NOVA_STS_ENDPOINT_MISMATCH");
      assertCurrent(); return dispatch(request, options);
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  try {
    assertCurrent(); const response = await client.send(new AssumeRoleCommand(input)), c = response.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) throw new PilotError("NOVA_CREDENTIAL_RESPONSE_INVALID");
    return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken, expiration: c.Expiration };
  } finally { client.destroy(); }
};

/** Strict equivalent of a one-hop fromIni AssumeRole profile. Files are read ONCE; provider dispatch uses that snapshot. */
export async function resolveNovaCredentials(args: { profile: string; binding: string; validUntil: string; assertAuthority: () => void; expiryCategory?: "LiveNotApproved" | "INFERENCE_RELEASE_EXPIRED" }, fixture?: NovaCredentialFixture): Promise<NovaCredentialReceipt> {
  const clock = novaAuthorityClock(true), until = Date.parse(args.validUntil);
  const assertCurrent = () => { args.assertAuthority(); if (!Number.isFinite(until) || clock() >= until) throw new PilotError(args.expiryCategory ?? "LiveNotApproved"); };
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
  const sourceKeys = ["aws_access_key_id", "aws_secret_access_key", "aws_session_token", "region", "output", "use_fips_endpoint", "use_dualstack_endpoint"];
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
  if (expires < until) throw new PilotError("NOVA_CREDENTIAL_VALIDITY_INSUFFICIENT");
  const frozen = Object.freeze({ ...credentials, expiration: new Date(expires) });
  const leaseCurrent = () => { assertCurrent(); assertNovaEndpointEnvironment(); if (clock() >= expires) throw new PilotError("NOVA_CREDENTIALS_EXPIRED"); };
  const receipt = Object.freeze({ status: "PRE_RESOLVED_NOVA_CREDENTIALS" as const });
  resolved.set(receipt, { binding: args.binding, credentials: frozen, assertCurrent: leaseCurrent, consumed: false, fixture: !!fixture }); return receipt;
}
export function consumeNovaCredentials(receipt: NovaCredentialReceipt | undefined, binding: string, fixtureAuthority = false) {
  const value = receipt && resolved.get(receipt);
  if (!value || value.binding !== binding || value.consumed || value.fixture !== fixtureAuthority) throw new PilotError("NOVA_PRE_RESOLVED_CREDENTIALS_REQUIRED");
  value.assertCurrent(); value.consumed = true;
  return { credentials: value.credentials, assertCurrent: value.assertCurrent };
}
