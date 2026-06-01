locals {
  auth_descriptions = {
    "http-jwt"        = "Cognito JWT — send IdToken in Authorization: Bearer <token>"
    "http-custom-key" = "Custom Lambda authorizer — send X-Api-Key: <key>"
    "http-iam"        = "AWS_IAM SigV4 — sign request with AWS SDK"
    "http-public"     = "No auth — public endpoint"
    "rest-usage-plan" = "REST API usage plan — send x-api-key: <key>"
  }
}

# ── HTTP API outputs (populated when api_type != rest-usage-plan) ─────────────
output "api_type" {
  description = "The API type that was provisioned"
  value       = var.api_type
}

output "api_endpoint" {
  description = "API base URL"
  value       = var.api_type != "rest-usage-plan" ? module.stack[0].api_endpoint : module.rest_api_single[0].api_endpoint
}

output "route_url" {
  description = "Full URL for the provisioned route"
  value       = var.api_type != "rest-usage-plan" ? "${module.stack[0].api_endpoint}${trimprefix(var.route_path, "/")}" : module.rest_api_single[0].route_url
}

output "auth_method" {
  description = "Authentication method in use"
  value       = lookup(local.auth_descriptions, var.api_type, "Unknown auth type")
}

# ── HTTP API specific outputs ──────────────────────────────────────────────────
output "cognito_user_pool_id" {
  description = "[HTTP JWT] Cognito User Pool ID — use to create test users"
  value       = var.api_type == "http-jwt" ? module.stack[0].cognito_user_pool_id : "N/A — not JWT auth"
}

output "cognito_client_id" {
  description = "[HTTP JWT] Cognito App Client ID — use in login calls"
  value       = var.api_type == "http-jwt" ? module.stack[0].cognito_client_id : "N/A — not JWT auth"
}

# ── REST API specific outputs ──────────────────────────────────────────────────
output "partner_api_key_id" {
  description = "[REST API] Partner API key ID — view in AWS Console → API Gateway → API Keys"
  value       = var.api_type == "rest-usage-plan" ? module.rest_api_single[0].partner_api_key_id : "N/A — not REST usage plan"
}

output "partner_api_key" {
  description = "[REST API] Partner API key — send as x-api-key header"
  value       = var.api_type == "rest-usage-plan" ? module.rest_api_single[0].partner_api_key : "N/A"
  sensitive   = true
}

output "usage_plan" {
  description = "[REST API] Usage plan details"
  value       = var.api_type == "rest-usage-plan" ? "${var.partner_name}: ${var.quota_per_day} req/day, ${var.rate_limit_per_second} req/s" : "N/A"
}

# ── Test command ───────────────────────────────────────────────────────────────
output "test_command" {
  description = "curl command to test the provisioned API"
  value = var.api_type == "rest-usage-plan" ? (
    "terraform output -raw partner_api_key | xargs -I{} curl -s -H 'x-api-key: {}' ${module.rest_api_single[0].route_url}"
    ) : var.api_type == "http-public" ? (
    "curl -s ${module.stack[0].api_endpoint}${trimprefix(var.route_path, "/")}"
  ) : "See auth_method output for how to authenticate"
}

