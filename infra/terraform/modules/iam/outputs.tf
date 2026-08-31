output "lambda_exec_role_arn" {
  value       = aws_iam_role.lambda_exec.arn
  description = "Execution role ARN for Phase 1 Lambda functions."
}

output "github_actions_role_arn" {
  value       = aws_iam_role.github_actions_ci.arn
  description = "GitHub Actions OIDC role ARN."
}
