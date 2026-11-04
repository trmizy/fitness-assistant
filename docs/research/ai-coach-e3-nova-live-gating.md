# E3 Nova warmup: LIVE execution gating

2026-11-04 · branch `feat/e3-nova-live-gating` from `680a7b7a`. Evidence: **TEST FIXTURE / CODE AUDIT**. No AWS request, no measurement, no inference, no trust root, no owner signature, no owner ledger.

## What changed

The hard constant `NOVA_LIVE_EXECUTION_LOCKED` is replaced by gating. The Nova measured warmup can now pass the LIVE locks, but **only** when every owner gate below is valid. Default state is still locked: today no trust root, signed approval or issued ledger exists, so every LIVE attempt stops before credentials or a request.

Gate order (session; each is checked before the ledger is claimed and before the AWS client is built):

1. **Signed configuration** (`parseConfiguration`). Nova LIVE additionally requires a signed `novaScope` block. Without it you get `NOVA_LIVE_SCOPE_REQUIRED`. The block holds:
   - exactly 4 `tokenPayloadHashes` (the owner-approved payloads);
   - `measureCalls: 4` and `inferenceCalls: 8`;
   - a named `awsProfile`. `default` is forbidden; a role profile resolves STS session credentials;
   - `ownerAcknowledgements`. `PENDING_OWNER` gives `NOVA_OWNER_ACKNOWLEDGEMENT_REQUIRED`.

   The approval must be at most 72 h from expiry (`NOVA_APPROVAL_LIFETIME_EXCEEDED`), and existing checks still apply: `configHash`, expiry, `OWNER_CONFIRMED_AWS` pricing, model/Region/limits. A `novaScope` on any other protocol is rejected.
2. **Clean pinned checkout**: the existing `verifySessionPins` / `assertVerifiedPins`, with the implementation root and a clean tree.
3. **Trust root + Ed25519 approval**: the existing `installedApproval`, read from the fixed `C:/ProgramData/Gymini/Evaluation/trust.json`.
4. **Issued ledger** (read-only): an unused `OWNER_SIGNED` issue bound to the approval and config. A Nova issue must also carry an explicit `scope` (protocol, model, Region, payload set, call counts, USD cap) equal to the signed config (`NOVA_LEDGER_SCOPE_MISMATCH`).
5. Only then: ledger claim → `createNovaRuntimeClient(novaScope.awsProfile)` → transport.

During execution:
- Every request's `tokenPayloadHash` must be in the signed set (`NOVA_PAYLOAD_NOT_APPROVED`). The runner also checks that the prepared payload set equals the approved set before opening the session.
- Measures are capped at `novaScope.measureCalls` and inferences at `inferenceCalls`.
- The existing exact token reconciliation, cache fail-closed, 0 retries, stop-after-2-failures and USD ledger rules are unchanged.

Entry points:
- `run.ts` (existing CLI) now refuses any LIVE config (`CLI_LIVE_LOCKED`), not just `--live`.
- `nova-live-cli.ts` is the only LIVE entry point. It takes `<signed-config.json> <run-dir> [--resume]`, has no unlock flag, and reads no environment variable.
- `runner.ts` still throws `RUNNER_LIVE_LOCKED` for every LIVE config except Nova, and refuses injected transports in LIVE. Mantle stays `MANTLE_LIVE_LOCKED`.
- LIVE summaries report `mode: LIVE`, AWS-reported token authority and `actualBedrockCalls`.

## Rehearsal (TEST FIXTURE)

`liveRehearsal { trust, send }` drives the full LIVE gate sequence with:
- a fixture trust root, using a key generated in the test;
- a `FAKE_TEST_ONLY` ledger issue;
- a fixture `send`.

It is accepted only for a Nova LIVE config and never builds the AWS client. It refuses `OWNER_SIGNED` issues, so a fixture trust root and a real owner issue can never be combined. Its manifest is marked `rehearsal: TEST_FIXTURE_NO_AWS_CALL`.

## Tests

- `ai-coach-nova-live-gating.test.ts` covers:
  - config gates;
  - ledger scope;
  - Ed25519 verification: valid, wrong key, wrong issuer, tampered, expired, ledger inside workspace;
  - an unapproved payload refused before dispatch;
  - profile validation;
  - CLIs with env opt-in variables set;
  - source gate order.

  Three rehearsal tests need a clean checkout, because LIVE pins require one. In a clean checkout they show three things:
  - With all gates valid, exactly 4 measures + 8 inferences are sent. All are approved payloads, and the AWS SDK is never touched. The single-use issue is then consumed.
  - Each of 9 missing or mismatched gates stops with zero sends and an unclaimed ledger.
  - Without a rehearsal, the absent installed trust root stops the run, and the SDK is never called.
- `ai-coach-nova-live-transport.test.ts` is updated to the profile-from-scope client and the new gate order.

## Not done here

- No owner trust root, signature or ledger was created.
- No AWS call.
- No IAM, billing or logging change.
- Owner acknowledgements remain `PENDING_OWNER` until the owner confirms them in a signed config.
