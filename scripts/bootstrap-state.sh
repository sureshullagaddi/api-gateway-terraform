#!/usr/bin/env bash
# =============================================================================
# bootstrap-state.sh — One-time setup for Terraform remote state backend
#
# Run this ONCE before the first `terraform init`.
# It creates:
#   1. S3 bucket for Terraform state (with versioning + encryption)
#   2. DynamoDB table for state locking
#   3. IAM OIDC provider for GitHub Actions (no static credentials)
#   4. IAM role trusted by GitHub Actions (scoped to this repo)
#
# Usage:
#   AWS_REGION=eu-north-1 \
#   GITHUB_ORG=your-org \
#   GITHUB_REPO=api-gateway-terraform \
#   BUCKET_NAME=tf-state-demo-bucket \
#   bash scripts/bootstrap-state.sh
# =============================================================================

set -euo pipefail

AWS_REGION="${AWS_REGION:-eu-north-1}"
GITHUB_ORG="${GITHUB_ORG:?Set GITHUB_ORG}"
GITHUB_REPO="${GITHUB_REPO:?Set GITHUB_REPO}"
BUCKET_NAME="${BUCKET_NAME:-tf-state-demo-bucket}"
DYNAMO_TABLE="terraform-lock"
ROLE_NAME="github-actions-oidc-role"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "==> Account: $ACCOUNT_ID | Region: $AWS_REGION"

# 1. S3 bucket for Terraform state
echo "==> Creating S3 bucket: $BUCKET_NAME"
if aws s3api head-bucket --bucket "$BUCKET_NAME" 2>/dev/null; then
  echo "    Bucket already exists — skipping"
else
  aws s3api create-bucket \
    --bucket "$BUCKET_NAME" \
    --region "$AWS_REGION" \
    --create-bucket-configuration LocationConstraint="$AWS_REGION"

  aws s3api put-bucket-versioning \
    --bucket "$BUCKET_NAME" \
    --versioning-configuration Status=Enabled

  aws s3api put-bucket-encryption \
    --bucket "$BUCKET_NAME" \
    --server-side-encryption-configuration '{
      "Rules": [{
        "ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}
      }]
    }'

  aws s3api put-public-access-block \
    --bucket "$BUCKET_NAME" \
    --public-access-block-configuration \
      BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi

# 2. DynamoDB table for state locking
echo "==> Creating DynamoDB table: $DYNAMO_TABLE"
if aws dynamodb describe-table --table-name "$DYNAMO_TABLE" --region "$AWS_REGION" 2>/dev/null; then
  echo "    Table already exists — skipping"
else
  aws dynamodb create-table \
    --table-name "$DYNAMO_TABLE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "$AWS_REGION"
fi

# 3. GitHub Actions OIDC identity provider
echo "==> Creating OIDC identity provider for GitHub Actions"
OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" 2>/dev/null; then
  echo "    OIDC provider already exists — skipping"
else
  THUMBPRINT=$(echo | openssl s_client -connect token.actions.githubusercontent.com:443 -servername token.actions.githubusercontent.com 2>/dev/null \
    | openssl x509 -fingerprint -noout \
    | sed 's/://g' \
    | awk -F= '{print tolower($2)}')

  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list "$THUMBPRINT"
fi

# 4. IAM role trusted by GitHub Actions (scoped to this repo, main branch only)
echo "==> Creating IAM role: $ROLE_NAME"
TRUST_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "${OIDC_PROVIDER_ARN}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:${GITHUB_ORG}/${GITHUB_REPO}:ref:refs/heads/main",
            "repo:${GITHUB_ORG}/${GITHUB_REPO}:pull_request"
          ]
        }
      }
    }
  ]
}
EOF
)

if aws iam get-role --role-name "$ROLE_NAME" 2>/dev/null; then
  echo "    Role already exists — updating trust policy"
  aws iam update-assume-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-document "$TRUST_POLICY"
else
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Role assumed by GitHub Actions via OIDC for ${GITHUB_ORG}/${GITHUB_REPO}"

  # Attach policies — scope these down in production
  aws iam attach-role-policy --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
  echo "    ⚠️  Attached AdministratorAccess — REPLACE with least-privilege policy in production!"
fi

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

echo ""
echo "✅ Bootstrap complete!"
echo ""
echo "Next steps:"
echo "  1. Add the following secrets to each GitHub environment (dev / prod):"
echo "     AWS_ROLE_ARN = ${ROLE_ARN}"
echo "     ALARM_EMAIL  = your-alerts@example.com"
echo ""
echo "  2. Add the following GitHub variable (or use defaults):"
echo "     AWS_REGION = ${AWS_REGION}"
echo ""
echo "  3. Update bucket/table names in environments/*/backend.tf if you used"
echo "     different names, then run: terraform init"

