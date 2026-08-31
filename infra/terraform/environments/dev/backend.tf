terraform {
  backend "s3" {
    bucket       = "fitness-assistant-tfstate-191798898985"
    key          = "environments/dev/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
