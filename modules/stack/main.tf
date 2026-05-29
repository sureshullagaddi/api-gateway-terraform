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

  # Route & auth config — passed straight through from the environment
  routes                             = var.routes
  lambda_authorizer_uri              = var.lambda_authorizer_uri
  lambda_authorizer_function_name    = var.lambda_authorizer_function_name
  lambda_authorizer_identity_sources = var.lambda_authorizer_identity_sources
  lambda_authorizer_cache_ttl        = var.lambda_authorizer_cache_ttl

  throttling_burst_limit = var.throttling_burst_limit
  throttling_rate_limit  = var.throttling_rate_limit
  waf_rate_limit         = var.waf_rate_limit
  enable_waf             = var.enable_waf
  log_retention_days     = var.log_retention_days
  tags                   = local.tags
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

