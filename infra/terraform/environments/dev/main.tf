data "aws_caller_identity" "current" {}

module "iam" {
  source = "../../modules/iam"

  project           = var.project
  environment       = var.environment
  github_repository = var.github_repository
  tfstate_bucket    = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"
}

module "hello_world" {
  source = "../../modules/lambda-http-api"

  project            = var.project
  environment        = var.environment
  lambda_role_arn    = module.iam.lambda_exec_role_arn
  source_dir         = "${path.module}/src/hello"
  log_retention_days = 14
}

module "s3_frontend" {
  source = "../../modules/private-s3-bucket"

  bucket_name = "${var.project}-frontend-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

module "s3_uploads" {
  source = "../../modules/private-s3-bucket"

  bucket_name = "${var.project}-uploads-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

module "s3_vectors" {
  source = "../../modules/private-s3-bucket"

  bucket_name = "${var.project}-vectors-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

module "frontend_cdn" {
  source = "../../modules/cloudfront-spa"

  project                     = var.project
  environment                 = var.environment
  bucket_name                 = module.s3_frontend.bucket_name
  bucket_arn                  = module.s3_frontend.bucket_arn
  bucket_regional_domain_name = module.s3_frontend.bucket_regional_domain_name
}

resource "aws_budgets_budget" "monthly_dev" {
  count = var.budget_alert_email == "" ? 0 : 1

  name         = "${var.project}-monthly"
  budget_type  = "COST"
  limit_amount = "30"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}
