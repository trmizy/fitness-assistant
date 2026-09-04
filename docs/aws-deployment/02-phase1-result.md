# 02 — Phase 1 result

## Result

PASS.

## Terraform

- `terraform fmt -recursive`: PASS
- `terraform init`: PASS, S3 backend configured
- `terraform validate`: PASS
- `terraform plan`: PASS, `0 to add, 6 to change, 0 to destroy`
- `terraform apply -auto-approve tfplan`: PASS, `0 added, 6 changed, 0 destroyed`

Plan evidence:

```text
docs/aws-deployment/evidence/phase1-plan.txt
```

## Resources

- API Gateway HTTP API: `fitness-assistant-hello-dev-api`
- API URL: `https://uo90qua3rk.execute-api.ap-southeast-1.amazonaws.com`
- Lambda: `fitness-assistant-hello-dev`
- Runtime: `nodejs24.x`
- CloudWatch log group: `/aws/lambda/fitness-assistant-hello-dev`
- Budget: `fitness-assistant-monthly`, 15 USD/month currently exists
- GitHub OIDC provider exists
- GitHub Actions role exists

## Smoke test

Command:

```powershell
Invoke-WebRequest https://uo90qua3rk.execute-api.ap-southeast-1.amazonaws.com/hello
```

Result:

```json
{"status":"ok","service":"fitness-assistant","environment":"dev"}
```

HTTP status: `200`.

## CloudWatch verification

`aws logs filter-log-events` returned a real invocation:

```text
INFO {"level":"info","service":"fitness-assistant","environment":"dev","routeKey":"GET /hello","message":"hello invoked"}
REPORT RequestId ... Duration: 35.87 ms Billed Duration: 184 ms Memory Size: 128 MB
```

## Cost note

Phase 1 uses API Gateway HTTP API, Lambda, CloudWatch Logs, S3 remote state, and IAM. No NAT Gateway, RDS/Aurora, ECS, OpenSearch, ElastiCache, GuardDuty, Security Hub, or Config were created.

## Rollback

Rollback by reverting the Terraform/Lambda source change and applying only the reviewed dev plan. Do not run `terraform destroy`.
