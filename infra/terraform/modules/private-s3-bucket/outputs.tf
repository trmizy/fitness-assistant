output "bucket_name" {
  value       = aws_s3_bucket.this.bucket
  description = "S3 bucket name."
}

output "bucket_arn" {
  value       = aws_s3_bucket.this.arn
  description = "S3 bucket ARN."
}

output "bucket_regional_domain_name" {
  value       = aws_s3_bucket.this.bucket_regional_domain_name
  description = "Regional domain name for CloudFront origins."
}
