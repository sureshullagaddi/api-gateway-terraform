variable "project_name" {
  description = "Project name"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev | prod)"
  type        = string
}

variable "lambda_function_name" {
  description = "Lambda function name to monitor"
  type        = string
}

variable "api_id" {
  description = "API Gateway HTTP API ID to monitor"
  type        = string
}

variable "alarm_email" {
  description = "Email address to send CloudWatch alarm notifications to"
  type        = string
}

variable "aws_region" {
  description = "AWS region (used in dashboard widget configuration)"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

