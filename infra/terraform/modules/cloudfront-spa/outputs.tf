output "distribution_id" {
  value       = aws_cloudfront_distribution.this.id
  description = "CloudFront distribution ID."
}

output "domain_name" {
  value       = aws_cloudfront_distribution.this.domain_name
  description = "CloudFront distribution domain name."
}

output "frontend_url" {
  value       = "https://${aws_cloudfront_distribution.this.domain_name}"
  description = "HTTPS URL for the frontend."
}
