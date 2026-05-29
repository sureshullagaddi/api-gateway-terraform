terraform {
  backend "s3" {
    bucket         = "tf-state-demo-bucket"
    key            = "sit/terraform.tfstate"
    region         = "eu-north-1"
    dynamodb_table = "terraform-lock"
    encrypt        = true
  }
}

