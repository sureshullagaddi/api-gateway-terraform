# ============================================================================
# modules/stack/variables.tf
#
# Authoritative variable definitions for the full stack.
# Environment-specific defaults live in environments/*/variables.tf.
# ============================================================================

variable "project_name" {
  description = "Project name used as a prefix for all AWS resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  validation {
    condition     = contains(["dev", "sit", "stage", "prod"], var.environment)
    error_message = "environment must be one of: dev, sit, stage, prod."
  }
}

variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
}

variable "alarm_email" {
  description = "Email address for CloudWatch alarm notifications"
  type        = string
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
}

variable "throttling_burst_limit" {
  description = "API Gateway burst concurrency limit"
  type        = number
}

variable "throttling_rate_limit" {
  description = "API Gateway steady-state requests per second"
  type        = number
}

variable "waf_rate_limit" {
  description = "WAF: max requests per IP per 5-minute window"
  type        = number
}

variable "enable_waf" {
  description = "Whether to enable WAF WebACL"
  type        = bool
}

# ── Route & auth configuration ─────────────────────────────────────────────────
variable "routes" {
  description = "API Gateway routes map. Passed through to the api-gateway module. See modules/api-gateway/variables.tf for full documentation."
  type = map(object({
    authorization_type = string
    authorizer_key     = optional(string, null)
  }))
  default = {
    "GET /secure" = { authorization_type = "JWT", authorizer_key = "jwt" }
  }
}

variable "lambda_authorizer_uri" {
  description = "Invoke ARN of a Lambda custom authorizer function. Required when any route uses authorization_type = CUSTOM."
  type        = string
  default     = null
}

variable "lambda_authorizer_function_name" {
  description = "Function name of the Lambda custom authorizer."
  type        = string
  default     = null
}

variable "lambda_authorizer_identity_sources" {
  description = "Identity sources for the Lambda custom authorizer."
  type        = list(string)
  default     = ["$request.header.Authorization"]
}

variable "lambda_authorizer_cache_ttl" {
  description = "Seconds to cache the Lambda authorizer result."
  type        = number
  default     = 0
}
