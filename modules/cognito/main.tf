locals {
  pool_name = "${var.project_name}-${var.environment}-user-pool"
}

# ── User Pool ─────────────────────────────────────────────────────────────────
resource "aws_cognito_user_pool" "this" {
  name = local.pool_name

  # Users identify with email, verified via code
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = 8
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  # MFA is optional (can be set to "ON" in prod)
  mfa_configuration = "OFF"

  # Account recovery via email
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = var.tags
}

# ── App Client ────────────────────────────────────────────────────────────────
# No client secret — public SPA/mobile client.
# API Gateway JWT authorizer will validate ID/Access tokens issued by this client.
resource "aws_cognito_user_pool_client" "this" {
  name         = "${var.project_name}-${var.environment}-client"
  user_pool_id = aws_cognito_user_pool.this.id

  generate_secret = false

  # Flows required: USER_PASSWORD_AUTH for username+password login,
  # USER_SRP_AUTH for Secure Remote Password (more secure),
  # REFRESH_TOKEN_AUTH to renew tokens silently.
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Token validity (API Gateway JWT authorizer honours these)
  access_token_validity  = 1  # hours
  id_token_validity      = 1  # hours
  refresh_token_validity = 30 # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # Do not allow unauthenticated identities
  prevent_user_existence_errors = "ENABLED"
}