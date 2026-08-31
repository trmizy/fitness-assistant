output "tfstate_bucket_name" {
  value       = aws_s3_bucket.tfstate.bucket
  description = "S3 bucket used by Terraform remote state."
}
