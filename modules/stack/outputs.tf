# ============================================================================
# modules/stack/outputs.tf
#
# All stack outputs in one place. Environments delegate to these.
# Adding a new output here automatically makes it available to all envs.
# ============================================================================

output "api_endpoint" {
  description = "HTTP API base URL"
  value       = module.api_gateway.api_endpoint
}

output "secure_endpoint" {
  description = "Full URL for the JWT-protected GET /secure route"
  value       = "${module.api_gateway.api_endpoint}secure"
}

output "route_urls" {
  description = "Map of every configured route → its full URL (METHOD /path = https://...)"
  value       = module.api_gateway.route_urls
}

output "api_id" {
  description = "API Gateway HTTP API ID"
  value       = module.api_gateway.api_id
}

output "waf_arn" {
  description = "WAF WebACL ARN (empty string when enable_waf = false)"
  value       = module.api_gateway.waf_arn
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_client_id" {
  description = "Cognito App Client ID (used in login calls)"
  value       = module.cognito.client_id
}

output "lambda_function_name" {
  description = "Deployed Lambda function name"
  value       = module.lambda.function_name
}

output "lambda_invoke_arn" {
  description = "Lambda live alias invoke ARN — required by web-gui as existing_lambda_arn"
  value       = module.lambda.invoke_arn
}

output "authorizer_function_name" {
  description = "Custom authorizer Lambda function name"
  value       = module.lambda.authorizer_function_name
}

output "authorizer_invoke_arn" {
  description = "Custom authorizer Lambda invoke ARN — required by web-gui as existing_authorizer_lambda_arn"
  value       = module.lambda.authorizer_invoke_arn
}

output "lambda_version" {
  description = "Current published Lambda version (for blue/green rollback reference)"
  value       = module.lambda.function_version
}

output "dashboard_url" {
  description = "Direct link to the CloudWatch monitoring dashboard"
  value       = module.monitoring.dashboard_url
}

output "sns_topic_arn" {
  description = "SNS topic ARN receiving CloudWatch alarm notifications"
  value       = module.monitoring.sns_topic_arn
}

output "internal_caller_function_name" {
  description = "Internal caller Lambda function name — invoke this to test GET /internal AWS_IAM SigV4 flow"
  value       = module.lambda.internal_caller_function_name
}

output "internal_caller_invoke_command" {
  description = "AWS CLI command to trigger the internal caller Lambda and test the full AWS_IAM SigV4 flow"
  value       = "aws lambda invoke --function-name ${module.lambda.internal_caller_function_name} --region ${var.aws_region} --payload '{}' /tmp/response.json && cat /tmp/response.json"
}

# ── REST API (v1) outputs ──────────────────────────────────────────────────────
output "rest_api_endpoint" {
  description = "REST API (v1) base URL — partner rate-limiting demo"
  value       = module.rest_api.api_endpoint
}

output "rest_api_partner_accounts_url" {
  description = "Full URL for GET /partner/accounts — requires x-api-key header"
  value       = module.rest_api.partner_accounts_url
}

output "rest_api_nordea_key" {
  description = "Nordea partner API key (premium plan — 10K req/day). Send as x-api-key header."
  value       = module.rest_api.nordea_api_key
  sensitive   = true
}

output "rest_api_seb_key" {
  description = "SEB partner API key (standard plan — 5K req/day). Send as x-api-key header."
  value       = module.rest_api.seb_api_key
  sensitive   = true
}

