#!/usr/bin/env bash
# ============================================================
# SallySale — Railway Services Setup Script
# ============================================================
# Usage:
#   1. Install Railway CLI:  npm install -g @railway/cli
#   2. Login:               railway login
#   3. Link project:        railway link  (choose sallysale-bots project)
#   4. Run this script:     bash railway-setup.sh
#
# IMPORTANT — After running, go to Railway Dashboard and for each
# service set: Settings → Source → Root Directory → bots/<bot-folder>
# (The CLI cannot set Root Directory automatically)
# ============================================================

set -e

# ── helpers ──────────────────────────────────────────────────
create_service() {
  local NAME=$1
  local ROOT=$2
  echo ""
  echo "▶  Creating service: $NAME  (root: $ROOT)"
  railway service create "$NAME" || echo "   ⚠ Service may already exist, skipping create"
}

set_vars_supabase() {
  local NAME=$1
  echo "   Setting SUPABASE vars on $NAME"
  railway variables set \
    SUPABASE_URL="$SUPABASE_URL" \
    SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
    --service "$NAME"
}

set_vars_scraper() {
  local NAME=$1
  set_vars_supabase "$NAME"
  railway variables set SCRAPERAPI_KEY="$SCRAPERAPI_KEY" --service "$NAME"
}

set_vars_telegram() {
  local NAME=$1
  set_vars_supabase "$NAME"
  railway variables set \
    TELEGRAM_BOT_TOKEN="$TELEGRAM_BOT_TOKEN" \
    TELEGRAM_ALERT_CHAT_ID="$TELEGRAM_ALERT_CHAT_ID" \
    --service "$NAME"
}

set_vars_resend() {
  local NAME=$1
  set_vars_supabase "$NAME"
  railway variables set \
    RESEND_API_KEY="$RESEND_API_KEY" \
    FROM_EMAIL="$FROM_EMAIL" \
    SITE_URL="$SITE_URL" \
    --service "$NAME"
}

# ── required env vars (set these before running) ─────────────
# Core
export SUPABASE_URL="${SUPABASE_URL:?❌ Set SUPABASE_URL}"
export SUPABASE_SERVICE_KEY="${SUPABASE_SERVICE_KEY:?❌ Set SUPABASE_SERVICE_KEY}"
# Scraping
export SCRAPERAPI_KEY="${SCRAPERAPI_KEY:-}"
# Telegram
export TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
export TELEGRAM_ALERT_CHAT_ID="${TELEGRAM_ALERT_CHAT_ID:-}"
# Email
export RESEND_API_KEY="${RESEND_API_KEY:-}"
export FROM_EMAIL="${FROM_EMAIL:-hello@sallysale.com}"
export SITE_URL="${SITE_URL:-https://sallysale.com}"
# OpenAI
export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
# DeepL
export DEEPL_API_KEY="${DEEPL_API_KEY:-}"
# eBay
export EBAY_APP_ID="${EBAY_APP_ID:-}"
export EBAY_CAMPAIGN_ID="${EBAY_CAMPAIGN_ID:-}"
# Affiliate
export TRADEDOUBLER_TOKEN="${TRADEDOUBLER_TOKEN:-}"
export TRADEDOUBLER_PUBLISHER_ID="${TRADEDOUBLER_PUBLISHER_ID:-}"
export CJ_WEBSITE_ID="${CJ_WEBSITE_ID:-}"
export AWIN_PUBLISHER_ID="${AWIN_PUBLISHER_ID:-}"
export IMPACT_ACCOUNT_SID="${IMPACT_ACCOUNT_SID:-}"
export IMPACT_AUTH_TOKEN="${IMPACT_AUTH_TOKEN:-}"
export RAKUTEN_TOKEN="${RAKUTEN_TOKEN:-}"
export AMAZON_AFFILIATE_TAG="${AMAZON_AFFILIATE_TAG:-}"
# VAPID
export VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}"
export VAPID_PRIVATE_KEY="${VAPID_PRIVATE_KEY:-}"
export VAPID_EMAIL="${VAPID_EMAIL:-hello@sallysale.com}"
# Currency
export EXCHANGERATE_API_KEY="${EXCHANGERATE_API_KEY:-}"
# WhatsApp
export WA_API_KEY="${WA_API_KEY:-}"
export WA_PHONE_NUMBER_ID="${WA_PHONE_NUMBER_ID:-}"

echo "============================================================"
echo "  SallySale — Railway Services Setup"
echo "============================================================"

# ============================================================
# LAYER 1 — Collection Bots
# ============================================================

create_service "bot-03-impact-api" "bots/bot-03-impact-api"
set_vars_supabase "bot-03-impact-api"
railway variables set \
  IMPACT_ACCOUNT_SID="$IMPACT_ACCOUNT_SID" \
  IMPACT_AUTH_TOKEN="$IMPACT_AUTH_TOKEN" \
  --service "bot-03-impact-api"

create_service "bot-04-awin-api" "bots/bot-04-awin-api"
set_vars_supabase "bot-04-awin-api"
railway variables set \
  AWIN_PUBLISHER_ID="$AWIN_PUBLISHER_ID" \
  --service "bot-04-awin-api"

create_service "bot-07-ebay-epn" "bots/bot-07-ebay-epn"
set_vars_supabase "bot-07-ebay-epn"
railway variables set \
  EBAY_APP_ID="$EBAY_APP_ID" \
  EBAY_CAMPAIGN_ID="$EBAY_CAMPAIGN_ID" \
  --service "bot-07-ebay-epn"

create_service "bot-08-rss-aggregator" "bots/bot-08-rss-aggregator"
set_vars_supabase "bot-08-rss-aggregator"

create_service "bot-09-scraping-tier1" "bots/bot-09-scraping-tier1"
set_vars_scraper "bot-09-scraping-tier1"

create_service "bot-10-scraping-tier2" "bots/bot-10-scraping-tier2"
set_vars_scraper "bot-10-scraping-tier2"

create_service "bot-11-amazon-direct" "bots/bot-11-amazon-direct"
set_vars_scraper "bot-11-amazon-direct"
railway variables set AMAZON_AFFILIATE_TAG="$AMAZON_AFFILIATE_TAG" --service "bot-11-amazon-direct"

create_service "bot-12-google-shopping" "bots/bot-12-google-shopping"
set_vars_scraper "bot-12-google-shopping"

create_service "bot-13-google-trends" "bots/bot-13-google-trends"
set_vars_supabase "bot-13-google-trends"

create_service "bot-15-seasonal-intel" "bots/bot-15-seasonal-intel"
set_vars_supabase "bot-15-seasonal-intel"

create_service "bot-16-competitor-monitor" "bots/bot-16-competitor-monitor"
set_vars_scraper "bot-16-competitor-monitor"

# ============================================================
# LAYER 2 — Validation Bots
# ============================================================

create_service "bot-17-price-validator" "bots/bot-17-price-validator"
set_vars_supabase "bot-17-price-validator"

create_service "bot-18-price-history" "bots/bot-18-price-history"
set_vars_supabase "bot-18-price-history"
[ -n "$EXCHANGERATE_API_KEY" ] && railway variables set EXCHANGERATE_API_KEY="$EXCHANGERATE_API_KEY" --service "bot-18-price-history"

create_service "bot-19-link-validator" "bots/bot-19-link-validator"
set_vars_supabase "bot-19-link-validator"

create_service "bot-20-expiry-detector" "bots/bot-20-expiry-detector"
set_vars_supabase "bot-20-expiry-detector"

create_service "bot-21-image-validator" "bots/bot-21-image-validator"
set_vars_scraper "bot-21-image-validator"

create_service "bot-22-dedup-engine" "bots/bot-22-dedup-engine"
set_vars_supabase "bot-22-dedup-engine"
railway variables set OPENAI_API_KEY="$OPENAI_API_KEY" --service "bot-22-dedup-engine"

create_service "bot-23-deal-scorer" "bots/bot-23-deal-scorer"
set_vars_supabase "bot-23-deal-scorer"

# ============================================================
# LAYER 3 — Management Bots
# ============================================================

create_service "bot-24-auto-categorizer" "bots/bot-24-auto-categorizer"
set_vars_supabase "bot-24-auto-categorizer"
railway variables set OPENAI_API_KEY="$OPENAI_API_KEY" --service "bot-24-auto-categorizer"

create_service "bot-25-auto-translator" "bots/bot-25-auto-translator"
set_vars_supabase "bot-25-auto-translator"
railway variables set DEEPL_API_KEY="$DEEPL_API_KEY" --service "bot-25-auto-translator"

create_service "bot-26-currency-bot" "bots/bot-26-currency-bot"
set_vars_supabase "bot-26-currency-bot"
[ -n "$EXCHANGERATE_API_KEY" ] && railway variables set EXCHANGERATE_API_KEY="$EXCHANGERATE_API_KEY" --service "bot-26-currency-bot"

create_service "bot-27-geo-pricing" "bots/bot-27-geo-pricing"
set_vars_supabase "bot-27-geo-pricing"

create_service "bot-28-variant-matcher" "bots/bot-28-variant-matcher"
set_vars_supabase "bot-28-variant-matcher"

create_service "bot-29-affiliate-sorter" "bots/bot-29-affiliate-sorter"
set_vars_supabase "bot-29-affiliate-sorter"
railway variables set \
  TRADEDOUBLER_TOKEN="$TRADEDOUBLER_TOKEN" \
  CJ_WEBSITE_ID="$CJ_WEBSITE_ID" \
  AWIN_PUBLISHER_ID="$AWIN_PUBLISHER_ID" \
  EBAY_CAMPAIGN_ID="$EBAY_CAMPAIGN_ID" \
  --service "bot-29-affiliate-sorter"

create_service "bot-30-anti-abuse" "bots/bot-30-anti-abuse"
set_vars_supabase "bot-30-anti-abuse"

# ============================================================
# LAYER 4 — Marketing Bots
# ============================================================

create_service "bot-31-telegram-bot" "bots/bot-31-telegram-bot"
set_vars_telegram "bot-31-telegram-bot"
railway variables set TELEGRAM_CHANNEL_ID="${TELEGRAM_CHANNEL_ID:-}" --service "bot-31-telegram-bot"

create_service "bot-33-instagram-bot" "bots/bot-33-instagram-bot"
set_vars_supabase "bot-33-instagram-bot"

create_service "bot-34-seo-bot" "bots/bot-34-seo-bot"
set_vars_supabase "bot-34-seo-bot"
railway variables set SITE_URL="$SITE_URL" --service "bot-34-seo-bot"

create_service "bot-35-push-notifications" "bots/bot-35-push-notifications"
set_vars_supabase "bot-35-push-notifications"
railway variables set \
  VAPID_PUBLIC_KEY="$VAPID_PUBLIC_KEY" \
  VAPID_PRIVATE_KEY="$VAPID_PRIVATE_KEY" \
  VAPID_EMAIL="$VAPID_EMAIL" \
  --service "bot-35-push-notifications"

create_service "bot-36-daily-digest" "bots/bot-36-daily-digest"
set_vars_resend "bot-36-daily-digest"

# ============================================================
# LAYER 5 — Protection Bots
# ============================================================

create_service "bot-37-rate-limiter" "bots/bot-37-rate-limiter"
set_vars_supabase "bot-37-rate-limiter"

create_service "bot-38-click-fraud" "bots/bot-38-click-fraud"
set_vars_supabase "bot-38-click-fraud"

create_service "bot-39-backup-bot" "bots/bot-39-backup-bot"
set_vars_supabase "bot-39-backup-bot"

create_service "bot-40-health-monitor" "bots/bot-40-health-monitor"
set_vars_telegram "bot-40-health-monitor"
railway variables set SITE_URL="$SITE_URL" --service "bot-40-health-monitor"

# ============================================================
# LAYER 6 — User Bots
# ============================================================

create_service "bot-41-sally-points" "bots/bot-41-sally-points"
set_vars_supabase "bot-41-sally-points"

create_service "bot-42-leaderboard" "bots/bot-42-leaderboard"
set_vars_supabase "bot-42-leaderboard"

create_service "bot-43-wishlist-scanner" "bots/bot-43-wishlist-scanner"
set_vars_supabase "bot-43-wishlist-scanner"

create_service "bot-44-alert-sender" "bots/bot-44-alert-sender"
set_vars_resend "bot-44-alert-sender"

create_service "bot-45-demand-tracker" "bots/bot-45-demand-tracker"
set_vars_supabase "bot-45-demand-tracker"

create_service "bot-46-abandonment-bot" "bots/bot-46-abandonment-bot"
set_vars_resend "bot-46-abandonment-bot"

# ============================================================
# LAYER 7 — Advanced Bots
# ============================================================

create_service "bot-47-price-history-chart" "bots/bot-47-price-history-chart"
set_vars_supabase "bot-47-price-history-chart"

create_service "bot-48-review-aggregator" "bots/bot-48-review-aggregator"
set_vars_scraper "bot-48-review-aggregator"

create_service "bot-49-visual-search" "bots/bot-49-visual-search"
set_vars_scraper "bot-49-visual-search"

create_service "bot-50-personalization" "bots/bot-50-personalization"
set_vars_supabase "bot-50-personalization"

create_service "bot-52-coverage-tracker" "bots/bot-52-coverage-tracker"
set_vars_supabase "bot-52-coverage-tracker"

# ============================================================
# LAYER 8 — Extra Bots
# ============================================================

create_service "bot-53-flash-sale-detector" "bots/bot-53-flash-sale-detector"
set_vars_supabase "bot-53-flash-sale-detector"

create_service "bot-54-stock-monitor" "bots/bot-54-stock-monitor"
set_vars_supabase "bot-54-stock-monitor"

create_service "bot-55-coupon-validator" "bots/bot-55-coupon-validator"
set_vars_supabase "bot-55-coupon-validator"

create_service "bot-56-bundle-detector" "bots/bot-56-bundle-detector"
set_vars_supabase "bot-56-bundle-detector"

create_service "bot-57-data-cleaner" "bots/bot-57-data-cleaner"
set_vars_supabase "bot-57-data-cleaner"

create_service "bot-59-social-proof" "bots/bot-59-social-proof"
set_vars_supabase "bot-59-social-proof"

create_service "bot-61-legal-validator" "bots/bot-61-legal-validator"
set_vars_supabase "bot-61-legal-validator"
railway variables set SITE_URL="$SITE_URL" --service "bot-61-legal-validator"

create_service "bot-62-gdpr-manager" "bots/bot-62-gdpr-manager"
set_vars_supabase "bot-62-gdpr-manager"

create_service "bot-63-cashback-detector" "bots/bot-63-cashback-detector"
set_vars_supabase "bot-63-cashback-detector"

create_service "bot-64-returns-policy" "bots/bot-64-returns-policy"
set_vars_supabase "bot-64-returns-policy"
[ -n "$SCRAPERAPI_KEY" ] && railway variables set SCRAPERAPI_KEY="$SCRAPERAPI_KEY" --service "bot-64-returns-policy"

create_service "bot-65-email-digest" "bots/bot-65-email-digest"
set_vars_resend "bot-65-email-digest"

create_service "bot-66-ab-test" "bots/bot-66-ab-test"
set_vars_supabase "bot-66-ab-test"

create_service "bot-67-bot-block-detector" "bots/bot-67-bot-block-detector"
set_vars_telegram "bot-67-bot-block-detector"

create_service "bot-68-bot-health-auditor" "bots/bot-68-bot-health-auditor"
set_vars_telegram "bot-68-bot-health-auditor"

create_service "bot-69-affiliate-link-tester" "bots/bot-69-affiliate-link-tester"
set_vars_supabase "bot-69-affiliate-link-tester"

create_service "bot-70-deal-quality-feedback" "bots/bot-70-deal-quality-feedback"
set_vars_supabase "bot-70-deal-quality-feedback"

create_service "bot-71-dependency-scanner" "bots/bot-71-dependency-scanner"
set_vars_telegram "bot-71-dependency-scanner"

create_service "bot-72-daily-report" "bots/bot-72-daily-report"
set_vars_telegram "bot-72-daily-report"

# ============================================================
# Infrastructure Bots
# ============================================================

create_service "bot-coordinator" "bots/bot-coordinator"
set_vars_supabase "bot-coordinator"

create_service "bot-watchdog" "bots/bot-watchdog"
set_vars_telegram "bot-watchdog"

create_service "bot-failover" "bots/bot-failover"
set_vars_supabase "bot-failover"

# ============================================================
echo ""
echo "============================================================"
echo "✅ All Railway services created!"
echo ""
echo "⚠️  MANUAL STEP REQUIRED — Railway Dashboard:"
echo "   For each service → Settings → Source → Root Directory"
echo "   Set the path listed in the 'root:' column above."
echo "   Example: bot-08-rss-aggregator → bots/bot-08-rss-aggregator"
echo ""
echo "After setting Root Directory, redeploy each service:"
echo "   railway redeploy --service <service-name>"
echo "============================================================"
