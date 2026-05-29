variable "project_name" {
  description = "Project name used as a prefix for all AWS resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev | prod)"
  type        = string
  validation {
    condition     = contains(["dev", "sit", "stage", "prod"], var.environment)
    error_message = "environment must be one of: dev, sit, stage, prod."
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days"
  type        = number
  default     = 14
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
