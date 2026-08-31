# AWS deployment runbook — dev

## Phase 1

```bash
cd infra/terraform/environments/dev
terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
curl https://uo90qua3rk.execute-api.ap-southeast-1.amazonaws.com/hello
```

Expected:

```json
{"status":"ok","service":"fitness-assistant","environment":"dev"}
```

## Phase 2

Currently blocked until the AWS account is verified for CloudFront.

After verification:

```bash
cd infra/terraform/environments/dev
terraform plan -out=tfplan-phase2
terraform apply tfplan-phase2
```

Build and upload frontend:

```powershell
$env:VITE_API_URL='https://uo90qua3rk.execute-api.ap-southeast-1.amazonaws.com'
pnpm --filter @gym-coach/web build
Remove-Item Env:VITE_API_URL
aws s3 sync frontend/web/dist s3://fitness-assistant-frontend-dev-191798898985 --delete --cache-control max-age=31536000,public --exclude index.html
aws s3 cp frontend/web/dist/index.html s3://fitness-assistant-frontend-dev-191798898985/index.html --cache-control no-cache --content-type text/html
```

## Safety checks

Before every apply, confirm the plan has no unexpected:

- destroy operations
- NAT Gateway
- RDS/Aurora
- ECS service
- OpenSearch
- ElastiCache
- production environment
