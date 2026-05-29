terraform {
  backend "s3" {
    bucket         = "tf-state-demo-bucket"
    key            = "dev/terraform.tfstate"
    region         = "eu-north-1"
    dynamodb_table = "terraform-lock"
    encrypt        = true
  }
}