variable "project_name" {
  description = "Project name prefix for all REST API resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev | sit | stage | prod)"
  type        = string
}

variable "lambda_invoke_arn" {
  description = "Invoke ARN of the Lambda 'live' alias — used as the REST API integration URI"
  type        = string
}

variable "lambda_function_name" {
  description = "Lambda function name — used to create the resource-based policy for REST API"
  type        = string
}


variable "tags" {
  description = "Tags to apply to all REST API resources"
  type        = map(string)
  default     = {}
}

