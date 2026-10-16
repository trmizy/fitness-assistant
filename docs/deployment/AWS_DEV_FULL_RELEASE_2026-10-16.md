# DEV application release, 2026-10-16

Owner requested deploying the full application before functional testing.

- REAL HTTP/API: build 38925724773 packaged five services but failed AI:
  the package command requires preexisting dist/lambda.js. Fixed the CI helper
  to generate AI Prisma and compile AI plus workspace dependencies before
  packaging (51946828; no application-source change).
- REAL HTTP/API: replacement build 38926227988 succeeded for all six services,
  producing six unexpired artifacts at 519468283afc7c0acf8114a2f3e85f31ca4da0f1.
- Full Lambda deploy 38926814823 selects auth,user,fitness,gym,payment,ai,
  dry_run=false, build_run_id=38926227988. Covers 12 API/jobs/worker functions.
  At this checkpoint it awaits GitHub environment dev review, not yet deployed.
  https://github.com/trmizy/fitness-assistant/actions/runs/38926814823
- Frontend built successfully from an isolated archive of 3cd7314d (same app
  source as 51946828), with the current API endpoint and Chat disabled. Uploaded
  assets without deleting previous chunks; excluded runtime-config.json;
  uploaded index.html last with no-cache. CloudFront invalidation
  IE9GS11HJ3Q03JE46OG1VQVG5C completed. REAL HTTP/API: CDN index returned 200
  and referenced new index-BJiRns1v.js. Runtime config remained Chat disabled.
  Previous S3 index VersionId: UBgSJP7rslp2Q.Nw84fCRem23WFyOGCO.
- Chat workflow 38925908905 built/pushed image digest
  sha256:a4532c4506b19878a928f49471a86fb41fdf55f5f5a38dff95fce61b78bab907
  and registered task revision 9. Its pin operation was deferred because the
  former target group no longer existed. A concurrent lifecycle update replaced
  it with a valid target group; after verifying that state, directly pinned
  revision 9 successfully without changing desiredCount (0), runningCount (0).
  Chat runtime health is NOT_RUN while OFF.

No database migrations, secrets changes or business-flow tests were performed
for this release. API Gateway PLAN previously showed no semantic/resource
changes, so no infrastructure APPLY was needed. This checkpoint does not claim
full application verification or successful completion of the pending Lambda run.
