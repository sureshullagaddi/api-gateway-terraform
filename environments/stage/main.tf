# ============================================================================
# environments/stage/main.tf
#
# STAGE (Pre-production / Staging) — final validation gate before prod.
# Config is production-identical: same WAF rules, same throttling limits,
# same log retention. Only the resource name prefix differs ("stage" vs "prod").
#
# All wiring logic lives in modules/stack — do NOT duplicate it here.
# To change infrastructure topology, edit modules/stack/main.tf.
# ============================================================================

module "stack" {
  source = "../../modules/stack"

  project_name = var.project_name
  environment  = "stage"
  aws_region   = var.aws_region

  alarm_email            = var.alarm_email
  log_retention_days     = var.log_retention_days
  throttling_burst_limit = var.throttling_burst_limit
  throttling_rate_limit  = var.throttling_rate_limit
  waf_rate_limit         = var.waf_rate_limit
  enable_waf             = var.enable_waf
}

