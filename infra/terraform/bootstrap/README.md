# Terraform bootstrap

This bootstrap stack creates the S3 bucket used for remote Terraform state.

The dev environment currently uses:

```text
fitness-assistant-tfstate-191798898985
```

Do not run `terraform destroy` for bootstrap. If the bucket already exists and is not in local state, import it instead of creating a duplicate.
