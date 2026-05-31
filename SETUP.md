# Complete Setup Guide — From Zero to Running Pipeline

This guide assumes you have **nothing** — no AWS account, no tools, no GitHub repo.  
Follow every step in order.

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

Expected output at the end:
```
✅ Bootstrap complete!

   AWS_ROLE_ARN = arn:aws:iam::397979615352:role/github-actions-oidc-role
   ALARM_EMAIL  = your-alerts@example.com
   AWS_REGION   = eu-north-1
```

**Copy the `AWS_ROLE_ARN` value.**

### Update backend.tf files (already done if bucket name matches)

The script creates a bucket named `tf-state-<ACCOUNT_ID>`. All `backend.tf` files must reference this exact name:

```bash
# Check current bucket name in backend files
grep bucket environments/dev/backend.tf
```

If the name differs, update all 4:
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

1. Go to your repo → **Settings** → **Environments** (left sidebar)
2. Create each: **`dev`**, **`sit`**, **`stage`**, **`prod`**

> For `prod`: consider enabling **Required reviewers** — this adds a manual approval step before any prod deploy.

### Add secrets to EACH environment

Repeat for all 4 environments:

1. Click the environment name
2. **Environment secrets** → **Add secret**

| Secret Name | Value |
|-------------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::397979615352:role/github-actions-oidc-role` |
| `ALARM_EMAIL` | `your-email@example.com` |

### Add a repository variable (optional)

**Settings → Secrets and variables → Actions → Variables tab → New repository variable**

| Variable | Value |
|----------|-------|
| `AWS_REGION` | `eu-north-1` |

---

## Step 7 — Verify: Push Code and Watch the Pipeline

### Trigger plan-dev (non-main branch)

```bash
git checkout -b feature/test-pipeline
git commit --allow-empty -m "test: trigger pipeline"
git push origin feature/test-pipeline
```

Go to **GitHub → Actions** → you should see **Terraform Deploy** running with `Plan [dev]` job.

Expected: plan completes showing what will be created — no AWS changes yet.

### Trigger deploy (main branch)

```bash
git checkout main
git merge feature/test-pipeline
git push origin main
```

Go to **Actions** → **Deploy [dev]** job runs → `terraform apply` creates:

- Cognito User Pool + App Client
- Lambda function + `live` alias (version 1)
- API Gateway HTTP API with JWT authorizer + `GET /secure` route
- CloudWatch log groups + 5 alarms + dashboard
- SNS topic (WAF disabled in dev)

Duration: ~2–3 minutes.

### Check outputs after apply

```bash
cd environments/dev
terraform init
terraform output
```

Expected:
```
api_endpoint         = "https://xxxx.execute-api.eu-north-1.amazonaws.com/"
secure_endpoint      = "https://xxxx.execute-api.eu-north-1.amazonaws.com/secure"
cognito_client_id    = "xxxxxxxxxxxx"
cognito_user_pool_id = "eu-north-1_XXXXXXX"
lambda_function_name = "api-demo-dev-lambda"
lambda_version       = "1"
dashboard_url        = "https://eu-north-1.console.aws.amazon.com/cloudwatch/..."
```

---

## Step 8 — Call the Deployed API

### Create a test user

```bash
USER_POOL_ID=$(terraform -chdir=environments/dev output -raw cognito_user_pool_id)
CLIENT_ID=$(terraform -chdir=environments/dev output -raw cognito_client_id)

# Create user (no email — suppress welcome message)
aws cognito-idp admin-create-user --user-pool-id $USER_POOL_ID --username test@example.com --temporary-password Temp1234! --message-action SUPPRESS --region eu-north-1

# Set permanent password
aws cognito-idp admin-set-user-password --user-pool-id $USER_POOL_ID --username test@example.com --password Perm5678@ --permanent --region eu-north-1
```

> **Paste as single lines** — avoid multi-line backslash commands which can cause `dquote>` issues on macOS.

### Get a token

```bash
TOKEN=$(aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id $CLIENT_ID --auth-parameters USERNAME=test@example.com,PASSWORD=Perm5678@ --region eu-north-1 --query AuthenticationResult.AccessToken --output text)

echo "Token: ${TOKEN:0:50}..."
```

### Call the secured endpoint

```bash
SECURE_URL=$(terraform -chdir=environments/dev output -raw secure_endpoint)

curl -s -H "Authorization: Bearer $TOKEN" -w "\nHTTP: %{http_code}\n" $SECURE_URL
```

Expected response:
```json
{
  "message": "Access granted to secure endpoint",
  "user": { "sub": "...", "email": "test@example.com" },
  "environment": "dev",
  "requestId": "...",
  "timestamp": "2026-05-31T..."
}
HTTP: 200
```

### Test rejection (no token)

```bash
curl -s -w "\nHTTP: %{http_code}\n" $SECURE_URL
```

Expected: `{"message":"Unauthorized"}` `HTTP: 401`

---

## Using Postman Instead of curl

### Get a token in Postman

**POST** `https://cognito-idp.eu-north-1.amazonaws.com/`

Headers:
| Key | Value |
|-----|-------|
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

Copy `AuthenticationResult.AccessToken` from the response.

### Auto-save token with a script (Scripts → Post-response)

```javascript
const token = pm.response.json().AuthenticationResult.AccessToken;
pm.environment.set("token", token);
```

### Call the API

**GET** `https://ztdsvilz58.execute-api.eu-north-1.amazonaws.com/secure`

Headers:
| Key | Value |
|-----|-------|
| `Authorization` | `Bearer {{token}}` |

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `dquote>` in terminal | Unclosed quote from paste | Press `Ctrl+C`, paste command as a single line without backslashes |
| `Could not assume role with OIDC` | `AWS_ROLE_ARN` secret missing or OIDC trust policy wrong | Check GitHub Environment secrets; re-run bootstrap with correct `GITHUB_ORG` |
| `Bucket does not exist` during init | Backend bucket name mismatch | Update `backend.tf` files with actual bucket name |
| `InvalidParameterException` on admin-create-user | Smart quotes from copy-paste | Type the command manually or use no quotes (no spaces in values) |
| `401` even with valid token | Token expired (1h TTL) | Re-run `initiate-auth` to get a fresh token |
| `403` from API Gateway | WAF blocking (sit/stage/prod) | Set `enable_waf = false` and redeploy, or whitelist your IP |
| HCL semicolon errors | Invalid syntax | Use newlines to separate attributes — no `;` in `.tf` files |
| `terraform fmt -check` fails | Alignment or spacing | Run `terraform fmt -recursive` locally before pushing |

---

## Cleanup — Destroy All Resources

### Via GitHub Actions (recommended)

**Actions → Terraform Destroy → Run workflow**
- Select environment
- Type environment name to confirm
- Click Run

### Via terminal

```bash
cd environments/dev
terraform destroy -var="alarm_email=any@example.com"
```

Type `yes` when prompted.

> The S3 bucket and DynamoDB table (created by bootstrap) are **not** Terraform-managed — delete them manually in the AWS Console if fully done.
