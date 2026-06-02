variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-north-1"
}

variable "project_name" {
  description = "Project name prefix"
  type        = string
  default     = "api-portal"
}

variable "environment" {
  description = "Environment"
  type        = string
  default     = "dev"
}

# ── Read from existing stack outputs ─────────────────────────────────────────
# These are passed in so web-gui stays decoupled from the main stack.
# Get values from: terraform -chdir=environments/dev output

variable "existing_lambda_arn" {
  description = "ARN of the existing api-demo-dev-lambda (live alias)"
  type        = string
}

variable "existing_lambda_function_name" {
  description = "Function name of the existing backend Lambda"
  type        = string
}

variable "existing_cognito_pool_id" {
  description = "Cognito User Pool ID from the existing stack"
  type        = string
}

variable "existing_cognito_client_id" {
  description = "Cognito App Client ID from the existing stack"
  type        = string
}

variable "existing_authorizer_lambda_arn" {
  description = "ARN of the existing custom authorizer Lambda"
  type        = string
}

variable "existing_authorizer_function_name" {
  description = "Function name of the existing custom authorizer Lambda"
  type        = string
}

variable "existing_aws_region" {
  description = "Region where the existing stack is deployed"
  type        = string
  default     = "eu-north-1"
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 14
}

variable "cors_allowed_origin" {
  description = "CORS allowed origin for the GUI API (use * for dev, specific domain for prod)"
  type        = string
  default     = "*"
}

