# Complete Setup Guide — From Zero to Running Pipeline

This guide assumes you have **nothing** — no AWS account, no tools, no GitHub repo.  
Follow every step in order.

> 📋 **Also see:** [testing.md](./testing.md) — how to test the API after deployment.

---

## Overview

```
Step 1  — Create an AWS account
Step 2  — Install required tools
Step 3  — Configure the AWS CLI
Step 4  — Create the GitHub repository
Step 5  — Run bootstrap-state.sh  (creates S3, DynamoDB, OIDC, IAM role)
Step 6  — Configure GitHub Environments and Secrets
Step 7  — Push code and watch the pipeline
Step 8  — Call the deployed API
```

---

## Step 1 — Create an AWS Account

> Skip if you already have one.

1. Go to **https://aws.amazon.com** → **Create an AWS Account**
2. Enter email, choose account name (e.g. `my-api-project`)
3. Choose **Personal** account type
4. Enter a credit/debit card (required — free tier won't charge you)
5. Verify identity via phone
6. Choose **Basic Support — Free**
7. Sign in at **https://console.aws.amazon.com**

### Create an IAM Admin User (never use root for day-to-day work)

1. Console → search **IAM** → **Users** → **Create user**
2. Username: `terraform-admin`
3. Check **Provide user access to the AWS Management Console** → **I want to create an IAM user**
4. Set a password, uncheck "must change password"
5. **Next** → **Attach policies directly** → select **AdministratorAccess**
6. **Create user** → **Download CSV** (save the sign-in URL and credentials)

---

## Step 2 — Install Required Tools

### AWS CLI
```bash
brew install awscli
aws --version
# Expected: aws-cli/2.x.x
```

### Terraform
```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
terraform --version
# Expected: Terraform v1.7.x or later
```

### Node.js 18 (for local Lambda development)
```bash
brew install nvm
nvm install 18
nvm use 18
node --version
# Expected: v18.x.x
```

### Git
```bash
brew install git
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

---

## Step 3 — Configure the AWS CLI

```bash
aws configure
```

Prompts:
```
AWS Access Key ID:     (from Step 3a below)
AWS Secret Access Key: (from Step 3a below)
Default region name:   eu-north-1
Default output format: json
```

### Create Access Keys for terraform-admin

1. AWS Console → **IAM** → **Users** → **terraform-admin**
2. **Security credentials** tab → **Access keys** → **Create access key**
3. Use case: **Command Line Interface (CLI)** → confirm → **Create**
4. **Copy both keys now** — secret shown only once

Verify:
```bash
aws sts get-caller-identity
```
Expected:
```json
{
    "UserId": "AIDA...",
    "Account": "397979615352",
    "Arn": "arn:aws:iam::397979615352:user/terraform-admin"
}
```

Note your **Account ID** — you need it in Step 5.

---

## Step 4 — Create the GitHub Repository

1. Go to **https://github.com/new**
2. Name: `api-gateway-terraform`
3. Set to **Private**
4. Do NOT initialise with README
5. **Create repository**

Push this code:
```bash
cd /path/to/api-gateway-terraform
git remote add origin https://github.com/YOUR-USERNAME/api-gateway-terraform.git
git add .
git commit -m "chore: initial commit"
git push -u origin main
```

---

## Step 5 — Bootstrap AWS Backend Infrastructure

Run **once** from your local machine. Creates:

| Resource | Purpose |
|----------|---------|
| S3 Bucket | Stores Terraform state files |
| DynamoDB Table | State locking — prevents concurrent applies |
| IAM OIDC Provider | Allows GitHub Actions to prove identity to AWS |
| IAM Role | What GitHub Actions assumes — scoped to your repo |

```bash
export AWS_REGION=eu-north-1
export GITHUB_ORG=YOUR-GITHUB-USERNAME
export GITHUB_REPO=api-gateway-terraform
export BUCKET_NAME=tf-state-$(aws sts get-caller-identity --query Account --output text)

AWS_PAGER="" bash scripts/bootstrap-state.sh
```

> **Tip:** `AWS_PAGER=""` prevents the AWS CLI from opening a pager that pauses the script.

Expected output:
```
✅ Bootstrap complete!

   AWS_ROLE_ARN = arn:aws:iam::397979615352:role/github-actions-oidc-role
   ALARM_EMAIL  = your-alerts@example.com
   AWS_REGION   = eu-north-1
```

**Copy the `AWS_ROLE_ARN` value — you need it in Step 6.**

### Verify backend.tf bucket name matches

```bash
grep bucket environments/dev/backend.tf
```

If the bucket name differs from what was created, update all 4 environment files:
```bash
BUCKET=tf-state-$(aws sts get-caller-identity --query Account --output text)
for env in dev sit stage prod; do
  sed -i '' "s|bucket.*=.*|bucket         = \"$BUCKET\"|" environments/$env/backend.tf
done
git add environments/*/backend.tf
git commit -m "chore: update backend bucket name"
git push
```

---

## Step 6 — Configure GitHub Environments and Secrets

### Create 4 GitHub Environments

1. Repo → **Settings** → **Environments** → create: **`dev`**, **`sit`**, **`stage`**, **`prod`**

> For `prod`: enable **Required reviewers** for a manual approval gate before any prod deploy.

### Add secrets to EACH environment

Repeat for all 4:

1. Click the environment name → **Environment secrets** → **Add secret**

| Secret | Value |
|--------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::397979615352:role/github-actions-oidc-role` |
| `ALARM_EMAIL` | `your-email@example.com` |

### Add a repository variable (optional)

**Settings → Secrets and variables → Actions → Variables → New repository variable**

| Variable | Value |
|----------|-------|
| `AWS_REGION` | `eu-north-1` |

---

## Step 7 — Push Code and Watch the Pipeline

### Non-main branch → plan only (no AWS changes)

```bash
git checkout -b feature/test-pipeline
git commit --allow-empty -m "test: trigger pipeline"
git push origin feature/test-pipeline
```

Go to **GitHub → Actions** → **Terraform Deploy** → `Plan [dev]` job runs.  
Expected: Terraform plan output — no resources created yet.

### Merge to main → plan + apply

```bash
git checkout main
git merge feature/test-pipeline
git push origin main
```

Go to **Actions** → **Deploy [dev]** runs `terraform apply` and creates:

- Cognito User Pool + App Client
- Lambda function (auto-zipped from `lambda/src/index.js`) + `live` alias
- API Gateway HTTP API + JWT authorizer + `GET /secure` route
- CloudWatch log groups + 5 alarms + 6-widget dashboard
- SNS topic for alarm notifications

Duration: ~2–3 minutes.

### Check outputs

```bash
terraform -chdir=environments/dev output
```

---

## Step 8 — Call the Deployed API

> **macOS paste tip:** Always paste commands as **single lines**. Multi-line backslash commands can cause `dquote>` errors. Press `Ctrl+C` to escape that state.

### Create a test user (once only)

```bash
USER_POOL_ID=$(terraform -chdir=environments/dev output -raw cognito_user_pool_id)
CLIENT_ID=$(terraform -chdir=environments/dev output -raw cognito_client_id)

aws cognito-idp admin-create-user --user-pool-id $USER_POOL_ID --username test@example.com --temporary-password Temp1234! --message-action SUPPRESS --region eu-north-1

aws cognito-idp admin-set-user-password --user-pool-id $USER_POOL_ID --username test@example.com --password Perm5678@ --permanent --region eu-north-1
```

### Get a token

```bash
TOKEN=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id $CLIENT_ID --auth-parameters USERNAME=test@example.com,PASSWORD=Perm5678@ --region eu-north-1 --query AuthenticationResult.AccessToken --output text)
```

Token is valid for **1 hour**.

### Call the API

```bash
SECURE_URL=$(terraform -chdir=environments/dev output -raw secure_endpoint)
curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" $SECURE_URL
```

Expected: `HTTP: 200` with JSON response.

```bash
curl -s -w "\nHTTP: %{http_code}\n" $SECURE_URL
```

Expected: `HTTP: 401` (no token → rejected).

---

## Using Postman

### Get token

**POST** `https://cognito-idp.eu-north-1.amazonaws.com/`

| Header | Value |
|--------|-------|
| `Content-Type` | `application/x-amz-json-1.1` |
| `X-Amz-Target` | `AmazonCognitoIdentityProviderService.InitiateAuth` |

Body (raw JSON):
```json
{
  "AuthFlow": "USER_PASSWORD_AUTH",
  "ClientId": "59sg1etok9amjiq0vhi6h5bosj",
  "AuthParameters": {
    "USERNAME": "test@example.com",
    "PASSWORD": "Perm5678@"
  }
}
```

Post-response script (auto-saves token to environment variable):
```javascript
const token = pm.response.json().AuthenticationResult.AccessToken;
pm.environment.set("token", token);
```

### Call the API

**GET** `https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure`

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer {{token}}` |

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `dquote>` in terminal | Unclosed quote from paste | Press `Ctrl+C`, paste as a single line |
| `Could not assume role with OIDC` | `AWS_ROLE_ARN` secret wrong or missing | Check GitHub Environment secrets; verify `GITHUB_ORG` in bootstrap |
| `Bucket does not exist` during init | Backend bucket name mismatch | Update `backend.tf` bucket name — see Step 5 |
| `InvalidParameterException` on create-user | Smart quotes from copy-paste | Paste as single line without surrounding quotes |
| `401` with valid token | Token expired (1h TTL) | Re-run `initiate-auth` to get a fresh token |
| `403` from API Gateway | WAF blocking (sit/stage/prod only) | Set `enable_waf = false` and redeploy |
| `terraform fmt` fails | Alignment/spacing in `.tf` files | Run `terraform fmt -recursive` locally before pushing |

---

## Cleanup

### Via GitHub Actions (recommended)

**Actions → Terraform Destroy → Run workflow** → select environment → type name to confirm.

### Via terminal

```bash
cd environments/dev
terraform destroy -var="alarm_email=any@example.com"
```

> The S3 bucket and DynamoDB table (bootstrap resources) are **not** Terraform-managed. Delete them manually in the AWS Console if no longer needed.

