# 03 — Phase 2 result

## Result

PARTIAL / BLOCKED by AWS account verification.

## Completed

- Frontend package identified: `@gym-coach/web`
- Build command: `pnpm --filter @gym-coach/web build`
- Build with dev API URL: PASS
- Artifact uploaded to private S3 bucket: PASS
- Bucket: `fitness-assistant-frontend-dev-191798898985`
- Uploaded objects: 7
- Total uploaded size: 15,464,438 bytes

## Terraform

Plan evidence:

```text
docs/aws-deployment/evidence/phase2-plan.txt
```

Plan was safe:

```text
3 to add, 0 to change, 0 to destroy
```

Planned resources:

- CloudFront distribution
- CloudFront Origin Access Control
- S3 bucket policy allowing CloudFront read-only access

## Blocker

`terraform apply tfplan-phase2` failed while creating CloudFront distribution:

```text
AccessDenied: Your account must be verified before you can add new CloudFront resources.
To verify your account, please contact AWS Support.
```

Terraform successfully created and tracks the OAC:

```text
module.frontend_cdn.aws_cloudfront_origin_access_control.this
```

AWS OAC:

```text
E8HDC5WIJI8XQ fitness-assistant-dev-frontend-oac sigv4 always
```

CloudFront distribution and bucket policy were not created, so there is no frontend public URL yet.

## Smoke test

Not possible yet because CloudFront distribution creation is blocked by AWS account verification.

## Next action

Verify the AWS account for CloudFront through AWS Support, then rerun:

```bash
cd infra/terraform/environments/dev
terraform plan -out=tfplan-phase2
terraform apply tfplan-phase2
```
