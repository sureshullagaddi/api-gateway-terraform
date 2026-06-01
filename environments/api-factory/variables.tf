# ============================================================================
# environments/api-factory/variables.tf
#
# All inputs come from the GitHub Actions workflow_dispatch form.
# No defaults here — everything is provided by the user at deploy time.
# ============================================================================

variable "api_name" {
  description = "Unique API name — used as resource prefix (e.g. payments, transfers, loans)"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,28}[a-z0-9]$", var.api_name))
    error_message = "api_name must be lowercase letters, numbers, hyphens; 4-30 chars; start with a letter."
  }
}

variable "api_type" {
  description = "API type and auth method to provision"
  type        = string

  validation {
    condition     = contains(["http-jwt", "http-custom-key", "http-iam", "http-public", "rest-usage-plan"], var.api_type)
    error_message = "api_type must be one of: http-jwt, http-custom-key, http-iam, http-public, rest-usage-plan."
  }
}

variable "route_path" {
  description = "Route path (e.g. /payments, /transfers/summary)"
  type        = string
  default     = "/data"
}

variable "http_method" {
  description = "HTTP method for the route"
  type        = string
  default     = "GET"

  validation {
    condition     = contains(["GET", "POST", "PUT", "DELETE", "PATCH"], var.http_method)
    error_message = "http_method must be GET, POST, PUT, DELETE, or PATCH."
  }
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
  description = "AWS region"
  type        = string
  default     = "eu-north-1"
}

variable "alarm_email" {
  description = "Email for CloudWatch alarm notifications"
  type        = string
  default     = "ops@example.com"
}

# ── REST API usage plan variables (only used when api_type = rest-usage-plan) ──
variable "partner_name" {
  description = "[REST API] Partner name (e.g. hsbc, barclays)"
  type        = string
  default     = "partner"
}

variable "quota_per_day" {
  description = "[REST API] Daily request quota per partner key"
  type        = number
  default     = 5000
}

variable "rate_limit_per_second" {
  description = "[REST API] Rate limit in requests per second"
  type        = number
  default     = 50
}

# ── HTTP API custom key auth (only used when api_type = http-custom-key) ──────
variable "api_key_value" {
  description = "[HTTP custom-key] API key value the Lambda authorizer validates"
  type        = string
  default     = "my-secret-key-123"
  sensitive   = true
}

