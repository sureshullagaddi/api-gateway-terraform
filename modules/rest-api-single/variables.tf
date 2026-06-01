variable "api_name" {
  description = "API name — used as resource prefix (e.g. payments, transfers)"
  type        = string
}

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "lambda_invoke_arn" {
  description = "Invoke ARN of the Lambda 'live' alias"
  type        = string
}

variable "lambda_function_name" {
  description = "Lambda function name — for resource-based IAM policy"
  type        = string
}

variable "route_path" {
  description = "API route path (e.g. /payments, /transfers/summary)"
  type        = string
  default     = "/data"
}

variable "http_method" {
  description = "HTTP method (GET, POST, PUT, DELETE, PATCH)"
  type        = string
  default     = "GET"
}

variable "partner_name" {
  description = "Partner name (e.g. hsbc, barclays, nordea)"
  type        = string
  default     = "partner"
}

variable "quota_per_day" {
  description = "Max requests per partner per day"
  type        = number
  default     = 5000
}

variable "rate_limit_per_second" {
  description = "Max requests per second (burst = 2x this value)"
  type        = number
  default     = 50
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

