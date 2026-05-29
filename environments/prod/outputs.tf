# All outputs delegate to the stack module.
# To add a new output, add it to modules/stack/outputs.tf first,
# then add the corresponding delegation line below.

output "api_endpoint" {
  description = "HTTP API base URL"
  value       = module.stack.api_endpoint
}

output "secure_endpoint" {
  description = "JWT-protected GET /secure URL"
  value       = module.stack.secure_endpoint
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.stack.cognito_user_pool_id
}

output "cognito_client_id" {
  description = "Cognito App Client ID"
  value       = module.stack.cognito_client_id
}

output "lambda_function_name" {
  description = "Lambda function name"
  value       = module.stack.lambda_function_name
}

output "lambda_version" {
  description = "Published Lambda version"
  value       = module.stack.lambda_version
}

output "dashboard_url" {
  description = "CloudWatch dashboard URL"
  value       = module.stack.dashboard_url
}

output "waf_arn" {
  description = "WAF WebACL ARN"
  value       = module.stack.waf_arn
}

output "sns_topic_arn" {
  description = "CloudWatch alarms SNS topic ARN"
  value       = module.stack.sns_topic_arn
}
