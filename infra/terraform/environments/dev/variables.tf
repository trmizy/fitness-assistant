variable "aws_region" {
  description = "AWS region for the dev environment."
  type        = string
  default     = "ap-southeast-1"
}

variable "project" {
  description = "Project slug used for names."
  type        = string
  default     = "fitness-assistant"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "dev"
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the CI role through OIDC."
  type        = string
  default     = "trmizy/fitness-assistant"
}

variable "budget_alert_email" {
  description = "Optional email for AWS Budget notifications. Leave empty to skip creating/updating a budget subscriber from Terraform."
  type        = string
  default     = ""
  sensitive   = true
}

variable "common_tags" {
  description = "Tags applied to Terraform-managed resources where the AWS service supports tags."
  type        = map(string)
  default = {
    project     = "fitness-assistant"
    environment = "dev"
    managed-by  = "terraform"
    phase       = "1"
  }
}
