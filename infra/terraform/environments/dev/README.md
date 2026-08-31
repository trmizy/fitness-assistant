# Fitness Assistant AWS dev environment

This environment is serverless-first Phase 1/2 foundation only. It must not create production resources, NAT Gateway, Aurora, OpenSearch, ECS services, or other idle-cost infrastructure unless a later phase explicitly justifies it.

Initial remote state already exists at:

```text
s3://fitness-assistant-tfstate-191798898985/environments/dev/terraform.tfstate
```

Use:

```bash
terraform init
terraform fmt -recursive
terraform validate
terraform plan
```

`terraform apply` is allowed only for the `dev` environment after reviewing that the plan does not destroy unrelated resources.
