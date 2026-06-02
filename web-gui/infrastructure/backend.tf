# ============================================================================
# web-gui/infrastructure/backend.tf
# Separate state from the main stack — GUI infra is independently managed.
# ============================================================================
terraform {
  backend "s3" {
    bucket         = "tf-state-397979615352"
    key            = "web-gui/terraform.tfstate"
    region         = "eu-north-1"
    dynamodb_table = "terraform-lock"
    encrypt        = true
  }
}

