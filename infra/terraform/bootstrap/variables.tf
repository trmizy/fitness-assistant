variable "aws_region" {
  type        = string
  description = "AWS region for the Terraform state bucket."
  default     = "ap-southeast-1"
}

variable "project" {
  type        = string
  description = "Project slug."
  default     = "fitness-assistant"
}

variable "common_tags" {
  type        = map(string)
  description = "Tags applied to bootstrap resources."
  default = {
    project     = "fitness-assistant"
    environment = "dev"
    managed-by  = "terraform"
    phase       = "1"
  }
}
