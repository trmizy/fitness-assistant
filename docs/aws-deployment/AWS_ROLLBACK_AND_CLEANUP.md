# AWS rollback and cleanup

Do not use `terraform destroy` for this project without explicit approval.

## Phase 1 rollback

1. Revert the Lambda source/config change in Git.
2. Run `terraform plan`.
3. Confirm the plan only updates the dev Lambda/API resources in place.
4. Apply the reviewed plan.

## Phase 2 rollback

Frontend artifact rollback:

1. Rebuild or retrieve the previous `frontend/web/dist`.
2. Upload it to `s3://fitness-assistant-frontend-dev-191798898985`.
3. If CloudFront exists, create an invalidation for `/*`.

CloudFront/OAC cleanup after failed account verification:

- Terraform currently tracks the OAC created before CloudFront failed.
- Prefer leaving it until account verification is resolved.
- If cleanup is required, remove it only through a reviewed Terraform plan that shows no unrelated destroy.

## Database rollback

No AWS database was created in this session. Future DB phases must include snapshot/backup and migration rollback instructions before apply.
