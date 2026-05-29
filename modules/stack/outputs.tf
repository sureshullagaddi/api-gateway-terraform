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

