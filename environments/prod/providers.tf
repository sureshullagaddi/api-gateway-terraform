# ============================================================================
# environments/prod/providers.tf
#
# Provider versions are intentionally identical across all environments.
# If you update provider versions here, update environments/dev/providers.tf
# to match. The only environment-specific value is var.aws_region.
# ============================================================================

terraform {
  required_version = ">= 1.3.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
