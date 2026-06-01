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

// ...existing code...

output "partner_api_key_secret_arn" {
  description = "ARN of the Secrets Manager secret storing the partner API key"
  value       = aws_secretsmanager_secret.partner_api_key.arn
}

output "partner_api_key_secret_name" {
  description = "Name of the Secrets Manager secret (view in AWS Console)"
  value       = aws_secretsmanager_secret.partner_api_key.name
}
  description = "Invoke ARN of the custom authorizer Lambda — use as lambda_authorizer_uri"
  value       = aws_lambda_function.authorizer.invoke_arn
}

output "authorizer_function_name" {
  description = "Custom authorizer Lambda function name"
  value       = aws_lambda_function.authorizer.function_name
}
