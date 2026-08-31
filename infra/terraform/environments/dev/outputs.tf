output "api_base_url" {
  description = "Base URL for the Phase 1 HTTP API."
  value       = module.hello_world.api_base_url
}

output "hello_url" {
  description = "Smoke-test URL for GET /hello."
  value       = module.hello_world.hello_url
}

output "lambda_name" {
  description = "Phase 1 hello Lambda function name."
  value       = module.hello_world.lambda_name
}

output "frontend_bucket_name" {
  description = "Private S3 bucket reserved for the dev frontend artifact."
  value       = module.s3_frontend.bucket_name
}

output "frontend_bucket" {
  description = "Backward-compatible output name for the private frontend bucket."
  value       = module.s3_frontend.bucket_name
}

output "uploads_bucket_name" {
  description = "Private S3 bucket reserved for user uploads."
  value       = module.s3_uploads.bucket_name
}

output "uploads_bucket" {
  description = "Backward-compatible output name for the private uploads bucket."
  value       = module.s3_uploads.bucket_name
}

output "vectors_bucket_name" {
  description = "Private S3 bucket reserved for low-cost vector/data experiments."
  value       = module.s3_vectors.bucket_name
}

output "vectors_bucket" {
  description = "Backward-compatible output name for the private vectors bucket."
  value       = module.s3_vectors.bucket_name
}

output "github_actions_ci_role_arn" {
  description = "Backward-compatible output name for the GitHub Actions OIDC role."
  value       = module.iam.github_actions_role_arn
}

output "cloudfront_distribution_id" {
  description = "CloudFront distribution ID for the dev frontend."
  value       = module.frontend_cdn.distribution_id
}

output "frontend_url" {
  description = "CloudFront URL for the dev frontend."
  value       = module.frontend_cdn.frontend_url
}
