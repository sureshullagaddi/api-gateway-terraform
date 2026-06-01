terraform {
  backend "s3" {
    # bucket, key, region, dynamodb_table passed via -backend-config in workflow
    # key = "api-factory/<api_name>/terraform.tfstate"  (set dynamically per API)
    encrypt = true
  }
}

