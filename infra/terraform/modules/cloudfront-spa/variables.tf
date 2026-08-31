variable "project" {
  type        = string
  description = "Project slug."
}

variable "environment" {
  type        = string
  description = "Environment name."
}

variable "bucket_name" {
  type        = string
  description = "Private S3 bucket name used as the CloudFront origin."
}

variable "bucket_arn" {
  type        = string
  description = "Private S3 bucket ARN used as the CloudFront origin."
}

variable "bucket_regional_domain_name" {
  type        = string
  description = "Private S3 bucket regional domain name."
}
