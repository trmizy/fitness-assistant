# AI personalization transport and Bedrock quota

After the schema repair, the user received a fallback body-composition reply.
This was not successful model generation.

## Evidence and correction

REAL HTTP/API: CloudWatch showed profile/InBody reads failing with ENOTFOUND
user-service and fitness-service. profile_extractor.ts still used axios and
Docker hostnames, bypassing the existing requestService Lambda transport.
AWS configuration already names USER_LAMBDA_NAME and FITNESS_LAMBDA_NAME.

Changed all eight personalization reads to requestService, preserving bearer
headers, response parsing and timeout configuration. Query parameters are
structured separately so synthetic Lambda rawPath never contains a query string.
Removed fallback copy telling end users to inspect Ollama; DEV uses Bedrock.
Application change: ca6e1de8. Build run: 38929729934.

TEST FIXTURE: node --test scripts/ci/profile-extractor-transport.test.cjs: 2/2
passed, covering eight service calls, bearer forwarding, query serialization
inputs, and concurrent account-specific measurements. This is not live E2E.

REAL HTTP/API: direct invocation of user-service's authenticated internal
profile/InBody routes for the affected account returned HTTP 200, a profile,
and nonempty InBody history. Only status/presence were printed; no measurement
values or credentials were output. This proves source data is available,
not that the fixed AI public chat path has yet been deployed and retested.

## Separate external blocker: model quota

REAL HTTP/API: Bedrock Nova Pro calls returned ThrottlingException (429):
"Too many tokens per day, please wait before trying again."
Model: apac.amazon.nova-pro-v1:0. Region: ap-southeast-1.

Service Quotas reports applied values of zero for:

- Model invocation max tokens per day for Amazon Nova Pro (not adjustable
  through the normal quota control).
- Cross-region model inference requests per minute for Amazon Nova Pro.
- Cross-region model inference tokens per minute for Amazon Nova Pro,
  adjustable, quota code L-C0326783.

No alternative model, region, paid capacity, quota increase or support message
was activated by this repair. Waiting/retrying alone is not a verified solution
to zero applied quota.

AWS quota guidance:
https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-increase.html
https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-runtime.html

Suggested owner request context: enable nonzero Bedrock-runtime Nova Pro
cross-region TPM/RPM and daily token allocation in ap-southeast-1 for account
191798898985, inference profile apac.amazon.nova-pro-v1:0. The current use case
is DEV fitness coaching. Set requested capacity according to the owner's budget
and expected traffic. No model-generated InBody answer is claimed verified.
