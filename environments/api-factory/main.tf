# ============================================================================
# environments/api-factory/main.tf
#
# Dynamic API provisioning — called by the "API Factory" GitHub Actions workflow.
#
# Supports 5 API patterns selected via var.api_type:
#
#   http-jwt          → HTTP API v2 + Cognito JWT token auth
#   http-custom-key   → HTTP API v2 + Lambda authorizer (X-Api-Key header)
#   http-iam          → HTTP API v2 + AWS_IAM SigV4 (service-to-service)
#   http-public       → HTTP API v2 + no auth (public endpoint)
#   rest-usage-plan   → REST API v1 + per-partner usage plan + quota
#
# Each API gets its OWN Terraform state (key = api-factory/<api_name>/terraform.tfstate)
# so multiple APIs can be provisioned independently without affecting each other.
# ============================================================================

locals {
  tags = {
    Project     = var.api_name
    Environment = var.environment
    ManagedBy   = "terraform"
    CreatedBy   = "api-factory-workflow"
    Repository  = "api-gateway-terraform"
  }

  # ── HTTP API auth type mapping ─────────────────────────────────────────────
  auth_type_map = {
    "http-jwt"        = "JWT"
    "http-custom-key" = "CUSTOM"
    "http-iam"        = "AWS_IAM"
    "http-public"     = "NONE"
    "rest-usage-plan" = "NONE" # N/A for REST API path
  }

  authorizer_key_map = {
    "http-jwt"        = "jwt"
    "http-custom-key" = "lambda"
    "http-iam"        = null
    "http-public"     = null
    "rest-usage-plan" = null
  }

  # Build routes map for HTTP API types
  is_http_api     = var.api_type != "rest-usage-plan"
  is_rest_api     = var.api_type == "rest-usage-plan"
  is_custom_key   = var.api_type == "http-custom-key"

  http_routes = local.is_http_api ? {
    "${var.http_method} ${var.route_path}" = {
      authorization_type = local.auth_type_map[var.api_type]
      authorizer_key     = local.authorizer_key_map[var.api_type]
    }
    # Always add a public health check route
    "GET /health" = {
      authorization_type = "NONE"
      authorizer_key     = null
    }
  } : {}
}

# ── HTTP API types (jwt / custom-key / iam / public) ─────────────────────────
# Uses the full stack module — creates Cognito + Lambda + API Gateway + Monitoring.
# Each invocation with a unique api_name creates a completely isolated stack.
module "stack" {
  count  = local.is_http_api ? 1 : 0
  source = "../../modules/stack"

  project_name = var.api_name
  environment  = var.environment
  aws_region   = var.aws_region
  alarm_email  = var.alarm_email

  routes = local.http_routes

  # Custom key auth — use X-Api-Key header
  lambda_authorizer_identity_sources = local.is_custom_key ? ["$request.header.X-Api-Key"] : ["$request.header.Authorization"]
  authorizer_api_key                 = var.api_key_value
  lambda_authorizer_cache_ttl        = 300

  # Conservative defaults for factory-provisioned APIs
  log_retention_days     = 14
  throttling_burst_limit = 100
  throttling_rate_limit  = 50
  waf_rate_limit         = 1000
  enable_waf             = false
}

# ── REST API with usage plan ───────────────────────────────────────────────────
# Creates Lambda + REST API with a single partner key + usage plan.
# For REST API, we need a Lambda to back the integration.
module "lambda_for_rest" {
  count  = local.is_rest_api ? 1 : 0
  source = "../../modules/lambda"

  project_name       = var.api_name
  environment        = var.environment
  log_retention_days = 14
  authorizer_api_key = var.api_key_value
  api_host           = ""
  tags               = local.tags
}

module "rest_api_single" {
  count  = local.is_rest_api ? 1 : 0
  source = "../../modules/rest-api-single"

  api_name             = var.api_name
  environment          = var.environment
  lambda_invoke_arn    = module.lambda_for_rest[0].invoke_arn
  lambda_function_name = module.lambda_for_rest[0].function_name
  route_path           = var.route_path
  http_method          = var.http_method
  partner_name         = var.partner_name
  quota_per_day        = var.quota_per_day
  rate_limit_per_second = var.rate_limit_per_second
  tags                 = local.tags
}

