# ============================================================================
# environments/dev/main.tf
#
# Calls the shared stack module with dev-specific variable values.
# All wiring logic lives in modules/stack — do NOT duplicate it here.
# To change infrastructure topology, edit modules/stack/main.tf.
# ============================================================================

module "stack" {
  source = "../../modules/stack"

  project_name = var.project_name
  environment  = "dev"
  aws_region   = var.aws_region

  alarm_email            = var.alarm_email
  log_retention_days     = var.log_retention_days
  throttling_burst_limit = var.throttling_burst_limit
  throttling_rate_limit  = var.throttling_rate_limit
  waf_rate_limit         = var.waf_rate_limit
  enable_waf             = var.enable_waf
  authorizer_api_key     = var.authorizer_api_key

  # Custom authorizer reads X-Api-Key header (not Authorization)
  lambda_authorizer_identity_sources = ["$request.header.X-Api-Key"]

  # Routes: JWT-secured, custom-auth, and public
  routes = {
    "GET /secure" = { authorization_type = "JWT",    authorizer_key = "jwt"    }
    "GET /admin"  = { authorization_type = "CUSTOM", authorizer_key = "lambda" }
    "GET /health" = { authorization_type = "NONE",   authorizer_key = null     }
  }
}