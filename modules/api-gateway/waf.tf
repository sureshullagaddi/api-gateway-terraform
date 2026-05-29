# ── WAF v2 WebACL (REGIONAL) ──────────────────────────────────────────────────
# Protects the API Gateway stage with:
#   1. IP-based rate limiting (blocks IPs exceeding waf_rate_limit req/5min)
#   2. AWS managed CRS (common web exploits: SQLi, XSS, etc.)
# Set enable_waf = false in dev to reduce cost during development.

resource "aws_wafv2_web_acl" "api" {
  count = var.enable_waf ? 1 : 0

  name  = "${var.project_name}-${var.environment}-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  # Rule 1 — Rate limiting per source IP
  rule {
    name     = "IPRateLimit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-${var.environment}-ip-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  # Rule 2 — AWS Managed Common Rule Set (SQLi, XSS, bad inputs)
  rule {
    name     = "AWSManagedCommonRules"
    priority = 2

    override_action {
      none {} # honour the rule group's own action (block)
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-${var.environment}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  # Rule 3 — AWS Managed Known Bad Inputs
  rule {
    name     = "AWSManagedKnownBadInputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-${var.environment}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-${var.environment}-waf"
    sampled_requests_enabled   = true
  }

  tags = var.tags
}

# Associate WAF with the API Gateway stage
# Note: AWS WAF v2 supports HTTP API (v2) stages as REGIONAL resources.
resource "aws_wafv2_web_acl_association" "api" {
  count = var.enable_waf ? 1 : 0

  resource_arn = aws_apigatewayv2_stage.default.arn
  web_acl_arn  = aws_wafv2_web_acl.api[0].arn
}

