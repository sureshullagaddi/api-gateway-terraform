# ============================================================================
# environments/sit/variables.tf
#
# Variable declarations mirror modules/stack/variables.tf exactly.
# Only the DEFAULT VALUES here are environment-specific.
# To add a new variable: add it to stack/variables.tf first, then here.
#
# SIT philosophy: WAF on, moderate limits, 30-day log retention.
# Mirrors production config closely so integration bugs surface early.
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
  default     = "your-sit-alerts@example.com"
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 30
}

variable "throttling_burst_limit" {
  description = "API Gateway burst concurrency limit"
  type        = number
  default     = 100
}

variable "throttling_rate_limit" {
  description = "API Gateway steady-state requests per second"
  type        = number
  default     = 50
}

variable "waf_rate_limit" {
  description = "WAF: max requests per IP per 5-minute window"
  type        = number
  default     = 1000
}

variable "enable_waf" {
  description = "Whether to enable WAF WebACL"
  type        = bool
  default     = true # enabled in SIT to match prod behaviour
}

