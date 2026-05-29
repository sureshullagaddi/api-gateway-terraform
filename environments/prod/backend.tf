terraform {
  backend "s3" {
    bucket         = "tf-state-397979615352"
    key            = "prod/terraform.tfstate"
    region         = "eu-north-1"
    dynamodb_table = "terraform-lock"
    encrypt        = true
  }
}

