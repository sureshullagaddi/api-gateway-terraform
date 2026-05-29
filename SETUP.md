# Complete Setup Guide — From Zero to Running Pipeline

This guide assumes you have **nothing** — no AWS account, no tools installed, no GitHub repo.  
Follow every step in order.

---

## Overview of Steps

```
Step 1  — Create an AWS account
Step 2  — Install required tools on your machine
Step 3  — Configure the AWS CLI with your account
Step 4  — Create and configure the GitHub repository
Step 5  — Bootstrap AWS backend infrastructure (S3, DynamoDB, OIDC, IAM)
Step 6  — Configure GitHub Environments and Secrets
Step 7  — Verify: push code and watch the pipeline run
Step 8  — Verify: call the deployed API
```

---

## Step 1 — Create an AWS Account

> Skip this step if you already have an AWS account.

1. Go to **https://aws.amazon.com** and click **"Create an AWS Account"**
2. Enter your email address and choose an account name (e.g. `my-api-project`)
3. Choose **"Personal"** account type
4. Enter payment details — a valid credit/debit card is required  
   *(You won't be charged for the free tier, but AWS requires a card on file)*
5. Complete identity verification via phone call or SMS
6. Choose the **"Basic Support — Free"** plan
7. Sign in to the **AWS Management Console** at https://console.aws.amazon.com

### 1a — Create an IAM Admin User (do NOT use root)

AWS best practice: never use the root account for day-to-day work.

1. In the Console search bar, type **IAM** and open it
2. Click **"Users"** → **"Create user"**
3. Username: `terraform-admin`
4. Check **"Provide user access to the AWS Management Console"** → **"I want to create an IAM user"**
5. Set a password, uncheck "User must change password"
6. Click **Next** → **"Attach policies directly"**
7. Search for and select **"AdministratorAccess"** (for initial setup — you can restrict later)
8. Click through to **"Create user"**
9. **Download the CSV** or copy the Console sign-in URL, username, and password shown on the final screen

> ⚠️ Keep these credentials safe. You will use the `terraform-admin` user, not root, for everything below.

---

## Step 2 — Install Required Tools

### 2a — AWS CLI

The AWS CLI lets you interact with AWS from your terminal. Required for the bootstrap script.

**macOS:**
```bash
brew install awscli
```

**Verify:**
```bash
aws --version
# Expected: aws-cli/2.x.x ...
```

---

### 2b — Terraform

Terraform reads the `.tf` files in this repo and creates/updates AWS resources.

**macOS (via tfenv — lets you switch versions easily):**
```bash
brew install tfenv
tfenv install 1.7.0
tfenv use 1.7.0
```

**Or directly:**
```bash
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
```

**Verify:**
```bash
terraform --version
# Expected: Terraform v1.7.x
```

---

### 2c — Node.js 18

Required to run the Lambda function locally if needed. Terraform's `archive_file` data source zips the `lambda/src/` directory — no manual step needed.

**macOS (via nvm — recommended):**
```bash
brew install nvm
nvm install 18
nvm use 18
```

**Verify:**
```bash
node --version
# Expected: v18.x.x
```

---

### 2d — Git

```bash
brew install git

# Configure your identity (required for commits)
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

---

### 2e — GitHub CLI (optional but helpful)

```bash
brew install gh
gh auth login   # follow prompts to authenticate
```

---

## Step 3 — Configure the AWS CLI

Connect your terminal to your AWS account so commands run against it.

```bash
aws configure
```

You will be prompted for four values:

```
AWS Access Key ID:     (see Step 3a below)
AWS Secret Access Key: (see Step 3a below)
Default region name:   eu-north-1
Default output format: json
```

### 3a — Create Access Keys for terraform-admin

1. In the AWS Console, go to **IAM → Users → terraform-admin**
2. Click the **"Security credentials"** tab
3. Scroll to **"Access keys"** → **"Create access key"**
4. Use case: **"Command Line Interface (CLI)"**, check the confirmation box
5. Click **"Create access key"**
6. **Copy both the Access Key ID and Secret Access Key now** — the secret is shown only once

Paste them into the `aws configure` prompts above.

**Verify:**
```bash
aws sts get-caller-identity
```
Expected output:
```json
{
    "UserId": "AIDA...",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/terraform-admin"
}
```

Note your **Account ID** (12-digit number) — you will need it in Step 5.

---

## Step 4 — Create and Configure the GitHub Repository

### 4a — Create the repository on GitHub

1. Go to **https://github.com/new**
2. Repository name: `api-gateway-terraform`
3. Set to **Private** (recommended for infrastructure code)
4. Do NOT initialise with README (you already have code)
5. Click **"Create repository"**

### 4b — Push this code to GitHub

```bash
cd /path/to/api-gateway-terraform     # your local clone of this repo

# If this repo doesn't have a remote yet:
git remote add origin https://github.com/YOUR-ORG/api-gateway-terraform.git

# Push
git add .
git commit -m "chore: initial commit"
git push -u origin main
```

Replace `YOUR-ORG` with your GitHub username or organisation name.

---

## Step 5 — Bootstrap AWS Backend Infrastructure

The bootstrap script creates everything Terraform needs to store state and authenticate from GitHub Actions. Run it **once** from your local machine.

### What it creates

| Resource | Purpose |
|----------|---------|
| **S3 Bucket** (`tf-state-demo-bucket`) | Stores Terraform state files (one per environment) |
| **DynamoDB Table** (`terraform-lock`) | State locking — prevents two pipelines applying at the same time |
| **IAM OIDC Identity Provider** | Allows GitHub Actions to prove its identity to AWS without stored credentials |
| **IAM Role** (`github-actions-oidc-role`) | The role GitHub Actions assumes — scoped to your repo only |

### 5a — Choose a globally unique S3 bucket name

S3 bucket names are **globally unique across all AWS accounts**. Add your account ID or a random suffix:

```bash
# Good — includes account ID
export BUCKET_NAME="tf-state-$(aws sts get-caller-identity --query Account --output text)"

# Or pick your own
export BUCKET_NAME="tf-state-mycompany-api-2026"
```

### 5b — Run the bootstrap script

```bash
export AWS_REGION=eu-north-1
export GITHUB_ORG=YOUR-GITHUB-USERNAME-OR-ORG
export GITHUB_REPO=api-gateway-terraform

bash scripts/bootstrap-state.sh
```

The script will print progress and at the end output:

```
✅ Bootstrap complete!

Next steps:
  1. Add the following secrets to each GitHub environment (dev / prod):
     AWS_ROLE_ARN = arn:aws:iam::123456789012:role/github-actions-oidc-role
     ALARM_EMAIL  = your-alerts@example.com

  2. Add the following GitHub variable (or use defaults):
     AWS_REGION = eu-north-1
```

**Copy the `AWS_ROLE_ARN` value** — you need it in Step 6.

### 5c — Update backend bucket name in Terraform files

If you used a custom bucket name (not `tf-state-demo-bucket`), update all four backend files:

```bash
# Find all backend.tf files and update the bucket name
find environments -name backend.tf | xargs sed -i '' \
  's/tf-state-demo-bucket/YOUR-ACTUAL-BUCKET-NAME/g'
```

Commit the change:
```bash
git add environments/*/backend.tf
git commit -m "chore: update S3 backend bucket name"
```

---

## Step 6 — Configure GitHub Environments and Secrets

GitHub Environments let you store secrets per environment (dev, sit, stage, prod) and optionally require manual approval before deploying to prod.

### 6a — Create the four GitHub Environments

1. Go to your repo on GitHub
2. Click **Settings** → **Environments** (left sidebar)
3. Click **"New environment"** and create each of these:
   - `dev`
   - `sit`
   - `stage`
   - `prod`

For `prod`, consider enabling **"Required reviewers"** — this makes prod deploys require a manual approval click in the GitHub Actions UI before applying.

### 6b — Add secrets to EACH environment

Repeat the following for **each** of the four environments (`dev`, `sit`, `stage`, `prod`):

1. Click the environment name
2. Under **"Environment secrets"**, click **"Add secret"**

Add these two secrets:

| Secret Name | Value | Notes |
|-------------|-------|-------|
| `AWS_ROLE_ARN` | `arn:aws:iam::YOUR-ACCOUNT-ID:role/github-actions-oidc-role` | From bootstrap script output |
| `ALARM_EMAIL` | `your-email@example.com` | Receives CloudWatch alarm notifications |

### 6c — Add a repository-level variable (optional)

1. Go to **Settings → Secrets and variables → Actions**
2. Click the **"Variables"** tab
3. Click **"New repository variable"**

| Variable Name | Value |
|---------------|-------|
| `AWS_REGION` | `eu-north-1` |

> If you don't add this variable, the workflow defaults to `eu-north-1` via `${{ vars.AWS_REGION || 'eu-north-1' }}`.

---

## Step 7 — Verify: Push Code and Watch the Pipeline

### 7a — Trigger the plan-dev job (non-main branch)

Create a feature branch and push it:

```bash
git checkout -b feature/test-pipeline
git commit --allow-empty -m "test: trigger pipeline"
git push origin feature/test-pipeline
```

Go to your repo on GitHub → **Actions** tab.  
You should see the **"Terraform"** workflow running with the `plan-dev` job.

Expected result: ✅ `Plan [dev]` passes — shows what Terraform *would* create.

### 7b — Trigger the deploy job (main branch)

Open a Pull Request from `feature/test-pipeline` → `main`, then merge it.  
Or push directly to main:

```bash
git checkout main
git merge feature/test-pipeline
git push origin main
```

Go to **Actions** → you should see:

```
Terraform
  └── Deploy [dev]   ← running
```

The deploy job runs `terraform apply` on dev.  
It will create these AWS resources for the first time (~2-3 minutes):

- Cognito User Pool + App Client
- Lambda function (auto-zipped from `lambda/src/index.js`)
- API Gateway HTTP API with JWT authorizer
- CloudWatch log groups + alarms + dashboard
- WAF WebACL (disabled in dev by default)

### 7c — Check the Terraform outputs

After the apply completes, view the outputs:

```bash
cd environments/dev
terraform init   # only needed once locally after bootstrap
terraform output
```

Expected:
```
api_endpoint         = "https://abc123.execute-api.eu-north-1.amazonaws.com/"
secure_endpoint      = "https://abc123.execute-api.eu-north-1.amazonaws.com/secure"
cognito_client_id    = "1abc2def3ghi..."
cognito_user_pool_id = "eu-north-1_XXXXXXX"
dashboard_url        = "https://eu-north-1.console.aws.amazon.com/cloudwatch/..."
lambda_function_name = "api-demo-dev-lambda"
lambda_version       = "1"
```

---

## Step 8 — Verify: Call the Deployed API

### 8a — Create a test user in Cognito

```bash
USER_POOL_ID=$(terraform -chdir=environments/dev output -raw cognito_user_pool_id)
CLIENT_ID=$(terraform -chdir=environments/dev output -raw cognito_client_id)

# Create the user (starts in FORCE_CHANGE_PASSWORD state)
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "test@example.com" \
  --temporary-password "Temp1234!" \
  --region eu-north-1

# Set a permanent password immediately
aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "test@example.com" \
  --password "Perm5678@" \
  --permanent \
  --region eu-north-1
```

### 8b — Get an Access Token

```bash
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters USERNAME="test@example.com",PASSWORD="Perm5678@" \
  --query "AuthenticationResult.AccessToken" \
  --output text \
  --region eu-north-1)

echo "Token obtained: ${TOKEN:0:40}..."
```

### 8c — Call the secured endpoint

```bash
API_URL=$(terraform -chdir=environments/dev output -raw secure_endpoint)

curl -s -H "Authorization: Bearer $TOKEN" "$API_URL" | jq .
```

Expected response:
```json
{
  "message": "Access granted to secure endpoint",
  "user": {
    "sub": "a1b2c3d4-...",
    "email": "test@example.com"
  },
  "environment": "dev",
  "requestId": "abc123",
  "timestamp": "2026-05-28T10:00:00.000Z"
}
```

### 8d — Verify a rejected request (no token)

```bash
curl -s "$API_URL"
```

Expected (401 Unauthorized):
```json
{"message":"Unauthorized"}
```

---

## Cost Estimate (Dev Environment)

All resources used are either **free tier** or very low cost:

| Service | Free Tier | Beyond Free Tier |
|---------|-----------|-----------------|
| Lambda | 1M requests/month free | $0.20 per 1M requests |
| API Gateway | 1M HTTP API calls/month free | $1.00 per 1M calls |
| Cognito | 50,000 MAUs free | $0.0055 per MAU |
| CloudWatch Logs | 5 GB ingestion free | $0.50 per GB |
| CloudWatch Alarms | 10 alarms free | $0.10 per alarm/month |
| DynamoDB (lock table) | 25 GB free | $0.25 per GB |
| S3 (state bucket) | 5 GB free | $0.023 per GB |
| WAF | **NOT free** — $5/month per WebACL | Disabled in dev by default ✅ |
| X-Ray | 100K traces/month free | $0.05 per 10K traces |

**Estimated monthly cost for dev with default settings: ~$0** (within free tier)

> ⚠️ WAF is disabled in dev (`enable_waf = false`) specifically to avoid the $5/month WebACL charge during development. It is enabled in sit/stage/prod.

---

## Troubleshooting

### "Error: No valid credential sources found"
The AWS CLI is not configured. Re-run `aws configure` (Step 3).

### "Error: Bucket does not exist" during `terraform init`
The S3 bucket hasn't been created yet, or the bucket name in `backend.tf` doesn't match.  
Re-run the bootstrap script (Step 5) and check the bucket name.

### "Error: error creating IAM OIDC Provider: EntityAlreadyExists"
The OIDC provider already exists in your account — this is fine. The bootstrap script handles this gracefully.

### GitHub Actions job fails: "Could not assume role"
- Check that `AWS_ROLE_ARN` secret is set correctly in the GitHub Environment (not repo-level secrets)
- Check the IAM role trust policy includes your repo: `repo:YOUR-ORG/api-gateway-terraform:*`
- Ensure the GitHub Environment name in the workflow matches exactly (case-sensitive): `dev`

### "Error: error creating Lambda Function: InvalidParameterValueException"
The Lambda zip may be empty or the `lambda/src/` directory is missing `index.js`.  
Verify the file exists: `ls lambda/src/index.js`

### Terraform plan shows no changes but apply fails
Run `terraform init -upgrade` to refresh provider locks, then re-apply.

---

## Cleanup — Destroy All Resources

You have two options: use the **GitHub Actions destroy workflow** (recommended) or run Terraform locally.

---

### Option A — GitHub Actions Destroy Workflow (recommended)

The destroy workflow is manual-trigger only and has a double-confirmation safety gate to prevent accidents.

**How to run:**

1. Go to your GitHub repo → **Actions** tab
2. In the left sidebar, click **"Terraform Destroy"**
3. Click **"Run workflow"** (top-right)
4. Fill in the two required inputs:

   | Input | What to enter |
   |-------|--------------|
   | **Environment** | Select from dropdown: `dev`, `sit`, `stage`, or `prod` |
   | **Confirm** | Type the environment name exactly (e.g. `dev`) |

5. Click **"Run workflow"**

The workflow runs two jobs:

```
Safety Check   — verifies confirm phrase matches selected environment
     ↓ (only if check passes)
Destroy [dev]  — runs terraform plan -destroy (preview), then terraform destroy
```

If the confirmation phrase doesn't match, the workflow **aborts before touching any AWS resources**.

After completion, a summary is posted to the Actions run showing who triggered it, when, and the result.

> ⚠️ **What is NOT deleted:**  
> The S3 state bucket and DynamoDB lock table were created by the bootstrap script and are **not** managed by Terraform. They are intentionally left intact so you can re-deploy later without re-bootstrapping. Delete them manually in the AWS Console only if you are permanently done with the project.

---

### Option B — Local Terraform Destroy

If you prefer to run it from your machine:

```bash
# Destroy dev
cd environments/dev
terraform init -input=false
terraform destroy -var="alarm_email=your-email@example.com" -input=false

# Destroy sit
cd ../sit
terraform init -input=false
terraform destroy -var="alarm_email=your-email@example.com" -input=false

# Destroy stage / prod — same pattern
```

Type `yes` when Terraform prompts for confirmation.

---

### Manual cleanup of bootstrap resources (optional)

If you want to completely remove all traces from AWS:

```bash
# Delete the S3 state bucket (empty it first)
aws s3 rm s3://YOUR-BUCKET-NAME --recursive
aws s3api delete-bucket --bucket YOUR-BUCKET-NAME --region eu-north-1

# Delete the DynamoDB lock table
aws dynamodb delete-table --table-name terraform-lock --region eu-north-1

# Delete the OIDC identity provider
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn \
  arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com

# Delete the IAM role
aws iam detach-role-policy \
  --role-name github-actions-oidc-role \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
aws iam delete-role --role-name github-actions-oidc-role
```

