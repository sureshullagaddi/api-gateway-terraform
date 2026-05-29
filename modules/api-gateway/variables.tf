variable "project_name" {
  description = "Project name used as a prefix for all resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev | sit | stage | prod)"
  type        = string
}

variable "lambda_invoke_arn" {
  description = "Invoke ARN of the Lambda 'live' alias"
  type        = string
}

variable "lambda_function_name" {
  description = "Lambda function name (used to create the resource-based policy)"
  type        = string
}

variable "user_pool_id" {
  description = "Cognito User Pool ID (used in the JWT authorizer issuer URL)"
  type        = string
}

variable "client_id" {
  description = "Cognito App Client ID (JWT authorizer audience)"
  type        = string
}

variable "aws_region" {
  description = "AWS region (used in the Cognito JWT issuer URL)"
  type        = string
}

# ── Route definitions ──────────────────────────────────────────────────────────
# Add, remove, or modify routes here without touching main.tf.
# Each map key is the route key ("METHOD /path" or "$default").
#
# authorization_type — one of:
#   "JWT"     : End-user auth via Cognito (or any OIDC provider).
#               Requires a Bearer token in the Authorization header.
#               authorizer_key = "jwt"
#
#   "CUSTOM"  : Lambda custom authorizer — run any auth logic you need:
#               validate your own tokens, look up API keys in DynamoDB,
#               call an external OAuth/SAML provider, check IP allow-lists, etc.
#               authorizer_key = "lambda"
#               Also set lambda_authorizer_uri below.
#
#   "AWS_IAM" : AWS SigV4 signed requests — for service-to-service calls
#               (e.g. another Lambda, ECS task, or EC2 instance calling this API).
#               The caller must sign requests with valid AWS credentials.
#               authorizer_key = null (no authorizer resource needed)
#
#   "NONE"    : Public endpoint — no auth. Use for health checks, webhooks,
#               public documentation endpoints, or OAuth redirect URIs.
#               authorizer_key = null
#
# Example — mixed auth API:
# routes = {
#   "GET /secure"       = { authorization_type = "JWT",     authorizer_key = "jwt"    }
#   "POST /admin"       = { authorization_type = "CUSTOM",  authorizer_key = "lambda" }
#   "GET /internal"     = { authorization_type = "AWS_IAM", authorizer_key = null     }
#   "GET /health"       = { authorization_type = "NONE",    authorizer_key = null     }
#   "POST /webhook"     = { authorization_type = "NONE",    authorizer_key = null     }
# }
variable "routes" {
  description = "Map of API routes to create. Key = route key (e.g. 'GET /path'). See comments above for all options."
  type = map(object({
    authorization_type = string
    authorizer_key     = optional(string, null)
  }))
  default = {
    # Default: single JWT-protected route — matches the original setup
    "GET /secure" = {
      authorization_type = "JWT"
      authorizer_key     = "jwt"
    }
  }
  validation {
    condition = alltrue([
      for r in values(var.routes) :
      contains(["JWT", "CUSTOM", "AWS_IAM", "NONE"], r.authorization_type)
    ])
    error_message = "authorization_type must be one of: JWT, CUSTOM, AWS_IAM, NONE."
  }
}

# ── Lambda Custom Authorizer settings (optional) ───────────────────────────────
# Only required when any route uses authorization_type = "CUSTOM".
# Set lambda_authorizer_uri to the invoke ARN of your authorizer Lambda.
variable "lambda_authorizer_uri" {
  description = "Invoke ARN of the Lambda custom authorizer function. Set when using authorization_type = CUSTOM."
  type        = string
  default     = null
}

variable "lambda_authorizer_function_name" {
  description = "Function name of the Lambda custom authorizer (needed to grant invoke permission)."
  type        = string
  default     = null
}

variable "lambda_authorizer_identity_sources" {
  description = "Where the Lambda authorizer extracts the identity from. Default: Authorization header."
  type        = list(string)
  default     = ["$request.header.Authorization"]
}

variable "lambda_authorizer_cache_ttl" {
  description = "Seconds to cache the Lambda authorizer result (0 = no cache, 300 = recommended for prod)."
  type        = number
  default     = 0
}

# ── Throttling ─────────────────────────────────────────────────────────────────
variable "throttling_burst_limit" {
  description = "Maximum number of concurrent requests the API can handle (burst)"
  type        = number
  default     = 100
}

variable "throttling_rate_limit" {
  description = "Steady-state requests per second allowed by the API"
  type        = number
  default     = 50
}

# ── WAF ────────────────────────────────────────────────────────────────────────
variable "waf_rate_limit" {
  description = "Maximum requests per 5-minute window per IP before WAF blocks"
  type        = number
  default     = 1000
}

variable "enable_waf" {
  description = "Enable WAF v2 WebACL (disable in dev to save cost)"
  type        = bool
  default     = true
}

# ── Logging ────────────────────────────────────────────────────────────────────
variable "log_retention_days" {
  description = "API Gateway access log retention in days"
  type        = number
  default     = 14
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
