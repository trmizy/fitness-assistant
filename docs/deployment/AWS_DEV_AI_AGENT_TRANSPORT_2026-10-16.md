# Workout-request profile outage

REAL HTTP/API: after the personalization fix was deployed, a request to create
a six-day workout schedule returned the guarded profile-unavailable answer.
CloudWatch recorded fitness agent tool failed, tool /profile/agent/context,
status 503, followed by ci_profile_upstream_unavailable. This means the workflow
stopped before creating a plan; it does not prove the account has no profile.

CODE AUDIT: fitness-agent-tools.ts domain() still used axios.request directly
and defaulted to localhost:3004 / localhost:3002, independently of the recently
fixed profileExtractor. Changed this shared agent-tool call path to the existing
requestService helper, preserving bearer and internal headers, identity,
schema validation and error handling. Added PUT support without converting it
to POST. Existing embedded query strings are split from Lambda rawPath.

Commits: 0f8856d7 and f47355a3. Build run: 38931691437.

TEST FIXTURE: node --test scripts/ci/service-lambda-methods.test.cjs
scripts/ci/profile-extractor-transport.test.cjs: 6/6 passed. Covers Lambda/HTTP
PUT, token/body preservation, structured and embedded query strings, eight
personalization reads and concurrent per-account measurement separation.

Deployment and the authenticated workout-creation outcome remain pending at
this checkpoint. Bedrock's zero quota remains a separate external blocker;
this transport correction does not establish successful model generation.

CODE AUDIT: other legacy HTTP-only readers exist in global/readers.ts,
enterprise-data readers, nutrition_context.ts and workout_schedule_context.ts.
They were not silently changed in this targeted fix. No full AI Lambda
compatibility or complete functional verification is claimed.
