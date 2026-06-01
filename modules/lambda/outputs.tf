output "function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.this.function_name
}

output "invoke_arn" {
  description = "Invoke ARN of the 'live' alias — use this as the API Gateway integration URI"
  value       = aws_lambda_alias.live.invoke_arn
}

output "alias_arn" {
  description = "Full ARN of the 'live' alias"
  value       = aws_lambda_alias.live.arn
}

output "function_version" {
  description = "Current published version number"
  value       = aws_lambda_function.this.version
}

output "authorizer_invoke_arn" {
  description = "Invoke ARN of the custom authorizer Lambda — use as lambda_authorizer_uri"
  value       = aws_lambda_function.authorizer.invoke_arn
}

output "authorizer_function_name" {
  description = "Custom authorizer Lambda function name"
  value       = aws_lambda_function.authorizer.function_name
}
