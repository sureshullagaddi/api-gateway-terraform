variable "project_name" {
  description = "Project name used as a prefix for all resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment (dev | prod)"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
