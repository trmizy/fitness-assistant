variable "project" {
  type        = string
  description = "Project slug."
}

variable "environment" {
  type        = string
  description = "Environment name."
}

variable "github_repository" {
  type        = string
  description = "GitHub repository in owner/name form."
}

variable "tfstate_bucket" {
  type        = string
  description = "Terraform state S3 bucket name."
}
