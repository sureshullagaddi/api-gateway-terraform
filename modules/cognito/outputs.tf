output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "Cognito User Pool ARN"
  value       = aws_cognito_user_pool.this.arn
}

output "client_id" {
  description = "Cognito App Client ID"
  value       = aws_cognito_user_pool_client.this.id
}

output "endpoint" {
  description = "Cognito User Pool endpoint (used in issuer URL)"
  value       = aws_cognito_user_pool.this.endpoint
}

