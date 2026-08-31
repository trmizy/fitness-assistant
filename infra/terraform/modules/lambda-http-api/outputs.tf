output "api_base_url" {
  value       = aws_apigatewayv2_api.this.api_endpoint
  description = "HTTP API endpoint."
}

output "hello_url" {
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/hello"
  description = "GET /hello smoke test URL."
}

output "lambda_name" {
  value       = aws_lambda_function.this.function_name
  description = "Lambda function name."
}
