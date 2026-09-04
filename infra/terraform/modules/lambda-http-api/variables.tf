variable "project" {
  type        = string
  description = "Project slug."
}

variable "environment" {
  type        = string
  description = "Environment name."
}

variable "lambda_role_arn" {
  type        = string
  description = "Execution role ARN for the Lambda function."
}

variable "source_dir" {
  type        = string
  description = "Directory containing Lambda source."
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days."
  default     = 14
}
