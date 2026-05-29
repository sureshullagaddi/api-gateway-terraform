# ============================================================================
# environments/stage/variables.tf
#
# Variable declarations mirror modules/stack/variables.tf exactly.
# Only the DEFAULT VALUES here are environment-specific.
# To add a new variable: add it to stack/variables.tf first, then here.
#
# STAGE philosophy: production-identical config.
# If it passes stage, it will pass prod. alarm_email has no default
# so it must always be set explicitly (via GitHub secret ALARM_EMAIL).
# ============================================================================

variable "project_name" {
  description = "Project name used as a prefix for all AWS resources"
  type        = string
  default     = "api-demo"
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "eu-north-1"
}

variable "alarm_email" {
  description = "Email address for CloudWatch alarm notifications"
  type        = string
  # No default — must be explicitly set (via GitHub secret ALARM_EMAIL)
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 90 # same as prod — audit/compliance parity
}

variable "throttling_burst_limit" {
  description = "API Gateway burst concurrency limit"
  type        = number
  default     = 500 # production-identical
}

variable "throttling_rate_limit" {
  description = "API Gateway steady-state requests per second"
  type        = number
  default     = 200 # production-identical
}

variable "waf_rate_limit" {
  description = "WAF: max requests per IP per 5-minute window"
  type        = number
  default     = 2000 # production-identical
}

variable "enable_waf" {
  description = "Whether to enable WAF WebACL"
  type        = bool
  default     = true # always on — mirrors prod exactly
}

