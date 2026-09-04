data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub Actions OIDC root CA thumbprint. If AWS/GitHub rotates this, update
  # through a small reviewed Terraform change rather than storing long-lived keys.
  thumbprint_list = ["ab9d0263244dd0326eb67015705a667e79cfe998"]
}

data "aws_iam_policy_document" "github_actions_assume_role" {
  statement {
    effect = "Allow"

    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:ref:refs/heads/master",
        "repo:${var.github_repository}:pull_request",
      ]
    }
  }
}

resource "aws_iam_role" "github_actions_ci" {
  name               = "${var.project}-github-actions-ci"
  assume_role_policy = data.aws_iam_policy_document.github_actions_assume_role.json
}

data "aws_iam_policy_document" "ci_state_backend_read" {
  statement {
    effect = "Allow"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
    ]
    resources = ["arn:aws:s3:::${var.tfstate_bucket}"]
  }

  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["arn:aws:s3:::${var.tfstate_bucket}/*"]
  }
}

resource "aws_iam_role_policy" "ci_state_backend_read" {
  name   = "state-backend-read"
  role   = aws_iam_role.github_actions_ci.id
  policy = data.aws_iam_policy_document.ci_state_backend_read.json
}

data "aws_iam_policy_document" "ci_plan_read_only" {
  statement {
    effect = "Allow"
    actions = [
      "apigateway:GET",
      "apigateway:HEAD",
      "apigateway:OPTIONS",
      "cloudfront:Get*",
      "cloudfront:List*",
      "lambda:Get*",
      "lambda:List*",
      "logs:Describe*",
      "logs:FilterLogEvents",
      "s3:Get*",
      "s3:List*",
      "iam:Get*",
      "iam:List*",
      "budgets:Describe*",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "ci_plan_read_only" {
  name   = "plan-read-only"
  role   = aws_iam_role.github_actions_ci.id
  policy = data.aws_iam_policy_document.ci_plan_read_only.json
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.project}-lambda-exec-${var.environment}"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
