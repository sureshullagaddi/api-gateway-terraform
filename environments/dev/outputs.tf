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

output "internal_caller_function_name" {
  description = "Internal caller Lambda — invoke to test GET /internal AWS_IAM SigV4 flow"
  value       = module.stack.internal_caller_function_name
}

output "internal_caller_invoke_command" {
  description = "Ready-to-run CLI command to test the full AWS_IAM SigV4 flow"
  value       = module.stack.internal_caller_invoke_command
}

# ── REST API (v1) — per-partner rate limiting ──────────────────────────────────
output "rest_api_endpoint" {
  description = "REST API (v1) base URL"
  value       = module.stack.rest_api_endpoint
}

output "rest_api_partner_accounts_url" {
  description = "GET /partner/accounts — send x-api-key header"
  value       = module.stack.rest_api_partner_accounts_url
}

output "rest_api_nordea_key" {
  description = "Nordea partner API key (premium — 10K req/day)"
  value       = module.stack.rest_api_nordea_key
  sensitive   = true
}

output "rest_api_seb_key" {
  description = "SEB partner API key (standard — 5K req/day)"
  value       = module.stack.rest_api_seb_key
  sensitive   = true
}

