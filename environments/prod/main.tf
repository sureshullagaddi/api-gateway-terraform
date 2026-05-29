# ============================================================================
# environments/prod/main.tf
#
# Calls the shared stack module with prod-specific variable values.
# All wiring logic lives in modules/stack — do NOT duplicate it here.
# To change infrastructure topology, edit modules/stack/main.tf.
# ============================================================================

module "stack" {
  source = "../../modules/stack"

  project_name = var.project_name
  environment  = "prod"
  aws_region   = var.aws_region

  alarm_email            = var.alarm_email
  log_retention_days     = var.log_retention_days
  throttling_burst_limit = var.throttling_burst_limit
  throttling_rate_limit  = var.throttling_rate_limit
  waf_rate_limit         = var.waf_rate_limit
  enable_waf             = var.enable_waf
}
