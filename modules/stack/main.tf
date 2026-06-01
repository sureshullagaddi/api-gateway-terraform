# ============================================================================
# modules/stack/main.tf
#
# Composite "stack" module — wires all service modules together.
# This is the single source of truth for how the services connect.
# Both dev and prod environments call this module; only their variable
# defaults (throttling limits, WAF, log retention) differ.
# ============================================================================

locals {
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Repository  = "api-gateway-terraform"
  }
}

module "cognito" {
  source       = "../cognito"
  project_name = var.project_name
  environment  = var.environment
  tags         = local.tags
}

module "lambda" {
  source             = "../lambda"
  project_name       = var.project_name
  environment        = var.environment
  log_retention_days = var.log_retention_days
  authorizer_api_key = var.authorizer_api_key
  # Strip "https://" from api_endpoint to get hostname for internal-caller env var
  api_host           = replace(module.api_gateway.api_endpoint, "https://", "")
  tags               = local.tags
}

module "api_gateway" {
  source               = "../api-gateway"
  project_name         = var.project_name
  environment          = var.environment
  lambda_invoke_arn    = module.lambda.invoke_arn
  lambda_function_name = module.lambda.function_name
  user_pool_id         = module.cognito.user_pool_id
  client_id            = module.cognito.client_id
  aws_region           = var.aws_region

  # Route & auth config — auto-wired to the authorizer Lambda created above
  routes                             = var.routes
  lambda_authorizer_uri              = module.lambda.authorizer_invoke_arn
  lambda_authorizer_function_name    = module.lambda.authorizer_function_name
  lambda_authorizer_identity_sources = var.lambda_authorizer_identity_sources
  lambda_authorizer_cache_ttl        = var.lambda_authorizer_cache_ttl

  throttling_burst_limit = var.throttling_burst_limit
  throttling_rate_limit  = var.throttling_rate_limit
  waf_rate_limit         = var.waf_rate_limit
  enable_waf             = var.enable_waf
  log_retention_days     = var.log_retention_days
  tags                   = local.tags
}

# ── REST API (v1) — Per-Partner Rate Limiting via Usage Plans ─────────────────
# Separate from the HTTP API above. Same Lambda backend, different front-door.
# Demonstrates the one REST API feature HTTP API cannot replicate natively:
#   per-client quotas (Nordea=10K/day, SEB=5K/day) enforced by AWS automatically.
module "rest_api" {
  source               = "../rest-api"
  project_name         = var.project_name
  environment          = var.environment
  lambda_invoke_arn    = module.lambda.invoke_arn
  lambda_function_name = module.lambda.function_name
  log_retention_days   = var.log_retention_days
  tags                 = local.tags
}

module "monitoring" {
  source               = "../monitoring"
  project_name         = var.project_name
  environment          = var.environment
  lambda_function_name = module.lambda.function_name
  api_id               = module.api_gateway.api_id
  alarm_email          = var.alarm_email
  aws_region           = var.aws_region
  tags                 = local.tags
}

# ── Scoped execute-api:Invoke policy for the internal caller Lambda ─────────────
# Created here (not inside modules/lambda) to avoid circular dependency:
#   api_gateway module needs Lambda ARNs → Lambda module needs api_gateway outputs
# Both module outputs are available at the stack level after Terraform resolves deps.
resource "aws_iam_role_policy" "internal_caller_invoke" {
  name = "${var.project_name}-${var.environment}-lambda-internal-caller-invoke-policy"
  role = module.lambda.internal_caller_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AllowInvokeInternalRoute"
      Effect   = "Allow"
      Action   = "execute-api:Invoke"
      Resource = "${module.api_gateway.execution_arn}/*/GET/internal"
    }]
  })
}

